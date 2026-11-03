import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import test from "node:test";
import tls from "node:tls";

import {
  AbortedError,
  BadRequest,
  CapsuleError,
  ConfigError,
  GatewayBusy,
  IpDenied,
  NotAuthorized,
  ProtocolError,
  QuotaExceeded,
  TlsError,
  TokenExpired,
  Unavailable,
  UnknownStatus,
  UnsupportedTransport,
  UnsupportedVersion,
  connect,
  connectUdp,
  encodeFrame,
  isTruncated,
  listen,
  FrameDecoder,
  type ConnectOptions,
} from "../src/index";
import * as browser from "../src/browser";
import {
  CERT,
  TOKEN,
  canListenIPv6,
  echoHandler,
  errResponse,
  okResponse,
  readAll,
  refUri,
  startRef,
  type RefServer,
} from "./refserver";

function opts(extra: ConnectOptions = {}): ConnectOptions {
  return { token: TOKEN, tlsOptions: { ca: CERT }, retry: false, ...extra };
}

async function withRef(fn: (s: RefServer) => Promise<void>, handler?: Parameters<typeof startRef>[0]): Promise<void> {
  const s = await startRef(handler);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

test("handshake OK: TLS 1.3, ALPN, encabezado correcto y eco", async () => {
  await withRef(async (s) => {
    const sock = await connect(refUri(s), opts({ wantProxyInfo: true }));
    assert.equal(sock.alpnProtocol, "capsule/1");
    assert.equal(sock.getProtocol(), "TLSv1.3");
    assert.equal(sock.capsule.status, 0);
    sock.write("hola");
    const got = await new Promise<Buffer>((res) => sock.once("data", res));
    assert.equal(got.toString(), "hola");
    sock.end();
    await readAll(sock);
    const req = s.seen[0];
    assert.ok(req);
    assert.equal(req.project, "mi-proyecto");
    assert.equal(req.service, "db");
    assert.equal(req.transport, 1);
    assert.equal(req.flags, 1);
    assert.equal(req.auth, TOKEN);
    assert.equal(req.authType, 1);
    assert.equal(req.nonce?.length, 16);
    assert.equal(req.clientId, "capsule-js/0.1.0");
  });
});

test("nonce distinto en cada conexión; token cgs_/cgt_ y relleno", async () => {
  await withRef(async (s) => {
    const a = await connect(refUri(s), opts());
    const b = await connect(refUri(s), opts({ token: "cgs_" + "B".repeat(40), padding: 20, clientId: false }));
    a.destroy();
    b.destroy();
    assert.notDeepEqual(s.seen[0]?.nonce, s.seen[1]?.nonce);
    assert.equal(s.seen[1]?.authType, 4);
    assert.equal(s.seen[1]?.ignoredTlvs, 1);
    assert.equal(s.seen[1]?.clientId, undefined);
  });
});

test("datos optimistas tras el encabezado y bytes tras CAPR llegan al llamador", async () => {
  await withRef(
    async (s) => {
      const sock = await connect(refUri(s), opts());
      const got = await readAll(sock);
      assert.equal(got.toString(), "SSH-2.0-test\r\n");
    },
    {
      handler: (_req, sock) => {
        // El destino habla primero: los bytes llegan pegados a CAPR en el mismo segmento.
        sock.write(Buffer.concat([okResponse(), Buffer.from("SSH-2.0-test\r\n")]));
        sock.end();
      },
    },
  );
});

interface StatusCase {
  status: number;
  code: number;
  cls: new (...a: never[]) => CapsuleError;
  kind: string;
  retryable: boolean;
}
const STATUS_TABLE: StatusCase[] = [
  { status: 1, code: 0x0101, cls: UnsupportedVersion, kind: "UnsupportedVersion", retryable: false },
  { status: 1, code: 0x0102, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0103, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0104, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0105, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0106, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0107, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0108, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 1, code: 0x0109, cls: UnsupportedTransport, kind: "UnsupportedTransport", retryable: false },
  { status: 1, code: 0x010a, cls: BadRequest, kind: "BadRequest", retryable: true },
  { status: 1, code: 0x010b, cls: BadRequest, kind: "BadRequest", retryable: false },
  { status: 2, code: 0x0201, cls: NotAuthorized, kind: "NotAuthorized", retryable: false },
  { status: 2, code: 0x0202, cls: TokenExpired, kind: "TokenExpired", retryable: false },
  { status: 2, code: 0x0203, cls: NotAuthorized, kind: "NotAuthorized", retryable: false },
  { status: 3, code: 0x0301, cls: IpDenied, kind: "IpDenied", retryable: false },
  { status: 4, code: 0x0401, cls: Unavailable, kind: "Unavailable", retryable: true },
  { status: 4, code: 0x0402, cls: Unavailable, kind: "Unavailable", retryable: true },
  { status: 5, code: 0x0501, cls: QuotaExceeded, kind: "QuotaExceeded", retryable: true },
  { status: 5, code: 0x0502, cls: QuotaExceeded, kind: "QuotaExceeded", retryable: true },
  { status: 5, code: 0x0503, cls: QuotaExceeded, kind: "QuotaExceeded", retryable: true },
  { status: 5, code: 0x0504, cls: QuotaExceeded, kind: "QuotaExceeded", retryable: true },
  { status: 6, code: 0x0601, cls: GatewayBusy, kind: "GatewayBusy", retryable: true },
  { status: 6, code: 0x0602, cls: GatewayBusy, kind: "GatewayBusy", retryable: true },
  { status: 6, code: 0x0603, cls: GatewayBusy, kind: "GatewayBusy", retryable: true },
  // status/code desconocidos
  { status: 9, code: 0x0901, cls: UnknownStatus, kind: "UnknownStatus", retryable: false },
  { status: 4, code: 0x04ff, cls: Unavailable, kind: "Unavailable", retryable: true },
  { status: 2, code: 0x02ff, cls: NotAuthorized, kind: "NotAuthorized", retryable: false },
];

test("cada status/code de PROTOCOL.md §7 produce el error tipado y la semántica reintentable correctos", async () => {
  await withRef(
    async (s) => {
      for (const c of STATUS_TABLE) {
        s.handler = (_r, sock) => {
          sock.write(errResponse(c.status, c.code, "mensaje", c.status === 5 ? { retryAfter: 7 } : c.code === 0x0101 ? { maxVersion: 1 } : {}));
          sock.end();
        };
        const before = s.connections;
        await assert.rejects(connect(refUri(s), opts()), (e: unknown) => {
          assert.ok(e instanceof c.cls, `0x${c.code.toString(16)}: clase ${(e as Error).name}`);
          const err = e as CapsuleError;
          assert.equal(err.kind, c.kind);
          assert.equal(err.status, c.status);
          assert.equal(err.code, c.code);
          assert.equal(err.retryable, c.retryable, `retryable 0x${c.code.toString(16)}`);
          assert.ok(!err.message.includes(TOKEN) && !String(err.stack).includes(TOKEN));
          if (c.status === 5) assert.equal(err.retryAfter, 7);
          if (c.code === 0x0101) assert.equal((err as UnsupportedVersion).maxVersion, 1);
          return true;
        });
        assert.equal(s.connections, before + 1, "sin reintento automático (retry:false)");
      }
    },
  );
});

test("el servidor de referencia devuelve el status/code del decodificador normativo ante encabezados malos", async () => {
  // Cliente crudo TLS que envía un encabezado inválido (magic incorrecto) -> CAPR 1/0x0102.
  await withRef(async (s) => {
    const raw = tls.connect({ host: "127.0.0.1", port: s.port, servername: "localhost", ca: CERT, ALPNProtocols: ["capsule/1"] });
    await new Promise<void>((r) => raw.once("secureConnect", () => r()));
    raw.write(Buffer.from("GET / HTTP/1.1\r\n\r\n"));
    const resp = await readAll(raw);
    assert.equal(resp.subarray(0, 4).toString(), "CAPR");
    assert.equal(resp[5], 1);
    assert.equal((resp[6] as number) * 256 + (resp[7] as number), 0x0102);
  });
});

test("reintentos: Unavailable se reintenta con nonce nuevo; NotAuthorized no", async () => {
  await withRef(async (s) => {
    let n = 0;
    s.handler = (req, sock, rest, ctx) => {
      n++;
      if (n < 3) {
        sock.write(errResponse(4, 0x0401, "down"));
        sock.end();
      } else echoHandler(req, sock, rest, ctx);
    };
    const sock = await connect(refUri(s), opts({ retry: { initialDelayMs: 5, jitter: 0, maxAttempts: 5 } }));
    sock.destroy();
    assert.equal(n, 3);
    const nonces = new Set(s.seen.map((r) => Buffer.from(r.nonce ?? []).toString("hex")));
    assert.equal(nonces.size, 3, "nonce fresco en cada intento");

    n = 0;
    s.handler = (_r, sock) => {
      n++;
      sock.write(errResponse(2, 0x0201, "not authorized"));
      sock.end();
    };
    await assert.rejects(connect(refUri(s), opts({ retry: { initialDelayMs: 5 } })), NotAuthorized);
    assert.equal(n, 1);
  });
});

test("reintentos: tope de intentos y 0x010A solo una vez", async () => {
  await withRef(async (s) => {
    let n = 0;
    s.handler = (_r, sock) => {
      n++;
      sock.write(errResponse(6, 0x0601, "drain"));
      sock.end();
    };
    await assert.rejects(connect(refUri(s), opts({ retry: { initialDelayMs: 2, jitter: 0, maxAttempts: 5 } })), GatewayBusy);
    assert.equal(n, 5);

    n = 0;
    s.handler = (_r, sock) => {
      n++;
      sock.write(errResponse(1, 0x010a, "truncated"));
      sock.end();
    };
    await assert.rejects(connect(refUri(s), opts({ retry: { initialDelayMs: 2, jitter: 0, maxAttempts: 5 } })), BadRequest);
    assert.equal(n, 2);
  });
});

test("reintentos: respeta retry_after", async () => {
  await withRef(async (s) => {
    let n = 0;
    s.handler = (req, sock, rest, ctx) => {
      n++;
      if (n === 1) {
        sock.write(errResponse(5, 0x0503, "rate", { retryAfter: 1 }));
        sock.end();
      } else echoHandler(req, sock, rest, ctx);
    };
    const t0 = Date.now();
    const sock = await connect(refUri(s), opts({ retry: { initialDelayMs: 1, jitter: 0 } }));
    sock.destroy();
    assert.ok(Date.now() - t0 >= 950, "esperó retry_after (1 s)");
    assert.equal(n, 2);
  });
});

test("cgc_ expirado: se renueva una vez con TokenSource; con cadena fija falla con TokenExpired", async () => {
  await withRef(async (s) => {
    const seen: string[] = [];
    s.handler = (req, sock, rest, ctx) => {
      seen.push(req.auth);
      if (req.auth.includes("old")) {
        sock.write(errResponse(2, 0x0202, "expired"));
        sock.end();
      } else echoHandler(req, sock, rest, ctx);
    };
    let calls = 0;
    const src = (): string => (calls++ === 0 ? "cgc_aaaa.old.sig" : "cgc_aaaa.new.sig");
    const sock = await connect(refUri(s), opts({ token: src }));
    sock.destroy();
    assert.deepEqual(seen, ["cgc_aaaa.old.sig", "cgc_aaaa.new.sig"]);
    await assert.rejects(connect(refUri(s), opts({ token: "cgc_aaaa.old.sig" })), TokenExpired);
  });
});

test("respuestas truncadas o inválidas del gateway", async () => {
  await withRef(async (s) => {
    const full = okResponse({ idleTimeout: 60 });
    // CAPR a medias y cierre ordenado: error de protocolo 'truncated'.
    s.handler = (_r, sock) => {
      sock.end(Buffer.from(full.subarray(0, 12)));
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof ProtocolError && e.reason === "truncated");
    // Magic incorrecto.
    s.handler = (_r, sock) => {
      sock.end(Buffer.from("HTTP/1.1 400 Bad Request\r\n\r\n"));
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof ProtocolError && e.reason === "bad_magic");
    // msg > 120.
    s.handler = (_r, sock) => {
      const b = Buffer.from(okResponse());
      b[8] = 121;
      sock.end(Buffer.concat([b, Buffer.alloc(200, 0x61)]));
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof ProtocolError && e.reason === "msg_too_long");
    // Cierre ordenado sin respuesta.
    s.handler = (_r, sock) => {
      sock.end();
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof Unavailable && e.retryable);
    // Reinicio sin close_notify y sin respuesta.
    s.handler = (_r, sock) => {
      sock.destroy();
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof Unavailable && e.retryable);
    // Versión 0 en una respuesta OK.
    s.handler = (_r, sock) => {
      const b = Buffer.from(okResponse());
      b[4] = 0;
      sock.end(b);
    };
    await assert.rejects(connect(refUri(s), opts()), (e: unknown) => e instanceof ProtocolError && e.reason === "bad_version");
  });
});

test("los errores de protocolo se reintentan como máximo una vez", async () => {
  await withRef(async (s) => {
    s.handler = (_r, sock) => {
      sock.end(Buffer.from("garbage-garbage"));
    };
    await assert.rejects(connect(refUri(s), opts({ retry: { initialDelayMs: 2, jitter: 0, maxAttempts: 5 } })), ProtocolError);
    assert.equal(s.connections, 2);
  });
});

test("tiempo de espera de CAPR agotado -> Unavailable", async () => {
  await withRef(async (s) => {
    s.handler = () => undefined; // nunca responde
    const t0 = Date.now();
    await assert.rejects(connect(refUri(s), opts({ responseTimeoutMs: 150 })), (e: unknown) => e instanceof Unavailable && e.retryable);
    assert.ok(Date.now() - t0 < 3000);
  });
});

test("AbortSignal: antes, durante la espera y después de conectar", async () => {
  await withRef(async (s) => {
    await assert.rejects(connect(refUri(s), opts({ signal: AbortSignal.abort() })), AbortedError);
    s.handler = () => undefined;
    const ac = new AbortController();
    const p = connect(refUri(s), opts({ signal: ac.signal }));
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, AbortedError);
    // Aborta entre reintentos.
    s.handler = (_r, sock) => {
      sock.write(errResponse(4, 0x0401, "down"));
      sock.end();
    };
    const ac2 = new AbortController();
    const p2 = connect(refUri(s), opts({ signal: ac2.signal, retry: { initialDelayMs: 5000 } }));
    setTimeout(() => ac2.abort(), 150);
    await assert.rejects(p2, AbortedError);
    // Después de conectar destruye el socket.
    s.handler = echoHandler;
    const ac3 = new AbortController();
    const sock = await connect(refUri(s), opts({ signal: ac3.signal }));
    sock.on("error", () => undefined);
    const closed = new Promise<void>((r) => sock.once("close", () => r()));
    ac3.abort();
    await closed;
    assert.ok(sock.destroyed);
  });
});

