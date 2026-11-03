/**
 * Errores tipados del cliente. La semántica de `retryable` sigue PROTOCOL.md §7.
 * Ningún error contiene el token.
 */

export type UriErrorKind =
  | "bad_scheme"
  | "fragment"
  | "userinfo"
  | "port"
  | "bad_project"
  | "bad_path"
  | "bad_service"
  | "bad_param"
  | "dup_param"
  | "unknown_param"
  | "bad_escape"
  | "bad_gateway"
  | "sni_required";

export type ResponseErrorKind =
  | "truncated"
  | "bad_magic"
  | "bad_version"
  | "msg_too_long"
  | "bad_msg"
  | "ext_too_long"
  | "bad_ext";

export interface CapsuleErrorInit {
  retryable?: boolean;
  status?: number;
  code?: number;
  retryAfter?: number;
  cause?: unknown;
}

/** Base de todos los errores de la librería. */
export class CapsuleError extends Error {
  /** Nombre estable de la clase de error (p. ej. "NotAuthorized"). */
  readonly kind: string;
  /** La librería PUEDE reintentar automáticamente (PROTOCOL.md §7). */
  readonly retryable: boolean;
  /** `status` de la respuesta CAPR, si el error vino del gateway. */
  readonly status: number | undefined;
  /** `code` de la respuesta CAPR (0xSSNN), si el error vino del gateway. */
  readonly code: number | undefined;
  /** Segundos sugeridos por el gateway (TLV retry_after). */
  readonly retryAfter: number | undefined;

  constructor(kind: string, message: string, init: CapsuleErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = kind;
    this.kind = kind;
    this.retryable = init.retryable ?? false;
    this.status = init.status;
    this.code = init.code;
    this.retryAfter = init.retryAfter;
  }
}

/** URI `capsule://` mal formado. `reason` es el nombre normativo (PROTOCOL.md §2.3). */
export class UriError extends CapsuleError {
  readonly reason: UriErrorKind;
  constructor(reason: UriErrorKind) {
    super("UriError", `URI capsule:// inválido: ${reason}`);
    this.reason = reason;
  }
}

/** Respuesta del gateway que viola el formato CAPR, o violación de ALPN/versión TLS. */
export class ProtocolError extends CapsuleError {
  readonly reason: string;
  constructor(reason: string, message?: string, init: CapsuleErrorInit = {}) {
    super("ProtocolError", message ?? `error de protocolo: ${reason}`, init);
    this.reason = reason;
  }
}

/** Fallo de TLS (certificado, versión, handshake). No reintentable. */
export class TlsError extends CapsuleError {
  constructor(message: string, init: CapsuleErrorInit = {}) {
    super("TlsError", message, init);
  }
}

/** El flujo terminó sin `close_notify` (truncamiento) o a mitad de un mensaje. */
export class TruncatedError extends CapsuleError {
  constructor(message = "el flujo terminó sin cierre ordenado (truncado)", init: CapsuleErrorInit = {}) {
    super("Truncated", message, init);
  }
}

/** La operación fue cancelada con `AbortSignal`. */
export class AbortedError extends CapsuleError {
  constructor(message = "operación cancelada") {
    super("Aborted", message);
  }
}

/** Error de configuración / argumentos inválidos del llamador. */
export class ConfigError extends CapsuleError {
  constructor(message: string) {
    super("ConfigError", message);
  }
}

/** Error devuelto por el gateway en CAPR (status != 0). */
export class GatewayError extends CapsuleError {
  readonly reason: string;
  constructor(kind: string, reason: string, init: CapsuleErrorInit) {
    super(
      kind,
      init.status === undefined
        ? `gateway: ${kind}: ${reason}`
        : `gateway: ${kind} (status ${init.status}, code 0x${(init.code ?? 0).toString(16).padStart(4, "0")}): ${reason}`,
      init,
    );
    this.reason = reason;
  }
}

export class UnsupportedVersion extends GatewayError {
  /** Versión máxima soportada por el gateway (TLV 0x01 / CAPR.version). */
  readonly maxVersion: number | undefined;
  constructor(reason: string, init: CapsuleErrorInit, maxVersion?: number) {
    super("UnsupportedVersion", reason, init);
    this.maxVersion = maxVersion;
  }
}
export class BadRequest extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("BadRequest", reason, init);
  }
}
export class UnsupportedTransport extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("UnsupportedTransport", reason, init);
  }
}
export class NotAuthorized extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("NotAuthorized", reason, init);
  }
}
export class TokenExpired extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("TokenExpired", reason, init);
  }
}
export class IpDenied extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("IpDenied", reason, init);
  }
}
export class Unavailable extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("Unavailable", reason, init);
  }
}
export class QuotaExceeded extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("QuotaExceeded", reason, init);
  }
}
export class GatewayBusy extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("GatewayBusy", reason, init);
  }
}
/** `status` no conocido: se decodifica y se trata como no reintentable (PROTOCOL.md §6). */
export class UnknownStatus extends GatewayError {
  constructor(reason: string, init: CapsuleErrorInit) {
    super("UnknownStatus", reason, init);
  }
}

export interface ResponseLike {
  version: number;
  status: number;
  code: number;
  msg: string;
  tlvs: { maxVersion?: number; retryAfter?: number };
}

/** Convierte una respuesta CAPR con status != 0 en el error tipado de PROTOCOL.md §7. */
export function errorFromResponse(r: ResponseLike): GatewayError {
  const base = { status: r.status, code: r.code, retryAfter: r.tlvs.retryAfter };
  const reason = r.msg;
  switch (r.status) {
    case 1:
      switch (r.code) {
        case 0x0101:
          return new UnsupportedVersion(reason, { ...base, retryable: false }, r.tlvs.maxVersion ?? r.version);
        case 0x0109:
          return new UnsupportedTransport(reason, { ...base, retryable: false });
        case 0x010a:
          // Reintentable una sola vez (lo limita el cliente).
          return new BadRequest(reason, { ...base, retryable: true });
        default:
          return new BadRequest(reason, { ...base, retryable: false });
      }
    case 2:
      if (r.code === 0x0202) return new TokenExpired(reason, { ...base, retryable: false });
      return new NotAuthorized(reason, { ...base, retryable: false });
    case 3:
      return new IpDenied(reason, { ...base, retryable: false });
    case 4:
      return new Unavailable(reason, { ...base, retryable: true });
    case 5:
      return new QuotaExceeded(reason, { ...base, retryable: true });
    case 6:
      return new GatewayBusy(reason, { ...base, retryable: true });
    default:
      return new UnknownStatus(reason, { ...base, retryable: false });
  }
}
