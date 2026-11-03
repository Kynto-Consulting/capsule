import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FrameDecoder,
  FrameTooLargeError,
  UriError,
  bytesToHex,
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
  hexToBytes,
  ipAllowed,
  parseUri,
  type DecodedRequest,
  type RequestFields,
  type ResponseFields,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const VEC = process.env["CAPSULE_TESTVECTORS"] ?? join(here, "..", "..", "..", "docs", "gateway", "testvectors");

function load<T>(name: string): { vectors: T[] } {
  return JSON.parse(readFileSync(join(VEC, name), "utf8")) as { vectors: T[] };
}

interface ReqVec {
  name: string;
  hex: string;
  eof: boolean;
  canonical?: boolean;
  expect:
    | { incomplete: true }
    | { ok: true; consumed: number; fields: Record<string, unknown> }
    | { ok: false; status: number; code: string };
}

function reqToJson(f: DecodedRequest): Record<string, unknown> {
  const o: Record<string, unknown> = {
    transport: f.transport,
    flags: f.flags,
    project: f.project,
    service: f.service,
    auth_type: f.authType,
    auth: f.auth,
    ignored_tlvs: f.ignoredTlvs,
  };
  if (f.nonce) o["nonce_hex"] = bytesToHex(f.nonce);
  if (f.clientId !== undefined) o["client_id"] = f.clientId;
  return o;
}

test("request.json: decodificación de todos los vectores", () => {
  const { vectors } = load<ReqVec>("request.json");
  assert.ok(vectors.length >= 70);
  for (const v of vectors) {
    const data = hexToBytes(v.hex);
    const r = decodeRequest(data, v.eof);
    if ("incomplete" in v.expect) {
      assert.equal(r.kind, "incomplete", v.name);
    } else if (v.expect.ok) {
      assert.equal(r.kind, "ok", v.name);
      if (r.kind !== "ok") continue;
      assert.equal(r.consumed, v.expect.consumed, v.name);
      assert.deepEqual(reqToJson(r.fields), v.expect.fields, v.name);
      // Los bytes extra (envío optimista) no cambian el resultado.
      const extra = new Uint8Array(data.length + 37).fill(0xab);
      extra.set(data);
      for (const eof of [true, false]) {
        const r2 = decodeRequest(extra, eof);
        assert.equal(r2.kind, "ok", v.name + " +extra");
        if (r2.kind === "ok") assert.deepEqual(reqToJson(r2.fields), v.expect.fields, v.name + " +extra");
      }
    } else {
      assert.equal(r.kind, "error", v.name);
      if (r.kind !== "error") continue;
      assert.equal(r.status, v.expect.status, v.name);
      assert.equal("0x" + r.code.toString(16).padStart(4, "0"), v.expect.code.toLowerCase(), v.name);
    }
  }
});

test("request.json: codificación canónica byte a byte", () => {
  const { vectors } = load<ReqVec>("request.json");
  let n = 0;
  for (const v of vectors) {
    if (!v.canonical || !("ok" in v.expect) || !v.expect.ok) continue;
    const f = v.expect.fields;
    const fields: RequestFields = {
      transport: f["transport"] as number,
      flags: f["flags"] as number,
      project: f["project"] as string,
      service: f["service"] as string,
      authType: f["auth_type"] as number,
      auth: f["auth"] as string,
      ...(f["nonce_hex"] !== undefined ? { nonce: hexToBytes(f["nonce_hex"] as string) } : {}),
      ...(f["client_id"] !== undefined ? { clientId: f["client_id"] as string } : {}),
    };
    assert.equal(bytesToHex(encodeRequest(fields)), v.hex, v.name);
    n++;
  }
  assert.equal(n, 12);
});

interface RespVec {
  name: string;
  hex: string;
  eof: boolean;
  canonical?: boolean;
  expect:
    | { incomplete: true }
    | { ok: true; consumed: number; fields: Record<string, unknown> }
    | { ok: false; error: string };
}

function respToJson(f: ResponseFields): Record<string, unknown> {
  const t: Record<string, unknown> = {};
  if (f.tlvs.maxVersion !== undefined) t["max_version"] = f.tlvs.maxVersion;
  if (f.tlvs.retryAfter !== undefined) t["retry_after"] = f.tlvs.retryAfter;
  if (f.tlvs.sessionId) t["session_id_hex"] = bytesToHex(f.tlvs.sessionId);
  if (f.tlvs.clientAddr) t["client_addr"] = f.tlvs.clientAddr;
  if (f.tlvs.maxDatagram !== undefined) t["max_datagram"] = f.tlvs.maxDatagram;
  if (f.tlvs.idleTimeout !== undefined) t["idle_timeout"] = f.tlvs.idleTimeout;
  return { version: f.version, status: f.status, code: f.code, msg: f.msg, tlvs: t };
}

test("response.json: decodificación de todos los vectores", () => {
  const { vectors } = load<RespVec>("response.json");
  assert.ok(vectors.length >= 30);
  for (const v of vectors) {
    const data = hexToBytes(v.hex);
    const r = decodeResponse(data, v.eof);
    if ("incomplete" in v.expect) {
      assert.equal(r.kind, "incomplete", v.name);
    } else if (v.expect.ok) {
      assert.equal(r.kind, "ok", v.name);
      if (r.kind !== "ok") continue;
      assert.equal(r.consumed, v.expect.consumed, v.name);
      assert.deepEqual(respToJson(r.fields), v.expect.fields, v.name);
      const extra = new Uint8Array(data.length + 20).fill(0x55);
      extra.set(data);
      const r2 = decodeResponse(extra, false);
      assert.equal(r2.kind, "ok", v.name + " +extra");
      if (r2.kind === "ok") assert.equal(r2.consumed, v.expect.consumed, v.name + " +extra");
    } else {
      assert.equal(r.kind, "error", v.name);
      if (r.kind === "error") assert.equal(r.error, v.expect.error, v.name);
    }
  }
});

