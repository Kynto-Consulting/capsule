// Codec oracle for the byte-level comparison: runs the JS library's CAP1/CAPR encoders and decoders on a list of cases.
// argv[2] = path of a JSON file with an array of cases; prints one JSON array of results (same order).
import fs from "node:fs";

const lib = await import(new URL("../../../packages/gateway-js/dist/index.js", import.meta.url).href);
const cases = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const hex = (u) => Buffer.from(u).toString("hex");
const unhex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const addr = (c) => (c ? { ip: c.ip ?? c.addr, port: c.port } : undefined);

function respFields(f) {
  const x = f.tlvs ?? {};
  return {
    version: f.version, status: f.status, code: f.code, msg: f.msg,
    maxVersion: x.maxVersion, retryAfter: x.retryAfter, sessionId: x.sessionId ? hex(x.sessionId) : undefined,
    clientAddr: x.clientAddr ? { ip: x.clientAddr.ip ?? x.clientAddr.addr?.toString?.() ?? String(x.clientAddr.address ?? ""), port: x.clientAddr.port } : undefined,
    maxDatagram: x.maxDatagram, idleTimeout: x.idleTimeout,
  };
}

const out = cases.map((c) => {
  try {
    if (c.kind === "decReq") {
      const r = lib.decodeRequest(unhex(c.hex), c.eof);
      if (r.kind === "incomplete") return { r: "incomplete" };
      if (r.kind === "error") return { r: "err", status: r.status, code: r.code };
      const f = r.fields;
      return { r: "ok", consumed: r.consumed, f: { transport: f.transport, flags: f.flags, project: f.project, service: f.service, authType: f.authType, auth: f.auth, ignored: f.ignoredTlvs, nonce: f.nonce ? hex(f.nonce) : undefined, clientId: f.clientId } };
    }
    if (c.kind === "decResp") {
      const r = lib.decodeResponse(unhex(c.hex), c.eof);
      if (r.kind === "incomplete") return { r: "incomplete" };
      if (r.kind === "error") return { r: "err", error: r.error };
      return { r: "ok", consumed: r.consumed, f: respFields(r.fields) };
    }
    if (c.kind === "encReq") {
      const f = c.f;
      const b = lib.encodeRequest({ transport: f.transport, flags: f.flags, project: f.project, service: f.service, authType: f.authType, auth: f.auth,
        nonce: f.nonce ? unhex(f.nonce) : undefined, clientId: f.clientId || undefined, padding: f.padding || undefined });
      return { r: "ok", hex: hex(b) };
    }
  } catch (e) {
    return { r: "throw", message: String(e?.message ?? e).slice(0, 120) };
  }
  return { r: "throw", message: "unknown kind" };
});
process.stdout.write(JSON.stringify(out));
