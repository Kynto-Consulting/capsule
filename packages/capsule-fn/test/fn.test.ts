import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { buildCtx, defineFunction, lambdaHandler, makeRedactor, run, PART_SIZE, signV4 } from "../src/index.ts";

// A minimal SOCKS5 gateway: allows only 127.0.0.1 (the "customer network" of the test) and refuses everything else.
function gateway(): Promise<{ url: string; close(): void; denied: string[] }> {
  const denied: string[] = [];
  const srv = net.createServer((c) => {
    c.once("data", () => {
      c.write(Buffer.from([5, 0]));
      c.once("data", (req) => {
        const ip = `${req[4]}.${req[5]}.${req[6]}.${req[7]}`;
        const port = req.readUInt16BE(8);
        if (ip !== "127.0.0.1") {
          denied.push(`${ip}:${port}`);
          c.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
          return;
        }
        const up = net.connect(port, ip, () => {
          c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          c.pipe(up).pipe(c);
        });
        up.on("error", () => c.destroy());
      });
    });
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ url: `tcp://127.0.0.1:${(srv.address() as net.AddressInfo).port}`, close: () => srv.close(), denied })));
}

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  CAPSULE_RUN_ID: "r1",
  CAPSULE_FN: "migrar",
  CAPSULE_API: "http://api.local",
  CAPSULE_TOKEN: "capfn_secrettoken0123456789",
  CAPSULE_SCOPES: "api:importacion,db:expedientes",
  ...extra,
});