test("TLS: certificado no confiable, nombre erróneo, TLS 1.2 y ALPN ausente son TlsError no reintentables", async () => {
  await withRef(async (s) => {
    const noCa = connect(refUri(s), { token: TOKEN, retry: false });
    await assert.rejects(noCa, (e: unknown) => e instanceof TlsError && !e.retryable);
    await assert.rejects(
      connect(`capsule://p/s?gateway=127.0.0.1:${s.port}&sni=otro.test`, opts()),
      (e: unknown) => e instanceof TlsError,
    );
  });
  const tls12 = await startRef({ tlsOptions: { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } });
  try {
    await assert.rejects(connect(refUri(tls12), opts()), (e: unknown) => e instanceof TlsError && !e.retryable);
  } finally {
    await tls12.close();
  }
  const noAlpn = await startRef({ tlsOptions: { ALPNProtocols: [] } });
  try {
    await assert.rejects(connect(refUri(noAlpn), opts()), (e: unknown) => e instanceof TlsError && /ALPN|application/i.test(e.message));
    // ALPN distinto
    const other = await startRef({ tlsOptions: { ALPNProtocols: ["otro/1"] } });
    try {
      await assert.rejects(connect(refUri(other), opts()), (e: unknown) => e instanceof TlsError);
    } finally {
      await other.close();
    }
  } finally {
    await noAlpn.close();
  }
});

