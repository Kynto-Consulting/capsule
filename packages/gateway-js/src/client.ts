/** Cliente de túnel capsule/1 para Node: TLS 1.3 + ALPN + CAP1/CAPR (PROTOCOL.md §3-§9). */

import { randomBytes } from "node:crypto";
import type { LookupFunction } from "node:net";
import tls from "node:tls";

import { concatBytes } from "./bytes";
import { authTypeOf, decodeResponse, encodeRequest, type ResponseFields } from "./codec";
import {
  AbortedError,
  CapsuleError,
  ConfigError,
  ProtocolError,
  TlsError,
  TruncatedError,
  Unavailable,
  errorFromResponse,
} from "./errors";
import { parseUri, type ParsedUri } from "./uri";

export const ALPN = "capsule/1";
export const DEFAULT_CLIENT_ID = "capsule-js/0.1.0";

export type TokenSource = string | (() => string | Promise<string>);

export interface RetryOptions {
  /** Intentos totales (incluido el primero). Por defecto 5. */
  maxAttempts?: number;
  /** Retardo inicial en ms. Por defecto 500. */
  initialDelayMs?: number;
  /** Factor de crecimiento. Por defecto 2. */
  factor?: number;
  /** Tope del retardo en ms. Por defecto 30000. */
  maxDelayMs?: number;
  /** Jitter relativo (+-). Por defecto 0.2. */
  jitter?: number;
}

export interface ConnectOptions {
  /** Token `cap_`/`cgt_`/`cgc_`/`cgs_`, o función que lo entrega (permite renovar `cgc_` al expirar). Por defecto `CAPSULE_TOKEN`. */
  token?: TokenSource;
  /** Zona por defecto cuando el URI no la indica. Por defecto `CAPSULE_GATEWAY_ZONE` o `apps.tumi-ai.com`. */
  defaultZone?: string;
  /** Opciones TLS adicionales (p. ej. `ca` para despliegues privados). Se ignoran las que debilitan el protocolo. */
  tlsOptions?: tls.ConnectionOptions;
  /** Cancelación. Cancela intentos, esperas y destruye el socket (también después de conectar). */
  signal?: AbortSignal;
  /** Plazo para establecer TCP (ms). Por defecto 10000. */
  connectTimeoutMs?: number;
  /** Plazo del handshake TLS (ms). Por defecto 10000. */
  handshakeTimeoutMs?: number;
  /** Plazo de espera de CAPR desde el envío del encabezado (ms). Por defecto 20000. */
  responseTimeoutMs?: number;
  /** Reintentos automáticos de errores reintentables (PROTOCOL.md §7). `false` los desactiva. */
  retry?: RetryOptions | false;
  /** Identificador informativo (TLV 0x02). `false` lo omite. */
  clientId?: string | false;
  /** Pide la dirección de origen que ve el gateway (flag want_proxy_info). */
  wantProxyInfo?: boolean;
  /** Relleno (TLV 0x80) para ocultar la longitud del token. */
  padding?: number;
  /** Función de resolución DNS personalizada (pruebas, resolvedores propios). */
  lookup?: LookupFunction;
  /**
   * SOLO PRUEBAS: desactiva la verificación del certificado. Se rechaza si el host
   * no es `localhost`, una IP de bucle local o un nombre `.test`/`.localhost` (PROTOCOL.md §4).
   */
  insecureSkipVerifyForTest?: boolean;
}

/** Socket TLS ya enrutado: los bytes son transparentes (transport 1) o tramas len16 (transport 2). */
export type CapsuleSocket = tls.TLSSocket & { capsule: ResponseFields };

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxAttempts: 5,
  initialDelayMs: 500,
  factor: 2,
  maxDelayMs: 30_000,
  jitter: 0.2,
};

/** Token del entorno `CAPSULE_TOKEN`. Lanza ConfigError si no existe. */
export function tokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const t = env["CAPSULE_TOKEN"];
  if (!t) throw new ConfigError("falta el token: defina CAPSULE_TOKEN o pase options.token");
  return t;
}

