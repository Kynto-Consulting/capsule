/** Codificador/decodificador binario CAP1 (solicitud) y CAPR (respuesta). PROTOCOL.md §5-§7. Sin dependencias de Node. */

import { asciiToBytes, bytesToAscii, bytesToHex, concatBytes, hexToBytes } from "./bytes";
import type { ResponseErrorKind } from "./errors";
import { formatIPv4, formatIPv6, parseIp } from "./ip";

export const MAX_HDR = 1024;
export const MIN_HDR = 17;
const FIXED = 9;
const MAX_ENCODE_HDR = MAX_HDR;

export const AUTH_PREFIX: Record<number, string> = { 1: "cap_", 2: "cgt_", 3: "cgc_", 4: "cgs_" };

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TOKEN_RE = /^[A-Za-z0-9_.-]+$/;
const CLIENT_ID_RE = /^[A-Za-z0-9._/+-]{1,64}$/;

export type AuthType = 1 | 2 | 3 | 4;

/** Devuelve el `auth_type` según el prefijo del token, o undefined. */
export function authTypeOf(token: string): AuthType | undefined {
  for (const [t, p] of Object.entries(AUTH_PREFIX)) {
    if (token.startsWith(p)) return Number(t) as AuthType;
  }
  return undefined;
}

export interface RequestFields {
  /** 1 = tcp, 2 = udp sobre flujo, 3 = udp sobre QUIC (futuro). */
  transport: number;
  flags?: number;
  project: string;
  service: string;
  authType: number;
  auth: string;
  /** TLV 0x01: 16 bytes. */
  nonce?: Uint8Array;
  /** TLV 0x02. */
  clientId?: string;
  /** TLV 0x80: cantidad de bytes de relleno (ceros). */
  padding?: number;
}

export interface DecodedRequest {
  transport: number;
  flags: number;
  project: string;
  service: string;
  authType: number;
  auth: string;
  ignoredTlvs: number;
  nonce?: Uint8Array;
  clientId?: string;
}

export type RequestDecodeResult =
  | { kind: "incomplete" }
  | { kind: "ok"; fields: DecodedRequest; consumed: number }
  | { kind: "error"; status: number; code: number };

export class EncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncodeError";
  }
}

/** Codifica un encabezado CAP1. Lanza `EncodeError` si los campos no cumplen el protocolo. */
export function encodeRequest(f: RequestFields): Uint8Array {
  const flags = f.flags ?? 0;
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xff || (flags & 0xfe) !== 0) {
    throw new EncodeError("flags: bits reservados deben ser 0");
  }
  if (![1, 2, 3].includes(f.transport)) throw new EncodeError("transport inválido");
  if (!NAME_RE.test(f.project) || f.project.length > 63) throw new EncodeError("project inválido");
  if (!NAME_RE.test(f.service) || f.service.length > 63) throw new EncodeError("service inválido");
  const prefix = AUTH_PREFIX[f.authType];
  if (prefix === undefined) throw new EncodeError("auth_type inválido");
  if (f.auth.length < 8 || f.auth.length > 512) throw new EncodeError("longitud de token fuera de 8..512");
  if (!f.auth.startsWith(prefix) || !TOKEN_RE.test(f.auth)) throw new EncodeError("formato de token inválido");

  const tlvs: Uint8Array[] = [];
  if (f.nonce !== undefined) {
    if (f.nonce.length !== 16) throw new EncodeError("nonce debe tener 16 bytes");
    tlvs.push(Uint8Array.of(0x01, 16), f.nonce);
  }
  if (f.clientId !== undefined) {
    if (!CLIENT_ID_RE.test(f.clientId)) throw new EncodeError("client_id inválido");
    tlvs.push(Uint8Array.of(0x02, f.clientId.length), asciiToBytes(f.clientId));
  }
  if (f.padding !== undefined && f.padding > 0) {
    if (!Number.isInteger(f.padding) || f.padding > 255) throw new EncodeError("padding fuera de 0..255");
    tlvs.push(Uint8Array.of(0x80, f.padding), new Uint8Array(f.padding));
  }
  const proj = asciiToBytes(f.project);
  const svc = asciiToBytes(f.service);
  const auth = asciiToBytes(f.auth);
  const body = concatBytes([
    Uint8Array.of(proj.length),
    proj,
    Uint8Array.of(svc.length),
    svc,
    Uint8Array.of(f.authType, auth.length >> 8, auth.length & 0xff),
    auth,
    ...tlvs,
  ]);
  const total = FIXED + body.length;
  if (total > MAX_ENCODE_HDR) throw new EncodeError("encabezado mayor de 1024 bytes");
  return concatBytes([
    asciiToBytes("CAP1"),
    Uint8Array.of(1, flags, total >> 8, total & 0xff, f.transport),
    body,
  ]);
}

