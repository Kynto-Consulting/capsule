/**
 * Servidor-túnel de referencia en memoria para las pruebas: TLS 1.3 con certificado autofirmado
 * (test/fixtures, solo para pruebas), decodifica CAP1 con el algoritmo normativo y responde CAPR.
 */
import { readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

import { decodeRequest, encodeResponse, type DecodedRequest, type ResponseFields, type ResponseTlvs } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
export const CERT = readFileSync(join(here, "fixtures", "test-cert.pem"), "utf8");
export const KEY = readFileSync(join(here, "fixtures", "test-key.pem"), "utf8");

export type Handler = (req: DecodedRequest, sock: tls.TLSSocket, rest: Buffer, ctx: RefServer) => void;

export interface RefOptions {
  host?: string;
  handler?: Handler;
  tlsOptions?: tls.TlsOptions;
}

export function okResponse(tlvs: ResponseTlvs = {}): Uint8Array {
  return encodeResponse({ version: 1, status: 0, code: 0, msg: "ok", tlvs });
}

export function errResponse(status: number, code: number, msg = "x", tlvs: ResponseTlvs = {}): Uint8Array {
  return encodeResponse({ version: 1, status, code, msg, tlvs } as ResponseFields);
}

/** Eco con half-close: tras OK, devuelve lo que recibe; al fin de escritura del cliente cierra la suya. */
export const echoHandler: Handler = (_req, sock, rest) => {
  sock.write(okResponse());
  if (rest.length) sock.write(rest);
  sock.on("data", (d) => sock.write(d));
  sock.on("end", () => sock.end());
};

export class RefServer {
  readonly server: tls.Server;
  readonly seen: DecodedRequest[] = [];
  readonly sockets = new Set<net.Socket>();
  handler: Handler;
  connections = 0;
  port = 0;
  host: string;

  constructor(opts: RefOptions) {
    this.handler = opts.handler ?? echoHandler;
    this.host = opts.host ?? "127.0.0.1";
    this.server = tls.createServer(
      {
        key: KEY,
        cert: CERT,
        minVersion: "TLSv1.3",
        ALPNProtocols: ["capsule/1"],
        allowHalfOpen: true,
        ...(opts.tlsOptions ?? {}),
      },
      (sock) => this.onConnection(sock),
    );
    this.server.on("tlsClientError", () => undefined);
    // Sockets TCP en bruto (incluidos handshakes que no llegaron a completarse) para poder cerrarlos siempre.
    this.server.on("connection", (raw: net.Socket) => {
      this.sockets.add(raw);
      raw.on("error", () => undefined);
      raw.once("close", () => this.sockets.delete(raw));
    });
  }

  private onConnection(sock: tls.TLSSocket): void {
    this.connections++;
    this.sockets.add(sock);
    sock.once("close", () => this.sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buf = Buffer.concat([buf, chunk]);
      const r = decodeRequest(buf, false);
      if (r.kind === "incomplete") return;
      sock.off("data", onData);
      sock.off("end", onEnd);
      if (r.kind === "error") {
        sock.write(errResponse(r.status, r.code, "bad request"));
        sock.end();
        return;
      }
      this.seen.push(r.fields);
      this.handler(r.fields, sock, buf.subarray(r.consumed), this);
    };
    const onEnd = (): void => {
      const r = decodeRequest(buf, true);
      if (r.kind === "error") sock.write(errResponse(r.status, r.code, "bad request"));
      sock.end();
    };
    sock.on("data", onData);
    sock.once("end", onEnd);
  }

  async listen(port = 0): Promise<this> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen({ host: this.host, port }, () => resolve());
    });
    this.port = (this.server.address() as net.AddressInfo).port;
    return this;
  }

  close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

export async function startRef(opts: RefOptions = {}): Promise<RefServer> {
  return new RefServer(opts).listen();
}

/** URI que apunta directamente al servidor de referencia. */
export function refUri(s: RefServer, extra = "", project = "mi-proyecto", service = "db"): string {
  const host = s.host.includes(":") ? `%5B${s.host}%5D` : s.host;
  return `capsule://${project}/${service}?gateway=${host}:${s.port}&sni=localhost${extra}`;
}

export const TOKEN = "cap_" + "A".repeat(43);

export async function canListenIPv6(): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ host: "::1", port: 0 }, () => s.close(() => resolve(true)));
  });
}

/** Lee todo hasta EOF. */
export async function readAll(s: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of s) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