test("ctx.vpn.http goes through the gateway and only reaches declared networks", async () => {
  const origin = http.createServer((_q, s) => s.end("hola desde la red del cliente"));
  await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
  const gw = await gateway();
  const ctx = buildCtx(env({ CAPSULE_VPN_SOCKS: gw.url }));
  const res = await ctx.vpn.http(`http://127.0.0.1:${(origin.address() as net.AddressInfo).port}/x`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hola desde la red del cliente");
  await assert.rejects(ctx.vpn.http("http://8.8.8.8/"), /outside the declared networks/);
  await assert.rejects(ctx.vpn.connect("example.com", 80), /needs an IP address/);
  assert.deepEqual(gw.denied, ["8.8.8.8:80"]);
  origin.close();
  gw.close();
});

test("ctx.vpn.forward lets any client library reach the tunnel via loopback", async () => {
  const echo = net.createServer((c) => c.pipe(c));
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  const gw = await gateway();
  const ctx = buildCtx(env({ CAPSULE_VPN_SOCKS: gw.url }));
  const fwd = await ctx.vpn.forward("127.0.0.1", (echo.address() as net.AddressInfo).port);
  const got = await new Promise<string>((resolve) => {
    const c = net.connect(fwd.port, fwd.host, () => c.write("ping"));
    c.once("data", (d) => {
      resolve(d.toString());
      c.end();
    });
  });
  assert.equal(got, "ping");
  await fwd.close();
  echo.close();
  gw.close();
});

test("a function without a tunnel cannot use ctx.vpn", async () => {
  const ctx = buildCtx(env());
  assert.equal(ctx.vpn.attached, false);
  await assert.rejects(ctx.vpn.http("http://10.0.0.1/"), /not attached to a VPN tunnel/);
});

test("ctx.api adds the run token", async () => {
  let auth = "";
  const f = (async (_u: any, init: any) => {
    auth = new Headers(init.headers).get("authorization") ?? "";
    return new Response("ok");
  }) as typeof fetch;
  const ctx = buildCtx(env(), f);
  await ctx.api.fetch("/importacion/x");
  assert.equal(auth, "Bearer capfn_secrettoken0123456789");
});

test("resumable upload: asks known parts, sends only missing ones in 8 MiB parts, retries, closes", async () => {
  assert.equal(PART_SIZE, 8 * 1024 * 1024);
  const ctx = buildCtx(env());
  const data = Buffer.alloc(PART_SIZE * 2 + 100, 7); // 3 parts
  const sent: number[] = [];
  let failedOnce = false;
  let closed: any;
  const out = await ctx.api.upload({
    source: data,
    retries: 2,
    init: async () => ({ known: [0] }),
    putPart: async (i, b) => {
      if (i === 1 && !failedOnce) {
        failedOnce = true;
        throw new Error("network blip");
      }
      sent.push(i);
      assert.equal(b.length, i === 2 ? 100 : PART_SIZE);
    },
    close: async (info) => {
      closed = info;
    },
  });
  assert.deepEqual(sent, [1, 2]);
  assert.deepEqual(out, { parts: 3, skipped: 1, bytes: data.length });
  assert.deepEqual(closed, { parts: 3, size: data.length });
});

test("scopes are explicit: db and storage need their scope", () => {
  const ctx = buildCtx(env({ CAPSULE_DB_EXPEDIENTES: "postgres://u:pw@host.docker.internal:5433/expedientes" }));
  assert.equal(ctx.db.url("expedientes"), "postgres://u:pw@host.docker.internal:5433/expedientes");
  assert.throws(() => ctx.db.url("otra"), /no db:otra scope/);
  assert.throws(() => ctx.storage.bucket("biblioteca"), /no storage:biblioteca scope/);
});

test("logs hide the token and database passwords", async () => {
  const mask = makeRedactor(env({ CAPSULE_DB_X: "postgres://u:clave-larga@h:1/x" }));
  const s = mask("token capfn_secrettoken0123456789 pw clave-larga url postgres://u:clave-larga@h:1/x");
  assert.ok(!s.includes("capfn_secrettoken0123456789") && !s.includes("clave-larga"));
});

test("run() executes the handler and maps errors to exit code 1", async () => {
  assert.equal(await run(defineFunction(async () => "ok"), env()), 0);
  assert.equal(await run(defineFunction(async () => { throw new Error("boom"); }), env()), 1);
});

test("SigV4 matches the AWS documented example", () => {
  const h = signV4({
    method: "GET",
    url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    region: "us-east-1",
    service: "iam",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    date: new Date("2015-08-30T12:36:00Z"),
  });
  assert.match(h["authorization"]!, /Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7$/);
});

// ---- Lambda runtime: relay and batches ----

// A minimal relay as the Capsule API implements it: authenticates the run token, enforces the declared network (127.0.0.1 here)
// and upgrades the connection to a raw pipe towards the destination.
function relayServer(): Promise<{ url: string; close(): void; seen: { auth: string; dest: string }[] }> {
  const seen: { auth: string; dest: string }[] = [];
  const srv = http.createServer((_q, s) => s.end());
  srv.on("upgrade", (req, socket) => {
    const auth = String(req.headers.authorization ?? "");
    const dest = String(req.headers["x-capsule-dest"] ?? "");
    seen.push({ auth, dest });
    const deny = (code: number, text: string) => socket.end(`HTTP/1.1 ${code} ${text}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    if (auth !== "Bearer capfn_secrettoken0123456789") return deny(401, "Unauthorized");
    const [ip, port] = dest.split(":");
    if (ip !== "127.0.0.1") return deny(403, "Forbidden");
    const up = net.connect(Number(port), ip!, () => {
      socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: capsule-relay\r\n\r\n");
      socket.pipe(up).pipe(socket);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/api/v1/fn/relay/connect`, close: () => srv.close(), seen })));
}