test("no se puede debilitar la verificación TLS", async () => {
  await withRef(async (s) => {
    await assert.rejects(connect(refUri(s), opts({ tlsOptions: { rejectUnauthorized: false } })), ConfigError);
    await assert.rejects(
      connect("capsule://p/s?gateway=203.0.113.5&sni=gw.example.com", opts({ insecureSkipVerifyForTest: true })),
      ConfigError,
    );
    // Solo contra localhost/.test: con el flag explícito funciona aunque el certificado no sea confiable.
    const sock = await connect(refUri(s), { token: TOKEN, retry: false, insecureSkipVerifyForTest: true });
    sock.destroy();
  });
});

test("connect() exige transport=tcp y un token válido", async () => {
  await assert.rejects(connect("capsule://p/s?transport=udp", { token: TOKEN }), ConfigError);
  await assert.rejects(connect("capsule://p/s", { token: "xyz_" + "a".repeat(20) }), ConfigError);
  await assert.rejects(connect("capsule://P/s", { token: TOKEN }), (e: unknown) => e instanceof CapsuleError && e.kind === "UriError");
});

test("half-close: el cliente cierra la escritura y sigue leyendo la respuesta completa", async () => {
  await withRef(
    async (s) => {
      const sock = await connect(refUri(s), opts());
      sock.write("abc");
      sock.end(); // close_notify -> el servidor lo ve como EOF y aún puede escribir
      const got = await readAll(sock);
      assert.equal(got.toString(), "abc|adios");
    },
    {
      handler: (_req, sock) => {
        sock.write(okResponse());
        const chunks: Buffer[] = [];
        sock.on("data", (d) => chunks.push(d));
        sock.on("end", () => sock.end(Buffer.concat([...chunks, Buffer.from("|adios")])));
      },
    },
  );
});