function reqErr(code: number): RequestDecodeResult {
  return { kind: "error", status: 1, code };
}

/**
 * Decodifica un encabezado CAP1 según el algoritmo normativo de PROTOCOL.md §5.
 * `eof` indica que el flujo terminó. Nunca lanza; nunca reserva más de `hdr_len` bytes.
 */
export function decodeRequest(data: Uint8Array, eof: boolean): RequestDecodeResult {
  const n = data.length;
  if (n < 8) return eof ? reqErr(0x010a) : { kind: "incomplete" };
  if (data[0] !== 0x43 || data[1] !== 0x41 || data[2] !== 0x50 || data[3] !== 0x31) return reqErr(0x0102);
  if (data[4] !== 1) return reqErr(0x0101);
  const flags = data[5] as number;
  const hl = ((data[6] as number) << 8) | (data[7] as number);
  if (hl < MIN_HDR || hl > MAX_HDR) return reqErr(0x0103);
  if (n < hl) return eof ? reqErr(0x010a) : { kind: "incomplete" };
  const h = data.subarray(0, hl);
  if ((flags & 0xfe) !== 0) return reqErr(0x0104);
  const transport = h[8] as number;
  if (transport !== 1 && transport !== 2 && transport !== 3) return reqErr(0x0109);
  let cur = FIXED;
  const names: string[] = [];
  for (let i = 0; i < 2; i++) {
    if (cur + 1 > hl) return reqErr(0x010b);
    const len = h[cur] as number;
    cur += 1;
    if (len < 1 || len > 63) return reqErr(0x0105);
    if (cur + len > hl) return reqErr(0x010b);
    const s = bytesToAscii(h.subarray(cur, cur + len));
    cur += len;
    if (s === null || !NAME_RE.test(s)) return reqErr(0x0105);
    names.push(s);
  }
  if (cur + 3 > hl) return reqErr(0x010b);
  const at = h[cur] as number;
  cur += 1;
  const prefix = AUTH_PREFIX[at];
  if (prefix === undefined) return reqErr(0x0106);
  const al = ((h[cur] as number) << 8) | (h[cur + 1] as number);
  cur += 2;
  if (al < 8 || al > 512) return reqErr(0x0106);
  if (cur + al > hl) return reqErr(0x010b);
  const tok = bytesToAscii(h.subarray(cur, cur + al));
  cur += al;
  if (tok === null || !tok.startsWith(prefix) || !TOKEN_RE.test(tok)) return reqErr(0x0106);

  const out: DecodedRequest = {
    transport,
    flags,
    project: names[0] as string,
    service: names[1] as string,
    authType: at,
    auth: tok,
    ignoredTlvs: 0,
  };
  let seenNonce = false;
  let seenClient = false;
  while (cur < hl) {
    if (cur + 2 > hl) return reqErr(0x0107);
    const t = h[cur] as number;
    const ln = h[cur + 1] as number;
    cur += 2;
    if (cur + ln > hl) return reqErr(0x0107);
    const v = h.subarray(cur, cur + ln);
    cur += ln;
    if (t === 0x01) {
      if (seenNonce || ln !== 16) return reqErr(0x0107);
      seenNonce = true;
      out.nonce = v.slice();
    } else if (t === 0x02) {
      const s = bytesToAscii(v);
      if (s === null || seenClient || !CLIENT_ID_RE.test(s)) return reqErr(0x0107);
      seenClient = true;
      out.clientId = s;
    } else if (t >= 0x80) {
      out.ignoredTlvs += 1;
    } else {
      return reqErr(0x0108);
    }
  }
  return { kind: "ok", fields: out, consumed: hl };
}

