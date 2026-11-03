/** Analizador/serializador del URI `capsule://<proyecto>/<servicio>` (PROTOCOL.md §2). Sin dependencias de Node. */

import { UriError, type UriErrorKind } from "./errors";
import { formatIPv4, formatIPv6, parseIPv4, parseIPv6 } from "./ip";

export type Transport = "tcp" | "udp";
export type Family = "4" | "6" | "any";

export interface ParsedUri {
  project: string;
  service: string;
  transport: Transport;
  family: Family;
  /** Host al que se conecta el socket (nombre DNS o IP literal canónica, sin corchetes). */
  connectHost: string;
  connectPort: number;
  /** Nombre para SNI y validación de certificado. */
  sni: string;
}

export interface ParseUriOptions {
  /** Zona por defecto (`CAPSULE_GATEWAY_ZONE`). Por defecto `apps.tumi-ai.com`. */
  defaultZone?: string;
}

export const DEFAULT_ZONE = "apps.tumi-ai.com";

const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const KEY_RE = /^[a-z0-9_-]+$/;

export function isValidName(s: string): boolean {
  return s.length <= 63 && NAME_RE.test(s);
}

function isDnsName(s: string): boolean {
  if (s.length === 0 || s.length > 253) return false;
  return s.split(".").every((l) => NAME_RE.test(l));
}

function fail(kind: UriErrorKind): never {
  throw new UriError(kind);
}

/** Decodifica %XX una sola vez; el resultado debe ser ASCII visible (0x21..0x7E). */
function pct(s: string): string {
  const out: number[] = [];
  let nonAscii = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (c === "%") {
      const h = s.slice(i + 1, i + 3);
      if (h.length !== 2 || !/^[0-9A-Fa-f]{2}$/.test(h)) fail("bad_escape");
      out.push(parseInt(h, 16));
      i += 3;
    } else {
      const cp = s.codePointAt(i) as number;
      if (cp > 0x7f) {
        nonAscii = true;
      } else {
        out.push(cp);
      }
      i += cp > 0xffff ? 2 : 1;
    }
  }
  if (nonAscii) fail("bad_param");
  let r = "";
  for (const b of out) {
    if (b > 0x7f) fail("bad_param");
    r += String.fromCharCode(b);
  }
  for (let k = 0; k < r.length; k++) {
    const cc = r.charCodeAt(k);
    if (cc < 0x21 || cc === 0x7f) fail("bad_param");
  }
  return r;
}

function parsePort(p: string): number {
  if (!/^[0-9]{1,5}$/.test(p)) fail("bad_gateway");
  const n = Number(p);
  if (n < 1 || n > 65535) fail("bad_gateway");
  return n;
}

function parseGateway(v: string): { host: string; port: number; literal: boolean } {
  let port = 443;
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end < 0) fail("bad_gateway");
    const host = v.slice(1, end);
    const rest = v.slice(end + 1);
    if (host.includes("%")) fail("bad_gateway");
    const ip = parseIPv6(host);
    if (!ip) fail("bad_gateway");
    if (rest) {
      if (!rest.startsWith(":")) fail("bad_gateway");
      port = parsePort(rest.slice(1));
    }
    return { host: formatIPv6(ip), port, literal: true };
  }
  if (v.split(":").length - 1 > 1) fail("bad_gateway");
  let host = v;
  if (v.includes(":")) {
    const idx = v.indexOf(":");
    host = v.slice(0, idx);
    port = parsePort(v.slice(idx + 1));
  }
  if (/^[0-9.]+$/.test(host)) {
    const ip = parseIPv4(host);
    if (!ip) fail("bad_gateway");
    return { host: formatIPv4(ip), port, literal: true };
  }
  if (!isDnsName(host)) fail("bad_gateway");
  return { host, port, literal: false };
}

/**
 * Analiza un URI `capsule://`. Lanza `UriError` con el nombre normativo (`reason`).
 * Estricto: no normaliza mayúsculas, no admite userinfo, puerto, fragmento ni barra final.
 */