test("half-close: el destino cierra primero y el cliente aún puede escribir", async () => {
  let serverGot = "";
  await withRef(
    async (s) => {
      const sock = await connect(refUri(s), opts());
      const ended = new Promise<void>((r) => sock.once("end", () => r()));
      const first = await new Promise<Buffer>((r) => sock.once("data", r));
      assert.equal(first.toString(), "hola");
      await ended;
      assert.equal(sock.writable, true, "la escritura sigue abierta tras el FIN del servidor");
      sock.end("respuesta tardía");
      await new Promise<void>((r) => sock.once("close", () => r()));
      assert.equal(serverGot, "respuesta tardía");
    },
    {
      handler: (_req, sock) => {
        sock.write(Buffer.concat([okResponse(), Buffer.from("hola")]));
        sock.end();
        const chunks: Buffer[] = [];
        sock.on("data", (d) => chunks.push(d));
        sock.on("end", () => {
          serverGot = Buffer.concat(chunks).toString();
        });
      },
    },
  );
});

test("cierre abrupto del TCP tras CAPR: el flujo termina (sin colgarse) con EOF o error", async () => {
  // Limitación de Node: TLSSocket no expone si se recibió close_notify, así que un TCP cerrado
  // sin close_notify llega como EOF normal (o, según la plataforma, como error marcado Truncated).
  // La aplicación debe detectar el truncamiento con su propio encuadre (los protocolos de BD lo hacen).
  await withRef(
    async (s) => {
      const sock = await connect(refUri(s), opts());
      const outcome = await new Promise<string>((res) => {
        sock.on("error", (e) => res(isTruncated(e) ? "truncated-error" : "other-error"));
        sock.on("end", () => res("eof"));
        sock.resume();
      });
      assert.ok(["eof", "truncated-error"].includes(outcome), outcome);
      sock.destroy();
    },
    {
      handler: (_req, sock) => {
        sock.write(okResponse(), () => {
          const raw = (sock as unknown as { _parent?: net.Socket })._parent;
          if (raw) raw.destroy();
          else sock.destroy();
        });
      },
    },
  );
});