test("a Lambda reaches the tunnel through the relay with its run token and nothing else", async () => {
  const origin = http.createServer((_q, s) => s.end("desde la red del cliente por el relé"));
  await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
  const relay = await relayServer();
  const ctx = buildCtx(env({ CAPSULE_VPN_RELAY: relay.url }));
  assert.equal(ctx.vpn.attached, true);
  const res = await ctx.vpn.http(`http://127.0.0.1:${(origin.address() as net.AddressInfo).port}/x`);
  assert.equal(await res.text(), "desde la red del cliente por el relé");
  await assert.rejects(ctx.vpn.http("http://8.8.8.8/"), /outside the declared networks/);
  await assert.rejects(ctx.vpn.connect("example.com", 80), /needs an IP address/);
  assert.equal(relay.seen[0]!.auth, "Bearer capfn_secrettoken0123456789");
  assert.deepEqual(relay.seen.map((s) => s.dest).slice(1), ["8.8.8.8:80"]);
  // a token the API does not accept is refused with a clear reason
  const bad = buildCtx(env({ CAPSULE_VPN_RELAY: relay.url, CAPSULE_TOKEN: "capfn_otra" }));
  await assert.rejects(bad.vpn.connect("127.0.0.1", 1), /run token is not valid for a tunnel/);
  origin.close();
  relay.close();
});

test("ctx.vpn.forward works over the relay too (any client library through loopback)", async () => {
  const echo = net.createServer((c) => c.pipe(c));
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  const relay = await relayServer();
  const ctx = buildCtx(env({ CAPSULE_VPN_RELAY: relay.url }));
  const fwd = await ctx.vpn.forward("127.0.0.1", (echo.address() as net.AddressInfo).port);
  const got = await new Promise<string>((resolve) => {
    const c = net.connect(fwd.port, fwd.host, () => c.write("ping"));
    c.once("data", (d) => {
      resolve(d.toString());
      c.end();
    });
  });
  assert.equal(got, "ping");
  await fwd.close();
  echo.close();
  relay.close();
});

test("lambdaHandler maps the event to the context, resumes from the cursor and asks Capsule to continue", async () => {
  const seen: any[] = [];
  const handler = lambdaHandler(
    defineFunction(async (ctx) => {
      seen.push({ attempt: ctx.batch.attempt, cursor: ctx.batch.cursor, budget: ctx.batch.budgetMs, payload: ctx.payload, run: ctx.run.id, fn: ctx.run.function, scopes: ctx.run.scopes, token: ctx.api.base });
      const from = (ctx.batch.cursor as { i: number } | undefined)?.i ?? 0;
      return from < 20 ? { continue: { i: from + 10 } } : { done: true };
    }),
  );
  const event = (attempt: number, cursor?: unknown) => ({
    run_id: "r9",
    function: "migrar",
    attempt,
    cursor,
    payload: { lote: 3 },
    budget_ms: 780_000,
    env: { CAPSULE_API: "http://api.local", CAPSULE_TOKEN: "capfn_secrettoken0123456789", CAPSULE_SCOPES: "api:importacion" },
  });
  assert.deepEqual(await handler(event(0)), { continue: { i: 10 } });
  assert.deepEqual(await handler(event(1, { i: 10 })), { continue: { i: 20 } });
  assert.deepEqual(await handler(event(2, { i: 20 })), {}); // anything else ends the run
  assert.deepEqual(seen[1], { attempt: 1, cursor: { i: 10 }, budget: 780_000, payload: { lote: 3 }, run: "r9", fn: "migrar", scopes: ["api:importacion"], token: "http://api.local" });
});

test("ctx.batch tells the function when to checkpoint; the container runtime has no budget", async () => {
  const ctx = buildCtx(env({ CAPSULE_BATCH_BUDGET_MS: "50" }));
  assert.equal(ctx.batch.shouldYield(10_000), true);
  assert.ok(ctx.batch.remainingMs() <= 50);
  const unlimited = buildCtx(env());
  assert.equal(unlimited.batch.budgetMs, Infinity);
  assert.equal(unlimited.batch.shouldYield(), false);
  assert.equal(unlimited.batch.cursor, undefined);
});

test("an error in a batch propagates, so Lambda reports FunctionError and the run fails", async () => {
  const handler = lambdaHandler(defineFunction(async () => { throw new Error("boom"); }));
  await assert.rejects(handler({ run_id: "r", function: "f", attempt: 0, budget_ms: 1000, env: {} }), /boom/);
});