// ---------------------------------------------------------------- respuesta

export interface ResponseTlvs {
  maxVersion?: number;
  retryAfter?: number;
  sessionId?: Uint8Array;
  clientAddr?: { ip: string; port: number };
  maxDatagram?: number;
  idleTimeout?: number;
  /** Solo codificación: bytes de relleno (TLV 0x80). */
  padding?: number;
}

export interface ResponseFields {
  version: number;
  status: number;
  code: number;
  msg: string;
  tlvs: ResponseTlvs;
}

export type ResponseDecodeResult =
  | { kind: "incomplete" }
  | { kind: "ok"; fields: ResponseFields; consumed: number }
  | { kind: "error"; error: ResponseErrorKind };

function rerr(error: ResponseErrorKind): ResponseDecodeResult {
  return { kind: "error", error };
}

/** Codifica una respuesta CAPR (la usa el gateway de referencia y las pruebas). */
export function encodeResponse(f: ResponseFields): Uint8Array {
  const msg = asciiToBytes(f.msg);
  const t = f.tlvs;
  const ext: Uint8Array[] = [];
  const u16b = (n: number): Uint8Array => Uint8Array.of((n >> 8) & 0xff, n & 0xff);
  if (t.maxVersion !== undefined) ext.push(Uint8Array.of(1, 1, t.maxVersion));
  if (t.retryAfter !== undefined) ext.push(Uint8Array.of(2, 2), u16b(t.retryAfter));
  if (t.sessionId !== undefined) ext.push(Uint8Array.of(3, 8), t.sessionId);
  if (t.clientAddr !== undefined) {
    const ip = parseIp(t.clientAddr.ip);
    if (!ip) throw new EncodeError("client_addr: IP inválida");
    const v = concatBytes([Uint8Array.of(ip.version), ip.bytes, u16b(t.clientAddr.port)]);
    ext.push(Uint8Array.of(4, v.length), v);
  }
  if (t.maxDatagram !== undefined) ext.push(Uint8Array.of(5, 2), u16b(t.maxDatagram));
  if (t.idleTimeout !== undefined) ext.push(Uint8Array.of(6, 2), u16b(t.idleTimeout));
  if (t.padding !== undefined && t.padding > 0) ext.push(Uint8Array.of(0x80, t.padding), new Uint8Array(t.padding));
  const extBytes = concatBytes(ext);
  return concatBytes([
    asciiToBytes("CAPR"),
    Uint8Array.of(f.version, f.status),
    u16b(f.code),
    Uint8Array.of(msg.length),
    msg,
    u16b(extBytes.length),
    extBytes,
  ]);
}