test("1 MB en ambos sentidos a la vez, intacto y en orden", async () => {
  await withRef(async (s) => {
    const payload = randomBytes(1024 * 1024);
    const sock = await connect(refUri(s), opts());
    const received = readAll(sock);
    // Escribe en trozos respetando la contrapresión.
    for (let off = 0; off < payload.length; off += 16 * 1024) {
      if (!sock.write(payload.subarray(off, off + 16 * 1024))) await new Promise((r) => sock.once("drain", r));
    }
    sock.end();
    const got = await received;
    assert.equal(got.length, payload.length);
    assert.equal(sha(got), sha(payload));
  });
});

test("IPv4 literal con family=4, IPv6 ::1 con family=6", async (t) => {
  await withRef(async (s) => {
    const a = await connect(refUri(s, "&family=4"), opts());
    a.destroy();
  });
  if (!(await canListenIPv6())) {
    t.skip("el entorno no admite ::1");
    return;
  }
  const s6 = await startRef({ host: "::1" });
  try {
    const sock = await connect(refUri(s6, "&family=6"), opts());
    assert.equal(sock.remoteFamily, "IPv6");
    sock.write("v6");
    const got = await new Promise<Buffer>((r) => sock.once("data", r));
    assert.equal(got.toString(), "v6");
    sock.destroy();
    // family=4 contra un servidor solo IPv6 debe fallar (Unavailable).
    await assert.rejects(
      connect(`capsule://p/s?gateway=localhost:${s6.port}&sni=localhost&family=4`, opts({ connectTimeoutMs: 2000 })),
      (e: unknown) => e instanceof Unavailable,
    );
  } finally {
    await s6.close();
  }
});