function defaultZoneFromEnv(opts: ConnectOptions): string | undefined {
  return opts.defaultZone ?? process.env["CAPSULE_GATEWAY_ZONE"] ?? undefined;
}

export function resolveUri(uri: string | ParsedUri, opts: ConnectOptions = {}): ParsedUri {
  if (typeof uri !== "string") return uri;
  const zone = defaultZoneFromEnv(opts);
  return parseUri(uri, zone === undefined ? {} : { defaultZone: zone });
}

function isLocalTestHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost") || h.endsWith(".test");
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "ENODATA",
  "ESERVFAIL",
  "ENOENT",
]);

/** ¿El error de Node indica fin de flujo TLS sin close_notify? */
export function isUnexpectedEof(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ERR_SSL_UNEXPECTED_EOF_WHILE_READING" || code === "ECONNRESET";
}

function classifyConnectError(e: unknown, phase: string): CapsuleError {
  if (e instanceof CapsuleError) return e;
  const code = (e as { code?: string } | null)?.code ?? "";
  const msg = (e as { message?: string } | null)?.message ?? String(e);
  if (NETWORK_CODES.has(code) || phase !== "handshake TLS") {
    return new Unavailable(`${phase}: ${code || msg}`, { retryable: true, cause: e });
  }
  return new TlsError(`${phase}: ${code ? code + ": " : ""}${msg}`, { cause: e });
}

interface AttemptArgs {
  parsed: ParsedUri;
  transportNum: 1 | 2;
  token: string;
  opts: ConnectOptions;
  signal: AbortSignal | undefined;
}

