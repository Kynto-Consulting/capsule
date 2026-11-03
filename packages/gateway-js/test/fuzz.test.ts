import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FrameDecoder,
  FrameTooLargeError,
  UriError,
  decodeRequest,
  decodeResponse,
  hexToBytes,
  parseUri,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const VEC = process.env["CAPSULE_TESTVECTORS"] ?? join(here, "..", "..", "..", "docs", "gateway", "testvectors");
const load = (n: string): { vectors: { hex?: string; uri?: string }[] } =>
  JSON.parse(readFileSync(join(VEC, n), "utf8")) as { vectors: { hex?: string; uri?: string }[] };

/** PRNG determinista (mulberry32) para que un fallo sea reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mutate(seed: Uint8Array, r: () => number): Uint8Array {
  let b = Uint8Array.from(seed);
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const op = Math.floor(r() * 5);
    const pos = Math.floor(r() * (b.length + 1));
    if (op === 0 && b.length) b[Math.min(pos, b.length - 1)] = Math.floor(r() * 256);
    else if (op === 1) b = b.slice(0, pos);
    else if (op === 2) {
      const ins = Uint8Array.from({ length: 1 + Math.floor(r() * 8) }, () => Math.floor(r() * 256));
      const out = new Uint8Array(b.length + ins.length);
      out.set(b.subarray(0, pos));
      out.set(ins, pos);
      out.set(b.subarray(pos), pos + ins.length);
      b = out;
    } else if (op === 3 && b.length) {
      const k = Math.min(pos, b.length - 1);
      b[k] = (b[k] as number) ^ (1 << Math.floor(r() * 8));
    } else if (op === 4 && b.length > 8) {
      // hdr_len / ext_len aleatorios en posiciones habituales
      b[6] = Math.floor(r() * 256);
      b[7] = Math.floor(r() * 256);
    }
  }
  return b;
}

const REQ_ERR_CODES = new Set([0x0101, 0x0102, 0x0103, 0x0104, 0x0105, 0x0106, 0x0107, 0x0108, 0x0109, 0x010a, 0x010b]);
const RESP_ERRS = new Set(["truncated", "bad_magic", "bad_version", "msg_too_long", "bad_msg", "ext_too_long", "bad_ext"]);

test("fuzz: decodeRequest nunca lanza, no se cuelga y el resultado pertenece a la tabla", () => {
  const seeds = load("request.json").vectors.map((v) => hexToBytes(v.hex as string));
  const r = rng(12345);
  const t0 = Date.now();
  let ok = 0;
  for (let i = 0; i < 40_000; i++) {
    const base = i % 10 === 0 ? Uint8Array.from({ length: Math.floor(r() * 80) }, () => Math.floor(r() * 256)) : (seeds[Math.floor(r() * seeds.length)] as Uint8Array);
    const data = i % 10 === 0 ? base : mutate(base, r);
    for (const eof of [true, false]) {
      const res = decodeRequest(data, eof);
      if (res.kind === "error") {
        assert.equal(res.status, 1);
        assert.ok(REQ_ERR_CODES.has(res.code), `código fuera de la tabla 0x${res.code.toString(16)}`);
      } else if (res.kind === "ok") {
        ok++;
        const hl = ((data[6] as number) << 8) | (data[7] as number);
        assert.equal(res.consumed, hl);
        assert.ok(res.consumed <= 1024 && res.consumed <= data.length);
      } else {
        assert.equal(eof, false, "incomplete solo con el flujo abierto");
      }
    }
  }
  assert.ok(ok > 100, "el fuzz alcanza también casos válidos");
  assert.ok(Date.now() - t0 < 30_000);
});

test("fuzz: decodeResponse nunca lanza y el resultado pertenece a la tabla", () => {
  const seeds = load("response.json").vectors.map((v) => hexToBytes(v.hex as string));
  const r = rng(777);
  for (let i = 0; i < 40_000; i++) {
    const data = mutate(seeds[Math.floor(r() * seeds.length)] as Uint8Array, r);
    for (const eof of [true, false]) {
      const res = decodeResponse(data, eof);
      if (res.kind === "error") assert.ok(RESP_ERRS.has(res.error));
      else if (res.kind === "ok") assert.ok(res.consumed <= data.length && res.consumed >= 11);
      else assert.equal(eof, false);
    }
  }
});

test("fuzz: FrameDecoder solo lanza FrameTooLargeError y reensambla trozos arbitrarios", () => {
  const r = rng(99);
  for (let i = 0; i < 5000; i++) {
    const data = Uint8Array.from({ length: Math.floor(r() * 300) }, () => (r() < 0.6 ? 0 : Math.floor(r() * 256)));
    const whole = new FrameDecoder();
    const chunked = new FrameDecoder();
    let a: string[] = [];
    let b: string[] = [];
    let errA: unknown;
    let errB: unknown;
    try {
      a = whole.push(data).datagrams.map((d) => Buffer.from(d).toString("hex"));
    } catch (e) {
      errA = e;
    }
    try {
      for (let off = 0; off < data.length; ) {
        const n = 1 + Math.floor(r() * 7);
        b.push(...chunked.push(data.subarray(off, off + n)).datagrams.map((d) => Buffer.from(d).toString("hex")));
        off += n;
      }
    } catch (e) {
      errB = e;
    }
    if (errA || errB) {
      assert.ok(errA === undefined || errA instanceof FrameTooLargeError);
      assert.ok(errB === undefined || errB instanceof FrameTooLargeError);
    } else {
      assert.deepEqual(b, a);
      assert.equal(chunked.pending, whole.pending);
    }
    b = [];
  }
});

test("fuzz: parseUri solo lanza UriError", () => {
  const seeds = load("uri.json").vectors.map((v) => v.uri as string);
  const alphabet = "abcXYZ019-_.:/?&=#@%[]x~ é\u0000";
  const r = rng(2024);
  for (let i = 0; i < 40_000; i++) {
    let s: string;
    if (i % 3 === 0) {
      s = "capsule://" + Array.from({ length: Math.floor(r() * 40) }, () => alphabet[Math.floor(r() * alphabet.length)]).join("");
    } else {
      const base = seeds[Math.floor(r() * seeds.length)] as string;
      const pos = Math.floor(r() * (base.length + 1));
      s = base.slice(0, pos) + (alphabet[Math.floor(r() * alphabet.length)] as string) + base.slice(pos + (r() < 0.5 ? 1 : 0));
    }
    try {
      const p = parseUri(s);
      assert.ok(p.connectPort >= 1 && p.connectPort <= 65535);
    } catch (e) {
      assert.ok(e instanceof UriError, `error no tipado para ${JSON.stringify(s)}: ${String(e)}`);
    }
  }
});