/** Decodifica CAPR (PROTOCOL.md §6). `eof` = el flujo terminó. Nunca lanza. */
export function decodeResponse(data: Uint8Array, eof: boolean): ResponseDecodeResult {
  const n = data.length;
  const short = (): ResponseDecodeResult => (eof ? rerr("truncated") : { kind: "incomplete" });
  if (n < 9) return short();
  if (data[0] !== 0x43 || data[1] !== 0x41 || data[2] !== 0x50 || data[3] !== 0x52) return rerr("bad_magic");
  const ver = data[4] as number;
  const status = data[5] as number;
  if (ver < 1) return rerr("bad_version");
  const code = ((data[6] as number) << 8) | (data[7] as number);
  const ml = data[8] as number;
  if (ml > 120) return rerr("msg_too_long");
  if (n < 9 + ml + 2) return short();
  const rawMsg = data.subarray(9, 9 + ml);
  for (let i = 0; i < rawMsg.length; i++) {
    const b = rawMsg[i] as number;
    if (b < 0x20 || b > 0x7e) return rerr("bad_msg");
  }
  const el = ((data[9 + ml] as number) << 8) | (data[10 + ml] as number);
  if (el > 256) return rerr("ext_too_long");
  const total = 11 + ml + el;
  if (n < total) return short();
  const ext = data.subarray(11 + ml, total);
  const tlvs: ResponseTlvs = {};
  const seen = new Set<number>();
  let cur = 0;
  while (cur < ext.length) {
    if (cur + 2 > ext.length) return rerr("bad_ext");
    const t = ext[cur] as number;
    const ln = ext[cur + 1] as number;
    cur += 2;
    if (cur + ln > ext.length) return rerr("bad_ext");
    const v = ext.subarray(cur, cur + ln);
    cur += ln;
    if (t >= 1 && t <= 6) {
      if (seen.has(t)) return rerr("bad_ext");
      seen.add(t);
    }
    switch (t) {
      case 1:
        if (ln !== 1) return rerr("bad_ext");
        tlvs.maxVersion = v[0] as number;
        break;
      case 2:
        if (ln !== 2) return rerr("bad_ext");
        tlvs.retryAfter = ((v[0] as number) << 8) | (v[1] as number);
        break;
      case 3:
        if (ln !== 8) return rerr("bad_ext");
        tlvs.sessionId = v.slice();
        break;
      case 4: {
        let ip: string;
        if (ln === 7 && v[0] === 4) ip = formatIPv4(v.subarray(1, 5));
        else if (ln === 19 && v[0] === 6) ip = formatIPv6(v.subarray(1, 17));
        else return rerr("bad_ext");
        tlvs.clientAddr = { ip, port: ((v[ln - 2] as number) << 8) | (v[ln - 1] as number) };
        break;
      }
      case 5:
        if (ln !== 2) return rerr("bad_ext");
        tlvs.maxDatagram = ((v[0] as number) << 8) | (v[1] as number);
        break;
      case 6:
        if (ln !== 2) return rerr("bad_ext");
        tlvs.idleTimeout = ((v[0] as number) << 8) | (v[1] as number);
        break;
      default:
        break; // desconocidas: se ignoran
    }
  }
  return {
    kind: "ok",
    consumed: total,
    fields: { version: ver, status, code, msg: String.fromCharCode(...rawMsg), tlvs },
  };
}

// ---------------------------------------------------------------- UDP sobre flujo

/** Tope fijo de datagrama en transport 2 (PROTOCOL.md §10.3). */
export const MAX_DATAGRAM_STREAM = 2048;

/** Trama len16 para un datagrama (1..2048). `encodeKeepalive()` para len=0. */
export function encodeFrame(datagram: Uint8Array): Uint8Array {
  if (datagram.length < 1 || datagram.length > MAX_DATAGRAM_STREAM) {
    throw new EncodeError("datagrama fuera de 1..2048 bytes");
  }
  const out = new Uint8Array(2 + datagram.length);
  out[0] = datagram.length >> 8;
  out[1] = datagram.length & 0xff;
  out.set(datagram, 2);
  return out;
}

export function encodeKeepalive(): Uint8Array {
  return new Uint8Array(2);
}

export interface FrameBatch {
  datagrams: Uint8Array[];
  keepalives: number;
}

export class FrameTooLargeError extends Error {
  constructor() {
    super("trama UDP mayor de 2048 bytes");
    this.name = "FrameTooLargeError";
  }
}

/** Decodificador incremental de tramas len16. `push` lanza `FrameTooLargeError` si len > 2048. */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  /** Bytes de una trama aún incompleta. */
  get pending(): number {
    return this.buf.length;
  }

  push(chunk: Uint8Array): FrameBatch {
    this.buf = this.buf.length === 0 ? chunk : concatBytes([this.buf, chunk]);
    const datagrams: Uint8Array[] = [];
    let keepalives = 0;
    let cur = 0;
    for (;;) {
      if (this.buf.length - cur < 2) break;
      const n = ((this.buf[cur] as number) << 8) | (this.buf[cur + 1] as number);
      if (n > MAX_DATAGRAM_STREAM) throw new FrameTooLargeError();
      if (this.buf.length - cur - 2 < n) break;
      if (n === 0) keepalives++;
      else datagrams.push(this.buf.slice(cur + 2, cur + 2 + n));
      cur += 2 + n;
    }
    this.buf = this.buf.slice(cur);
    return { datagrams, keepalives };
  }
}

export { bytesToHex, hexToBytes };