function attemptOnce(a: AttemptArgs): Promise<CapsuleSocket> {
  const { parsed, transportNum, token, opts, signal } = a;
  const authType = authTypeOf(token);
  if (authType === undefined) throw new ConfigError("token con prefijo desconocido (se espera cap_, cgt_, cgc_ o cgs_)");

  const insecure = opts.insecureSkipVerifyForTest === true;
  if (insecure && !isLocalTestHost(parsed.connectHost) && !isLocalTestHost(parsed.sni)) {
    throw new ConfigError("insecureSkipVerifyForTest solo se permite contra localhost, IP de bucle local o nombres .test");
  }
  const userTls = { ...(opts.tlsOptions ?? {}) } as tls.ConnectionOptions;
  if (userTls.rejectUnauthorized === false && !insecure) {
    throw new ConfigError("no se permite rejectUnauthorized:false; la verificación del certificado es obligatoria");
  }
  for (const k of ["host", "port", "socket", "servername", "ALPNProtocols", "minVersion", "allowHalfOpen", "checkServerIdentity", "lookup", "family", "session"] as const) {
    delete (userTls as Record<string, unknown>)[k];
  }

  const nonce = randomBytes(16);
  const clientId = opts.clientId === false ? undefined : (opts.clientId ?? DEFAULT_CLIENT_ID);
  const header = encodeRequest({
    transport: transportNum,
    flags: opts.wantProxyInfo || transportNum === 2 ? 1 : 0,
    project: parsed.project,
    service: parsed.service,
    authType,
    auth: token,
    nonce: new Uint8Array(nonce),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(opts.padding !== undefined ? { padding: opts.padding } : {}),
  });

  const connectTimeout = opts.connectTimeoutMs ?? 10_000;
  const handshakeTimeout = opts.handshakeTimeoutMs ?? 10_000;
  const responseTimeout = opts.responseTimeoutMs ?? 20_000;

  return new Promise<CapsuleSocket>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const connectOpts: tls.ConnectionOptions & { allowHalfOpen: boolean; family: number; autoSelectFamily: boolean; autoSelectFamilyAttemptTimeout: number } = {
      ...userTls,
      host: parsed.connectHost,
      port: parsed.connectPort,
      servername: parsed.sni,
      ALPNProtocols: [ALPN],
      minVersion: "TLSv1.3",
      allowHalfOpen: true,
      rejectUnauthorized: !insecure,
      family: parsed.family === "4" ? 4 : parsed.family === "6" ? 6 : 0,
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
      ...(opts.lookup ? { lookup: opts.lookup } : {}),
    };
    const sock = tls.connect(connectOpts);

    let settled = false;
    let phase = "conexión TCP";
    let timer: NodeJS.Timeout | undefined;
    let buf: Uint8Array = new Uint8Array(0);

    const clearTimer = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const cleanup = (): void => {
      clearTimer();
      sock.off("readable", onReadable);
      sock.off("end", onEnd);
      sock.off("close", onClose);
      sock.off("error", onError);
      sock.off("connect", onConnect);
      sock.off("secureConnect", onSecure);
      signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: CapsuleError): void => {
      if (settled) return;
      settled = true;
      cleanup();
      sock.on("error", () => undefined);
      sock.destroy();
      reject(err);
    };
    const arm = (ms: number, what: string): void => {
      clearTimer();
      timer = setTimeout(() => {
        fail(new Unavailable(`tiempo de espera agotado: ${what}`, { retryable: true }));
      }, ms);
    };

    const onAbort = (): void => fail(new AbortedError());
    const onError = (e: Error): void => fail(classifyConnectError(e, phase));
    const onClose = (): void => fail(new Unavailable("el gateway cerró la conexión sin responder", { retryable: true }));
    const onEnd = (): void => {
      if (buf.length === 0) {
        fail(new Unavailable("el gateway cerró la conexión sin responder", { retryable: true }));
      } else {
        fail(new ProtocolError("truncated", "respuesta CAPR truncada", { retryable: true }));
      }
    };
    const onConnect = (): void => {
      phase = "handshake TLS";
      arm(handshakeTimeout, "handshake TLS");
    };
    const onReadable = (): void => {
      if (settled) return;
      let chunk: Buffer | null;
      while ((chunk = sock.read() as Buffer | null) !== null) buf = concatBytes([buf, chunk]);
      const r = decodeResponse(buf, false);
      if (r.kind === "incomplete") return;
      if (r.kind === "error") {
        fail(new ProtocolError(r.error, `respuesta CAPR inválida: ${r.error}`, { retryable: true }));
        return;
      }
      const f = r.fields;
      if (f.status !== 0) {
        fail(errorFromResponse(f));
        return;
      }
      if (f.version !== 1) {
        fail(new ProtocolError("bad_version", "versión de respuesta inesperada", { retryable: false }));
        return;
      }
      // Éxito: devolver el resto de los bytes (datos del destino) al flujo.
      settled = true;
      // Se usa modo "readable" (no "data") para que, al quitar el oyente, el flujo vuelva a su
      // estado inicial y el llamador pueda usar on('data'), pipe() o for-await sin llamar a resume().
      const rest = buf.subarray(r.consumed);
      if (rest.length > 0) sock.unshift(Buffer.from(rest));
      cleanup();
      const out = sock as CapsuleSocket;
      out.capsule = f;
      annotateTruncation(sock);
      if (signal) {
        const ab = (): void => {
          sock.destroy(new AbortedError());
        };
        if (signal.aborted) ab();
        else {
          signal.addEventListener("abort", ab, { once: true });
          sock.once("close", () => signal.removeEventListener("abort", ab));
        }
      }
      resolve(out);
    };
    const onSecure = (): void => {
      if (sock.alpnProtocol !== ALPN) {
        fail(new TlsError("el gateway no seleccionó el protocolo ALPN capsule/1"));
        return;
      }
      if (sock.getProtocol() !== "TLSv1.3") {
        fail(new TlsError("se exige TLS 1.3"));
        return;
      }
      phase = "espera de CAPR";
      arm(responseTimeout, "respuesta CAPR");
      sock.on("readable", onReadable);
      sock.write(header);
    };

    sock.once("connect", onConnect);
    sock.once("secureConnect", onSecure);
    sock.once("error", onError);
    sock.once("close", onClose);
    sock.once("end", onEnd);
    signal?.addEventListener("abort", onAbort, { once: true });
    arm(connectTimeout, "conexión TCP");
  });
}