test("response.json: codificación canónica byte a byte", () => {
  const { vectors } = load<RespVec>("response.json");
  let n = 0;
  for (const v of vectors) {
    if (!v.canonical || !("ok" in v.expect) || !v.expect.ok) continue;
    const f = v.expect.fields as { version: number; status: number; code: number; msg: string; tlvs: Record<string, unknown> };
    const t = f.tlvs;
    const fields: ResponseFields = {
      version: f.version,
      status: f.status,
      code: f.code,
      msg: f.msg,
      tlvs: {
        ...(t["max_version"] !== undefined ? { maxVersion: t["max_version"] as number } : {}),
        ...(t["retry_after"] !== undefined ? { retryAfter: t["retry_after"] as number } : {}),
        ...(t["session_id_hex"] !== undefined ? { sessionId: hexToBytes(t["session_id_hex"] as string) } : {}),
        ...(t["client_addr"] !== undefined ? { clientAddr: t["client_addr"] as { ip: string; port: number } } : {}),
        ...(t["max_datagram"] !== undefined ? { maxDatagram: t["max_datagram"] as number } : {}),
        ...(t["idle_timeout"] !== undefined ? { idleTimeout: t["idle_timeout"] as number } : {}),
      },
    };
    assert.equal(bytesToHex(encodeResponse(fields)), v.hex, v.name);
    n++;
  }
  assert.equal(n, 12);
});

test("uri.json: todos los vectores", () => {
  const { vectors } = load<{
    name: string;
    uri: string;
    default_zone: string;
    expect: { ok: true; fields: Record<string, unknown> } | { ok: false; error: string };
  }>("uri.json");
  assert.ok(vectors.length >= 50);
  for (const v of vectors) {
    if (v.expect.ok) {
      const p = parseUri(v.uri, { defaultZone: v.default_zone });
      assert.deepEqual(
        {
          project: p.project,
          service: p.service,
          transport: p.transport,
          family: p.family,
          connect_host: p.connectHost,
          connect_port: p.connectPort,
          sni: p.sni,
        },
        v.expect.fields,
        v.name,
      );
    } else {
      const expected = v.expect.error;
      assert.throws(
        () => parseUri(v.uri, { defaultZone: v.default_zone }),
        (e: unknown) => e instanceof UriError && e.reason === expected,
        `${v.name}: se esperaba ${expected}`,
      );
    }
  }
});

test("udp_frames.json: todos los vectores (de una vez y byte a byte)", () => {
  const { vectors } = load<{
    name: string;
    hex: string;
    expect: { datagrams: string[]; keepalives: number; pending: number } | { error: string };
  }>("udp_frames.json");
  assert.ok(vectors.length >= 8);
  for (const v of vectors) {
    const data = hexToBytes(v.hex);
    for (const mode of ["whole", "bytewise"] as const) {
      const d = new FrameDecoder();
      const datagrams: string[] = [];
      let ka = 0;
      let err: unknown;
      try {
        const chunks = mode === "whole" ? [data] : Array.from(data, (b) => Uint8Array.of(b));
        for (const c of chunks) {
          const b = d.push(c);
          datagrams.push(...b.datagrams.map(bytesToHex));
          ka += b.keepalives;
        }
      } catch (e) {
        err = e;
      }
      if ("error" in v.expect) {
        assert.ok(err instanceof FrameTooLargeError, `${v.name} ${mode}`);
        assert.equal(v.expect.error, "frame_too_large");
      } else {
        assert.equal(err, undefined, `${v.name} ${mode}`);
        assert.deepEqual(datagrams, v.expect.datagrams, `${v.name} ${mode}`);
        assert.equal(ka, v.expect.keepalives, `${v.name} ${mode}`);
        assert.equal(d.pending, v.expect.pending, `${v.name} ${mode}`);
      }
    }
  }
});

test("ip_allowlist.json: todos los vectores", () => {
  const { vectors } = load<{ name: string; cidrs: string[]; ip: string; allowed: boolean }>("ip_allowlist.json");
  for (const v of vectors) assert.equal(ipAllowed(v.cidrs, v.ip), v.allowed, v.name);
});

test("hex/*.hex y bin/*.bin coinciden con request.json y response.json", () => {
  const all = [...load<{ name: string; hex: string }>("request.json").vectors.map((v) => ["req_" + v.name, v.hex] as const),
    ...load<{ name: string; hex: string }>("response.json").vectors.map((v) => ["resp_" + v.name, v.hex] as const)];
  const hexFiles = new Set(readdirSync(join(VEC, "hex")));
  let n = 0;
  for (const [name, hex] of all) {
    if (!hexFiles.has(name + ".hex")) continue;
    const fromHex = readFileSync(join(VEC, "hex", name + ".hex"), "utf8").trim();
    assert.equal(fromHex, hex, name);
    const bin = readFileSync(join(VEC, "bin", name + ".bin"));
    assert.equal(bytesToHex(bin), hex, name);
    n++;
  }
  assert.equal(n, all.length);
});