export function parseUri(uri: string, options: ParseUriOptions = {}): ParsedUri {
  const defaultZone = options.defaultZone ?? DEFAULT_ZONE;
  if (typeof uri !== "string" || uri.slice(0, 10).toLowerCase() !== "capsule://") fail("bad_scheme");
  let rest = uri.slice(10);
  if (rest.includes("#")) fail("fragment");
  let query: string | null = null;
  const q = rest.indexOf("?");
  if (q >= 0) {
    query = rest.slice(q + 1);
    rest = rest.slice(0, q);
  }
  let proj: string;
  let svc: string | null;
  const slash = rest.indexOf("/");
  if (slash < 0) {
    proj = rest;
    svc = null;
  } else {
    proj = rest.slice(0, slash);
    svc = rest.slice(slash + 1);
  }
  if (proj.includes("@")) fail("userinfo");
  if (proj.includes(":")) fail("port");
  if (!isValidName(proj)) fail("bad_project");
  if (svc === null || svc.includes("/")) fail("bad_path");
  if (!isValidName(svc)) fail("bad_service");

  const params = new Map<string, string | null>();
  if (query !== null) {
    if (query === "") fail("bad_param");
    for (const part of query.split("&")) {
      const eq = part.indexOf("=");
      if (eq < 0) fail("bad_param");
      const k = part.slice(0, eq);
      const v = part.slice(eq + 1);
      if (!KEY_RE.test(k) || v === "") fail("bad_param");
      if (params.has(k)) fail("dup_param");
      if (k.startsWith("x-")) {
        params.set(k, null);
        continue;
      }
      if (k !== "transport" && k !== "family" && k !== "zone" && k !== "gateway" && k !== "sni") {
        fail("unknown_param");
      }
      params.set(k, pct(v));
    }
  }
  const transport = params.get("transport") ?? "tcp";
  if (transport !== "tcp" && transport !== "udp") fail("bad_param");
  const family = params.get("family") ?? "any";
  if (family !== "4" && family !== "6" && family !== "any") fail("bad_param");
  if (params.has("gateway") && params.has("zone")) fail("bad_param");
  let sni = params.get("sni") ?? undefined;
  if (sni !== undefined && !isDnsName(sni)) fail("bad_param");

  let host: string;
  let port: number;
  const gw = params.get("gateway");
  if (gw !== undefined && gw !== null) {
    const g = parseGateway(gw);
    if (g.literal && sni === undefined) fail("sni_required");
    host = g.host;
    port = g.port;
    sni = sni ?? host;
  } else {
    const zone = params.get("zone") ?? defaultZone;
    if (!isDnsName(zone) || !zone.includes(".")) fail("bad_param");
    host = `${transport}.${zone}`;
    port = 443;
    sni = sni ?? host;
  }
  return { project: proj, service: svc, transport, family, connectHost: host, connectPort: port, sni };
}

export interface UriParts {
  project: string;
  service: string;
  transport?: Transport;
  family?: Family;
  zone?: string;
  /** `host[:puerto]`; IPv6 como `[2001:db8::1]:8443`. Excluyente con `zone`. */
  gateway?: string;
  sni?: string;
}

/** Serializa un URI `capsule://` canónico (con `[`/`]` codificados como `%5B`/`%5D`). Valida con `parseUri`. */
export function formatUri(p: UriParts): string {
  const q: string[] = [];
  if (p.transport !== undefined && p.transport !== "tcp") q.push(`transport=${p.transport}`);
  if (p.family !== undefined && p.family !== "any") q.push(`family=${p.family}`);
  if (p.zone !== undefined) q.push(`zone=${p.zone}`);
  if (p.gateway !== undefined) q.push(`gateway=${p.gateway.replace(/\[/g, "%5B").replace(/\]/g, "%5D")}`);
  if (p.sni !== undefined) q.push(`sni=${p.sni}`);
  const uri = `capsule://${p.project}/${p.service}${q.length ? "?" + q.join("&") : ""}`;
  parseUri(uri); // valida (lanza UriError)
  return uri;
}