/** Marca el error de fin inesperado (sin close_notify) como `Truncated` para el consumidor. */
function annotateTruncation(sock: tls.TLSSocket): void {
  sock.prependListener("error", (e: Error) => {
    if (e instanceof CapsuleError) return;
    if (isUnexpectedEof(e)) {
      const t = new TruncatedError("el gateway cerró el flujo sin close_notify (truncado)", { cause: e });
      (e as Error & { capsuleError?: CapsuleError }).capsuleError = t;
      e.name = "TruncatedError";
      e.message = t.message;
      (e as Error & { kind?: string }).kind = "Truncated";
    }
  });
}

/** ¿Este error de socket significa fin sin cierre ordenado? */
export function isTruncated(err: unknown): boolean {
  return (err as { kind?: string } | null)?.kind === "Truncated" || err instanceof TruncatedError;
}

function backoffDelay(n: number, r: Required<RetryOptions>, retryAfterSec: number | undefined): number {
  const base = Math.min(r.maxDelayMs, r.initialDelayMs * Math.pow(r.factor, n - 1));
  const jit = 1 + (Math.random() * 2 - 1) * r.jitter;
  let d = base * jit;
  if (retryAfterSec !== undefined) d = Math.max(d, retryAfterSec * 1000);
  return d;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", ab);
      resolve();
    }, ms);
    const ab = (): void => {
      clearTimeout(t);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", ab, { once: true });
  });
}

async function resolveToken(src: TokenSource | undefined): Promise<string> {
  const s = src ?? tokenFromEnv();
  const t = typeof s === "function" ? await s() : s;
  if (typeof t !== "string" || t.length === 0) throw new ConfigError("token vacío");
  return t;
}

/** Abre el túnel con reintentos (uso interno de connect/connectUdp). */
export async function dialGateway(parsed: ParsedUri, transportNum: 1 | 2, opts: ConnectOptions): Promise<CapsuleSocket> {
  const r: Required<RetryOptions> = { ...DEFAULT_RETRY, ...(opts.retry === false ? { maxAttempts: 1 } : (opts.retry ?? {})) };
  let attempt = 0;
  let protocolRetries = 0;
  let badRequestRetries = 0;
  let renewed = false;
  for (;;) {
    attempt++;
    if (opts.signal?.aborted) throw new AbortedError();
    const token = await resolveToken(opts.token);
    try {
      return await attemptOnce({ parsed, transportNum, token, opts, signal: opts.signal });
    } catch (e) {
      if (!(e instanceof CapsuleError)) throw e;
      // Renovación de cgc_ expirado: una vez, solo si el token viene de una función.
      if (e.kind === "TokenExpired" && typeof opts.token === "function" && !renewed) {
        renewed = true;
        attempt--;
        continue;
      }
      let retry = e.retryable;
      if (e instanceof ProtocolError) {
        retry = retry && protocolRetries++ < 1;
      } else if (e.kind === "BadRequest") {
        retry = retry && badRequestRetries++ < 1; // 0x010A: una sola vez
      }
      if (!retry || attempt >= r.maxAttempts) throw e;
      await sleep(backoffDelay(attempt, r, e.retryAfter), opts.signal);
    }
  }
}

/**
 * Abre un túnel TCP a `capsule://proyecto/servicio` y devuelve un socket TLS por el que
 * los bytes viajan sin cambios. `socket.end()` envía `close_notify` (half-close) y sigue
 * pudiendo leerse hasta que el destino cierre.
 */
export async function connect(uri: string | ParsedUri, opts: ConnectOptions = {}): Promise<CapsuleSocket> {
  const parsed = resolveUri(uri, opts);
  if (parsed.transport !== "tcp") {
    throw new ConfigError("connect() es para transport=tcp; use connectUdp() con transport=udp");
  }
  return dialGateway(parsed, 1, opts);
}
