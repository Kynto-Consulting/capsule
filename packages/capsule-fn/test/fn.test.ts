import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { buildCtx, defineFunction, makeRedactor, run, PART_SIZE, signV4 } from "../src/index.ts";

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
