/** UDP sobre flujo (transport 2): sesión de datagramas len16 sobre el túnel TLS (PROTOCOL.md §8.4, §10). */

import { EventEmitter } from "node:events";

import { dialGateway, resolveUri, type CapsuleSocket, type ConnectOptions } from "./client";
import {
  FrameDecoder,
  FrameTooLargeError,
  MAX_DATAGRAM_STREAM,
  encodeFrame,
  encodeKeepalive,
  type ResponseTlvs,
} from "./codec";
import { CapsuleError, ConfigError, ProtocolError, TruncatedError } from "./errors";
import type { ParsedUri } from "./uri";

export interface UdpSessionEvents {
  message: [datagram: Buffer];
  error: [err: Error];
  close: [];
}

/** Una conexión = una sesión UDP hacia el destino (un solo 5-tuple, puerto de origen estable). */
export class UdpSession extends EventEmitter<UdpSessionEvents> {
  /** Identificador de sesión (TLV 0x03), solo para correlación con la auditoría. */
  readonly sessionId: Uint8Array | undefined;
  /** Dirección de origen que ve el gateway (TLV 0x04), si se pidió. */
  readonly clientAddr: { ip: string; port: number } | undefined;
  /** Tamaño máximo de datagrama aceptado (TLV 0x05); como mucho 2048. */
  readonly maxDatagram: number;
  /** Inactividad tras la cual el gateway cierra la sesión (TLV 0x06, s). */
  readonly idleTimeout: number;
  private readonly socket: CapsuleSocket;
  private readonly decoder = new FrameDecoder();
  private ka: NodeJS.Timeout | undefined;
  private lastSent = Date.now();
  private closed = false;

  constructor(socket: CapsuleSocket) {
    super();
    this.socket = socket;
    const t: ResponseTlvs = socket.capsule.tlvs;
    this.sessionId = t.sessionId;
    this.clientAddr = t.clientAddr;
    this.maxDatagram = Math.min(t.maxDatagram ?? MAX_DATAGRAM_STREAM, MAX_DATAGRAM_STREAM);
    this.idleTimeout = t.idleTimeout ?? 60;

    socket.on("data", (chunk: Buffer) => {
      try {
        const b = this.decoder.push(chunk);
        for (const d of b.datagrams) this.emit("message", Buffer.from(d));
      } catch (e) {
        const err = e instanceof FrameTooLargeError ? new ProtocolError("frame_too_large", "trama UDP mayor de 2048 bytes") : (e as Error);
        this.fail(err);
      }
    });
    // Sin half-close en UDP: el cierre de cualquier lado termina la sesión.
    socket.on("end", () => {
      if (this.decoder.pending > 0) this.fail(new TruncatedError("el flujo terminó a mitad de una trama UDP"));
      else this.close();
    });
    socket.on("error", (e) => this.fail(e));
    socket.on("close", () => this.finish());
    socket.resume();

    const every = Math.max(1000, Math.floor((this.idleTimeout * 1000) / 3));
    this.ka = setInterval(() => {
      if (Date.now() - this.lastSent >= every) this.sendKeepalive();
    }, Math.max(250, Math.floor(every / 4)));
    this.ka.unref();
  }

  /** Envía un datagrama. Lanza RangeError si excede `maxDatagram`. */
  send(datagram: Uint8Array): void {
    if (this.closed) throw new CapsuleError("Closed", "la sesión UDP está cerrada");
    if (datagram.length > this.maxDatagram) {
      throw new RangeError(`datagrama de ${datagram.length} bytes excede max_datagram (${this.maxDatagram})`);
    }
    this.socket.write(encodeFrame(datagram));
    this.lastSent = Date.now();
  }

  /** Envía una trama de keepalive (len=0). */
  sendKeepalive(): void {
    if (this.closed) return;
    this.socket.write(encodeKeepalive());
    this.lastSent = Date.now();
  }

  close(): void {
    if (this.closed) return;
    this.socket.destroy();
    this.finish();
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.socket.destroy();
    this.finish();
    if (this.listenerCount("error") > 0) this.emit("error", err);
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ka) clearInterval(this.ka);
    this.emit("close");
  }
}

/** Abre una sesión UDP (transport 2) a `capsule://proyecto/servicio?transport=udp`. */
export async function connectUdp(uri: string | ParsedUri, opts: ConnectOptions = {}): Promise<UdpSession> {
  const parsed = resolveUri(uri, opts);
  if (parsed.transport !== "udp") throw new ConfigError("connectUdp() requiere transport=udp en el URI");
  const socket = await dialGateway(parsed, 2, opts);
  return new UdpSession(socket);
}
