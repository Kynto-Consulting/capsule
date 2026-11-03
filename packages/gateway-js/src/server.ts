/** Servidor-túnel local: expone un puerto local y reenvía cada conexión por el túnel capsule/1. */

import { EventEmitter } from "node:events";
import net from "node:net";

import { connect, resolveUri, type CapsuleSocket, type ConnectOptions } from "./client";
import { ConfigError } from "./errors";
import type { ParsedUri } from "./uri";

export interface ListenOptions extends ConnectOptions {
  /** Dirección local. Por defecto `127.0.0.1`. */
  host?: string;
  /** Puerto local. Por defecto 0 (efímero). */
  port?: number;
  /**
   * El puerto local reenvía con las credenciales del proceso, así que por defecto solo
   * se admiten direcciones de bucle local. Ponga `true` para enlazar otra interfaz (bajo su responsabilidad).
   */
  allowNonLoopback?: boolean;
  /** Se invoca (sin token) cuando un túnel no pudo abrirse o se rompió. */
  onTunnelError?: (err: Error) => void;
}

export interface TunnelServerEvents {
  connection: [local: net.Socket];
  tunnelError: [err: Error];
  close: [];
}

function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export class TunnelServer extends EventEmitter<TunnelServerEvents> {
  private readonly server: net.Server;
  private readonly active = new Set<net.Socket>();

  /** @internal */
  constructor(server: net.Server) {
    super();
    this.server = server;
  }

  /** Dirección y puerto locales realmente enlazados. */
  get host(): string {
    return (this.server.address() as net.AddressInfo).address;
  }
  get port(): number {
    return (this.server.address() as net.AddressInfo).port;
  }
  address(): net.AddressInfo {
    return this.server.address() as net.AddressInfo;
  }
  /** Conexiones locales activas. */
  get connections(): number {
    return this.active.size;
  }

  /** @internal */
  track(s: net.Socket): void {
    this.active.add(s);
    s.once("close", () => this.active.delete(s));
  }

  /** Deja de aceptar y destruye las conexiones activas. */
  close(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.emit("close");
        resolve();
      });
      for (const s of this.active) s.destroy();
    });
  }
}

/**
 * Escucha en un puerto local y reenvía cada conexión a `capsule://proyecto/servicio`.
 * Cualquier cliente de base de datos puede conectar a `127.0.0.1:<puerto>`.
 */
export async function listen(uri: string | ParsedUri, opts: ListenOptions = {}): Promise<TunnelServer> {
  const parsed = resolveUri(uri, opts);
  if (parsed.transport !== "tcp") throw new ConfigError("listen() reenvía transport=tcp; para UDP use connectUdp()");
  const host = opts.host ?? "127.0.0.1";
  if (!opts.allowNonLoopback && !isLoopback(host)) {
    throw new ConfigError("listen() solo admite direcciones de bucle local salvo allowNonLoopback:true");
  }
  const { host: _h, port: _p, allowNonLoopback: _a, onTunnelError, ...connOpts } = opts;
  void _h;
  void _p;
  void _a;

  let tunnel!: TunnelServer;
  const report = (e: Error): void => {
    onTunnelError?.(e);
    tunnel.emit("tunnelError", e);
  };
  const server = net.createServer({ allowHalfOpen: true, pauseOnConnect: true }, (local) => {
    tunnel.track(local);
    tunnel.emit("connection", local);
    let remote: CapsuleSocket | undefined;
    let done = false;
    local.on("error", () => {
      local.destroy();
      remote?.destroy();
    });
    local.once("close", () => {
      done = true;
      remote?.destroy();
    });
    connect(parsed, connOpts).then(
      (r) => {
        if (done) {
          r.destroy();
          return;
        }
        remote = r;
        r.on("error", (e) => {
          report(e);
          local.destroy();
        });
        r.once("close", () => local.destroy());
        local.pipe(r); // fin de escritura local -> close_notify hacia el gateway (half-close)
        r.pipe(local); // fin del destino -> FIN hacia el cliente local
      },
      (e: Error) => {
        report(e);
        local.destroy();
      },
    );
  });
  tunnel = new TunnelServer(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port: opts.port ?? 0 }, () => {
      server.off("error", reject);
      resolve();
    });
  });
  server.on("error", (e) => report(e));
  return tunnel;
}

/** Alias de `listen`. */
export const forward = listen;