test("resolución por nombre con Happy Eyeballs: cae a IPv4 si la primera dirección no responde", async () => {
  await withRef(async (s) => {
    const lookup = ((_host: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      const list = [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ];
      if (options && options.all) cb(null, list);
      else cb(null, "127.0.0.1", 4);
    }) as unknown as ConnectOptions["lookup"];
    const sock = await connect(`capsule://p/s?gateway=tcp.apps.example.test:${s.port}`, opts({ lookup }));
    assert.equal(sock.remoteAddress, "127.0.0.1");
    sock.destroy();
  });
});

test("servidor-túnel local: eco, half-close, concurrencia y cierre", async () => {
  await withRef(async (s) => {
    const tunnel = await listen(refUri(s), { ...opts(), port: 0 });
    const tunnelPort = tunnel.port;
    try {
      assert.equal(tunnel.host, "127.0.0.1");
      // Cliente de base de datos simulado: TCP crudo a 127.0.0.1:puerto.
      const one = async (i: number): Promise<void> => {
        const c = net.connect({ host: "127.0.0.1", port: tunnel.port, allowHalfOpen: true });
        c.write(`msg-${i}`);
        c.end();
        const got = await readAll(c);
        assert.equal(got.toString(), `msg-${i}`);
      };
      await Promise.all(Array.from({ length: 20 }, (_, i) => one(i)));
      // 1 MB a través del túnel local.
      const payload = randomBytes(1024 * 1024);
      const c = net.connect({ host: "127.0.0.1", port: tunnel.port, allowHalfOpen: true });
      const rec = readAll(c);
      c.end(payload);
      assert.equal(sha(await rec), sha(payload));
    } finally {
      await tunnel.close();
    }
    await new Promise<void>((resolve, reject) => {
      const c = net.connect({ host: "127.0.0.1", port: tunnelPort });
      c.once("error", () => resolve());
      c.once("connect", () => reject(new Error("el túnel cerrado aún acepta conexiones")));
    });
  });
});

