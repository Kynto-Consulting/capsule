import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import type { Readable } from "node:stream";
import { socksConnect } from "./socks.js";
import { relayConnect } from "./relay.js";

export interface VpnHttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Readable;
  buffer(): Promise<Buffer>;
  text(): Promise<string>;
}

export interface VpnHttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs?: number;
}

export interface SftpOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  /** SHA-256 (hex) of the server host key; strongly recommended. */
  hostKeySha256?: string;
}

export interface SmbOptions {
  host: string;
  share: string;
  username: string;
  password: string;
  domain?: string;
  port?: number;
}

export interface Vpn {
  /** True when the function is attached to a tunnel. */
  readonly attached: boolean;
  /** Raw TCP connection to an address of the customer's network through the tunnel (there is no other route out). */
  connect(host: string, port: number): Promise<net.Socket>;
  /** Local 127.0.0.1 port that forwards to host:port through the tunnel, for any client library. Call close() when done. */
  forward(host: string, port: number): Promise<{ host: string; port: number; close(): Promise<void> }>;
  http(url: string, init?: VpnHttpInit): Promise<VpnHttpResponse>;
  /** SFTP over the tunnel (needs the optional peer dependency `ssh2`). */
  sftp(opts: SftpOptions): Promise<any>;
  /** SMB over the tunnel (needs the optional peer dependency `@marsaud/smb2`). */
  smb(opts: SmbOptions): Promise<any>;
}

/**
 * `socketPath` is the gateway's SOCKS endpoint of a container run; `relay` is how a Lambda run reaches the tunnel
 * (CAPSULE_VPN_RELAY + the run token). A function deployed without `--vpn` has neither.
 */
export function createVpn(socketPath: string | undefined, relay?: { url: string; token: string }): Vpn {
  const need = (): void => {
    if (!socketPath && !relay) throw new Error("this function is not attached to a VPN tunnel (deploy it with --vpn <name>)");
  };
  const connect = (host: string, port: number) => {
    need();
    return socketPath ? socksConnect(socketPath, host, port) : relayConnect(relay!.url, relay!.token, host, port);
  };

  const forward: Vpn["forward"] = async (host, port) => {
    need();
    const conns = new Set<net.Socket>();
    const srv = net.createServer((c) => {
      conns.add(c);
      c.once("close", () => conns.delete(c));
      connect(host, port).then(
        (up) => {
          conns.add(up);
          up.once("close", () => conns.delete(up));
          c.pipe(up).pipe(c);
          up.on("error", () => c.destroy());
          c.on("error", () => up.destroy());
        },
        () => c.destroy(),
      );
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    return {
      host: "127.0.0.1",
      port: (srv.address() as net.AddressInfo).port,
      close: () =>
        new Promise<void>((r) => {
          for (const c of conns) c.destroy();
          srv.close(() => r());
        }),
    };
  };

  const httpFn: Vpn["http"] = async (url, init = {}) => {
    need();
    const u = new URL(url);
    const secure = u.protocol === "https:";
    const port = Number(u.port || (secure ? 443 : 80));
    const mod = secure ? https : http;
    return new Promise<VpnHttpResponse>((resolve, reject) => {
      const req = mod.request(
        {
          method: init.method ?? "GET",
          host: u.hostname,
          port,
          path: u.pathname + u.search,
          headers: init.headers,
          timeout: init.timeoutMs ?? 60_000,
          // the only way out is the tunnel
          createConnection: ((_opts: unknown, cb: (err: Error | null, s?: net.Socket) => void) => {
            connect(u.hostname, port).then(
              (s) => {
                if (!secure) return cb(null, s);
                const t = tls.connect({ socket: s, servername: net.isIP(u.hostname) ? undefined : u.hostname });
                t.once("secureConnect", () => cb(null, t));
                t.once("error", (e) => cb(e));
              },
              (e) => cb(e),
            );
          }) as any,
        },
        (res) => {
          const body = res as unknown as Readable;
          const buffer = async () => {
            const chunks: Buffer[] = [];
            for await (const c of body) chunks.push(c as Buffer);
            return Buffer.concat(chunks);
          };
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, buffer, text: async () => (await buffer()).toString("utf8") });
        },
      );
      req.once("error", reject);
      req.once("timeout", () => req.destroy(new Error("vpn http: timeout")));
      if (init.body !== undefined) req.write(init.body);
      req.end();
    });
  };

  const sftp: Vpn["sftp"] = async (o) => {
    const sock = await connect(o.host, o.port ?? 22);
    // @ts-ignore optional peer dependency
    const { Client } = await import("ssh2");
    const conn = new Client();
    return new Promise((resolve, reject) => {
      conn.once("ready", () =>
        conn.sftp((err: Error | undefined, s: any) => (err ? reject(err) : resolve(Object.assign(s, { close: () => conn.end() })))),
      );
      conn.once("error", reject);
      conn.connect({
        sock,
        username: o.username,
        password: o.password,
        privateKey: o.privateKey,
        hostHash: o.hostKeySha256 ? "sha256" : undefined,
        hostVerifier: o.hostKeySha256 ? (h: string) => h.toLowerCase() === o.hostKeySha256!.toLowerCase() : undefined,
      });
    });
  };

  const smb: Vpn["smb"] = async (o) => {
    // The SMB client connects to a loopback port that the gateway forwards into the tunnel.
    const fwd = await forward(o.host, o.port ?? 445);
    // @ts-ignore optional peer dependency
    const mod: any = await import("@marsaud/smb2");
    const SMB2 = mod.default ?? mod;
    const client = new SMB2({
      share: `\\\\${fwd.host}\\${o.share}`,
      domain: o.domain ?? "",
      username: o.username,
      password: o.password,
      port: fwd.port,
      autoCloseTimeout: 0,
    });
    return Object.assign(client, {
      close: async () => {
        client.disconnect?.();
        await fwd.close();
      },
    });
  };

  return { attached: !!(socketPath || relay), connect, forward, http: httpFn, sftp, smb };
}
