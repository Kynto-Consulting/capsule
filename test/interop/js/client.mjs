// One scenario of the Go<->JS interoperability matrix, run with the real JS library (packages/gateway-js/dist) against the real gateway.
// argv[2] = base64(JSON): { mode, uri, token, ca, pgca, bytes, abortMs, ... }. Prints exactly one JSON line.
import fs from "node:fs";
import tls from "node:tls";
import crypto from "node:crypto";

const lib = await import(new URL("../../../packages/gateway-js/dist/index.js", import.meta.url).href);
const a = JSON.parse(Buffer.from(process.argv[2], "base64").toString("utf8"));
const ca = fs.readFileSync(a.ca);
const out = (o) => { process.stdout.write(JSON.stringify(o) + "\n"); };
const errInfo = (e) => ({ ok: false, name: e?.name, kind: e?.kind, status: e?.status, code: e?.code, retryable: e?.retryable, message: String(e?.message ?? e).slice(0, 300) });
const opts = (extra = {}) => ({ token: process.env.GWTOKEN || a.token, tlsOptions: { ca }, ...extra });

// deterministic payload (same generator as the Go side)
function pattern(n, seed) {
  const b = Buffer.alloc(n);
  let x = (seed >>> 0) || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; b[i] = x & 0xff; }
  return b;
}

class Reader {
  constructor(sock) { this.sock = sock; this.buf = Buffer.alloc(0); this.err = null; this.end = false; this.w = null;
    sock.on("data", (d) => { this.buf = Buffer.concat([this.buf, d]); this.wake(); });
    sock.on("end", () => { this.end = true; this.wake(); });
    sock.on("close", () => { this.end = true; this.wake(); });
    sock.on("error", (e) => { this.err = e; this.wake(); }); }
  wake() { const w = this.w; this.w = null; if (w) w(); }
  async need(n) {
    while (this.buf.length < n) {
      if (this.err) throw this.err;
      if (this.end) throw new Error("unexpected end of stream");
      await new Promise((r) => { this.w = r; setTimeout(r, 15000); });
      if (this.buf.length < n && !this.err && !this.end && false) throw new Error("timeout");
    }
    const r = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return r;
  }
}

async function pgQuery(sock) {
  sock.write(Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]));
  const r1 = new Reader(sock);
  const one = await r1.need(1);
  if (one[0] !== 0x53) throw new Error("server refused TLS");
  sock.removeAllListeners("data"); sock.removeAllListeners("end"); sock.removeAllListeners("close"); sock.removeAllListeners("error");
  const t = tls.connect({ socket: sock, servername: "pg.target.test", ca: fs.readFileSync(a.pgca) });
  await new Promise((res, rej) => { t.once("secureConnect", res); t.once("error", rej); });
  const r = new Reader(t);
  const body = Buffer.from("\x00\x03\x00\x00user\x00tr\x00database\x00app\x00\x00", "latin1");
  const hdr = Buffer.alloc(4); hdr.writeUInt32BE(4 + body.length);
  t.write(Buffer.concat([hdr, body]));
  const until = async (rows) => {
    for (;;) {
      const h = await r.need(5); const n = h.readUInt32BE(1) - 4; const b = n ? await r.need(n) : Buffer.alloc(0);
      if (h[0] === 0x45) throw new Error("pg error: " + b.toString("latin1").replace(/\0/g, " "));
      if (h[0] === 0x52 && b.length >= 4 && b.readUInt32BE(0) !== 0) throw new Error("pg wants authentication");
      if (h[0] === 0x44 && rows) { const l = b.readInt32BE(2); if (l >= 0) rows.push(b.subarray(6, 6 + l).toString()); }
      if (h[0] === 0x5a) return;
    }
  };
  await until(null);
  const q = Buffer.from(a.sql + "\0"); const qh = Buffer.alloc(5); qh[0] = 0x51; qh.writeUInt32BE(4 + q.length, 1);
  t.write(Buffer.concat([qh, q]));
  const rows = []; await until(rows);
  t.write(Buffer.from([0x58, 0, 0, 0, 4]));
  t.destroy();
  return rows.join(",");
}

const t0 = Date.now();
try {
  if (a.mode === "query") {
    const s = await lib.connect(a.uri, opts({ retry: false }));
    const row = await pgQuery(s);
    out({ ok: true, row, status: s.capsule?.status, ms: Date.now() - t0 });
  } else if (a.mode === "open") {
    const s = await lib.connect(a.uri, opts({ retry: false }));
    out({ ok: true, status: s.capsule?.status, ms: Date.now() - t0 });
    s.destroy();
  } else if (a.mode === "echo") {
    const s = await lib.connect(a.uri, opts({ retry: false }));
    const data = pattern(a.bytes, a.seed ?? 12345);
    const rd = new Promise((res, rej) => {
      const h = crypto.createHash("sha256"); let n = 0;
      s.on("data", (d) => { h.update(d); n += d.length; });
      s.on("end", () => res({ n, sha: h.digest("hex") }));
      s.on("error", rej);
    });
    const CH = 64 * 1024;
    for (let off = 0; off < data.length; off += CH) {
      if (!s.write(data.subarray(off, off + CH))) await new Promise((r) => s.once("drain", r));
    }
    s.end(); // half-close: close_notify; the echo target answers EOF with its own half-close
    const got = await rd;
    out({ ok: true, sent: data.length, sentSha: crypto.createHash("sha256").update(data).digest("hex"), got: got.n, gotSha: got.sha, ms: Date.now() - t0 });
  } else if (a.mode === "ping") {
    const s = await lib.connect(a.uri, opts({ retry: false }));
    const r = new Reader(s); const lat = [];
    for (let i = 0; i < a.n; i++) { const t = process.hrtime.bigint(); s.write(Buffer.from([i & 255])); await r.need(1); lat.push(Number(process.hrtime.bigint() - t) / 1000); }
    s.destroy(); lat.sort((x, y) => x - y);
    out({ ok: true, p50us: lat[Math.floor(lat.length / 2)], p99us: lat[Math.floor(lat.length * 0.99)] });
  } else if (a.mode === "cancel") {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), a.abortMs);
    try {
      const s = await lib.connect(a.uri, opts({ retry: false, signal: ac.signal }));
      clearTimeout(timer);
      if (a.after) { // abort AFTER connecting: the socket must be destroyed
        const closed = new Promise((r) => s.once("close", r));
        ac.abort(); await Promise.race([closed, new Promise((r) => setTimeout(r, 3000))]);
        out({ ok: true, phase: "after-connect", destroyed: s.destroyed, ms: Date.now() - t0 });
      } else { out({ ok: true, phase: "connected-before-abort", ms: Date.now() - t0 }); s.destroy(); }
    } catch (e) { out({ ...errInfo(e), phase: "during-connect", ms: Date.now() - t0 }); }
  } else if (a.mode === "retry") {
    const s = await lib.connect(a.uri, opts({ retry: { maxAttempts: 8, initialDelayMs: 300 } }));
    const data = pattern(1024, 7); const r = new Reader(s); s.write(data); const back = await r.need(1024);
    s.destroy();
    out({ ok: true, same: Buffer.compare(back, data) === 0, ms: Date.now() - t0 });
  } else {
    out({ ok: false, message: "unknown mode" });
  }
} catch (e) {
  out({ ...errInfo(e), ms: Date.now() - t0 });
}
process.exit(0);