test("servidor-túnel local: un error del gateway cierra la conexión local y se informa sin token", async () => {
  await withRef(async (s) => {
    s.handler = (_r, sock) => {
      sock.write(errResponse(2, 0x0201, "not authorized"));
      sock.end();
    };
    const errors: Error[] = [];
    const tunnel = await listen(refUri(s), { ...opts(), onTunnelError: (e) => errors.push(e) });
    try {
      const c = net.connect({ host: "127.0.0.1", port: tunnel.port });
      c.on("error", () => undefined);
      await new Promise<void>((r) => c.once("close", () => r()));
      assert.equal(errors.length, 1);
      assert.ok(errors[0] instanceof NotAuthorized);
      assert.ok(!String(errors[0]?.message).includes(TOKEN));
    } finally {
      await tunnel.close();
    }
  });
});

test("servidor-túnel local: rechaza interfaces no locales y URI udp", async () => {
  await assert.rejects(listen("capsule://p/s", { token: TOKEN, host: "0.0.0.0" }), ConfigError);
  await assert.rejects(listen("capsule://p/s?transport=udp", { token: TOKEN }), ConfigError);
});

test("UDP sobre flujo: sesión, eco de datagramas, keepalive y límites", async () => {
  await withRef(async (s) => {
    const received: string[] = [];
    let keepalives = 0;
    s.handler = (req, sock) => {
      assert.equal(req.transport, 2);
      assert.equal(req.flags & 1, 1);
      sock.write(
        okResponse({
          sessionId: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
          clientAddr: { ip: "192.0.2.10", port: 51234 },
          maxDatagram: 1472,
          idleTimeout: 3,
        }),
      );
      const dec = new FrameDecoder();
      sock.on("data", (d) => {
        const b = dec.push(d);
        keepalives += b.keepalives;
        for (const dg of b.datagrams) {
          received.push(Buffer.from(dg).toString());
          sock.write(encodeFrame(Buffer.from("eco:" + Buffer.from(dg).toString())));
        }
      });
      sock.on("end", () => sock.end());
    };
    const u = await connectUdp(refUri(s, "&transport=udp"), opts());
    assert.equal(u.maxDatagram, 1472);
    assert.equal(u.idleTimeout, 3);
    assert.equal(Buffer.from(u.sessionId ?? []).toString("hex"), "0102030405060708");
    assert.deepEqual(u.clientAddr, { ip: "192.0.2.10", port: 51234 });
    const msgs: string[] = [];
    u.on("message", (m) => msgs.push(m.toString()));
    u.send(Buffer.from("uno"));
    u.send(Buffer.from("dos"));
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(received, ["uno", "dos"]);
    assert.deepEqual(msgs, ["eco:uno", "eco:dos"]);
    assert.throws(() => u.send(Buffer.alloc(1473)), RangeError);
    // keepalive cada idle_timeout/3 = 1 s si no se envía nada
    await new Promise((r) => setTimeout(r, 1500));
    assert.ok(keepalives >= 1, "se envió al menos un keepalive");
    const closed = new Promise<void>((r) => u.once("close", () => r()));
    u.close();
    await closed;
    assert.throws(() => u.send(Buffer.from("x")));
  });
});

test("UDP sobre flujo: una trama de más de 2048 bytes cierra la sesión con error de protocolo", async () => {
  await withRef(async (s) => {
    s.handler = (_r, sock) => {
      sock.write(Buffer.concat([okResponse(), Buffer.from([0x08, 0x01])]));
    };
    const u = await connectUdp(refUri(s, "&transport=udp"), opts());
    const err = await new Promise<Error>((r) => u.once("error", r));
    assert.ok(err instanceof ProtocolError && err.reason === "frame_too_large");
  });
});

test("entrada de navegador: expone el códec pero connect() declara que no hay TCP crudo", () => {
  assert.equal(typeof browser.parseUri, "function");
  assert.equal(typeof browser.encodeRequest, "function");
  assert.throws(() => browser.connect(), (e: unknown) => e instanceof browser.UnsupportedEnvironment);
});
