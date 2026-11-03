/**
 * Entrada para navegador (`@kyntocg/capsule-gateway/browser`).
 *
 * Un navegador no puede abrir sockets TCP crudos ni establecer TLS con ALPN `capsule/1`, así que
 * `connect` no existe aquí. PROTOCOL.md (norma) no define un transporte WebSocket; solo PLAN.md §10
 * lo menciona sin endpoint ni formato definitivos, por lo que no se implementa. Esta entrada expone las
 * piezas puras (URI, códec CAP1/CAPR, tramas UDP, errores) y la interfaz `BrowserTransport`, para que un
 * transporte WebSocket futuro pueda enchufarse sin cambiar el resto.
 */

import { CapsuleError } from "./errors";

export * from "./bytes";
export * from "./codec";
export * from "./errors";
export * from "./ip";
export * from "./uri";

/** Flujo bidireccional de bytes que un transporte de navegador debe ofrecer. */
export interface BrowserTransport {
  send(data: Uint8Array): void | Promise<void>;
  onData(handler: (data: Uint8Array) => void): void;
  onClose(handler: (err?: Error) => void): void;
  /** Cierre de escritura (half-close), si el transporte lo permite. */
  closeWrite?(): void | Promise<void>;
  close(): void;
}

export class UnsupportedEnvironment extends CapsuleError {
  constructor(message: string) {
    super("UnsupportedEnvironment", message);
  }
}

/** Siempre lanza: el navegador no puede abrir TCP crudo. Use Node o el CLI de Capsule. */
export function connect(): never {
  throw new UnsupportedEnvironment(
    "el navegador no puede abrir TCP crudo ni TLS con ALPN capsule/1; use Node.js o el CLI (capsule tunnel). " +
      "No hay transporte WebSocket normado todavía.",
  );
}
