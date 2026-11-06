import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildCtx, UPLOAD_PART_SIZE } from "../src/index.ts";
import { splitParts } from "../src/storage.ts";

const MiB = 1024 * 1024;

/** A tiny S3 (path style) behind fetch: enough to see which calls the SDK makes and in which order. */
function fakeS3(opts: { failPart?: number } = {}) {
  const objects = new Map<string, { body: Buffer; meta: Record<string, string>; ct?: string }>();
  const uploads = new Map<string, { key: string; parts: Map<number, Buffer>; meta: Record<string, string> }>();
  const calls: string[] = [];
  let seq = 0;
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const h = init.headers as Record<string, string>;
    assert.match(h.authorization ?? "", /^AWS4-HMAC-SHA256 Credential=AKTEST\//, "every call is signed");
    const body = init.body === undefined ? Buffer.alloc(0) : Buffer.from(init.body as any);
    assert.equal(h["x-amz-content-sha256"], createHash("sha256").update(body).digest("hex"), "the signed payload hash is the body's");
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    const q = url.searchParams;
    const meta = Object.fromEntries(Object.entries(h).filter(([k]) => k.startsWith("x-amz-meta-")).map(([k, v]) => [k.slice(11), v]));
    calls.push(`${method} ${q.has("uploads") ? "create" : q.has("partNumber") ? "part" + q.get("partNumber") : q.has("uploadId") ? (method === "DELETE" ? "abort" : "complete") : q.get("list-type") ? "list" : "object"}`);
    assert.equal(bucket, "biblioteca");
    if (method === "POST" && q.has("uploads")) {
      const id = "u" + ++seq;
      uploads.set(id, { key, parts: new Map(), meta });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (method === "PUT" && q.has("partNumber")) {
      const n = Number(q.get("partNumber"));
      if (n === opts.failPart) return new Response("<Error><Code>InternalError</Code></Error>", { status: 500 });
      uploads.get(q.get("uploadId")!)!.parts.set(n, body);
      return new Response(null, { status: 200, headers: { etag: `"e${n}"` } });
    }
    if (method === "POST" && q.has("uploadId")) {
      const u = uploads.get(q.get("uploadId")!)!;
      const nums = [...String(body).matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
      objects.set(u.key, { body: Buffer.concat(nums.map((n) => u.parts.get(n)!)), meta: u.meta });
      uploads.delete(q.get("uploadId")!);
      return new Response(`<CompleteMultipartUploadResult><ETag>"abc-${nums.length}"</ETag></CompleteMultipartUploadResult>`);
    }
    if (method === "DELETE" && q.has("uploadId")) {
      uploads.delete(q.get("uploadId")!);
      return new Response(null, { status: 204 });
    }
    if (q.get("list-type") === "2") {
      const all = [...objects.keys()].filter((k) => k.startsWith(q.get("prefix") ?? "")).sort().filter((k) => !q.get("start-after") || k > q.get("start-after")!);
      const max = Number(q.get("max-keys"));
      const page = all.slice(0, max);
      const esc = (k: string) => k.split("/").map(encodeURIComponent).join("/");
      return new Response(`<ListBucketResult><IsTruncated>${all.length > max}</IsTruncated>${page.map((k) => `<Contents><Key>${esc(k)}</Key><LastModified>2026-11-06T00:00:00.000Z</LastModified><ETag>"x"</ETag><Size>${objects.get(k)!.body.length}</Size></Contents>`).join("")}</ListBucketResult>`);
    }
    if (method === "PUT") {
      objects.set(key, { body, meta, ct: h["content-type"] });
      return new Response(null, { status: 200, headers: { etag: '"single"' } });
    }
    if (method === "HEAD") {
      const o = objects.get(key);
      if (!o) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { "content-length": String(o.body.length), etag: '"single"', ...Object.fromEntries(Object.entries(o.meta).map(([k, v]) => ["x-amz-meta-" + k, v])) } });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;
  return { fetchImpl, objects, uploads, calls };
}

const env = {
  CAPSULE_SCOPES: "storage:biblioteca",
  CAPSULE_STORAGE_BIBLIOTECA_ENDPOINT: "https://estudio-storage.apps.example.com",
  CAPSULE_STORAGE_BIBLIOTECA_BUCKET: "biblioteca",
  CAPSULE_STORAGE_BIBLIOTECA_ACCESS_KEY_ID: "AKTEST",
  CAPSULE_STORAGE_BIBLIOTECA_SECRET_ACCESS_KEY: "secret-test",
};

async function* chunks(total: number, chunk: number) {
  for (let i = 0; i < total; i += chunk) yield new Uint8Array(Math.min(chunk, total - i)).fill(i / chunk % 251);
}

test("splitParts cuts any chunking into exact parts and keeps at most one in memory", async () => {
  const sizes: number[] = [];
  for await (const p of splitParts(chunks(5 * MiB * 2 + 10, 3 * MiB + 1), 5 * MiB)) sizes.push(p.length);
  assert.deepEqual(sizes, [5 * MiB, 5 * MiB, 10]);
  const empty: number[] = [];
  for await (const p of splitParts((async function* () {})(), 5 * MiB)) empty.push(p.length);
  assert.deepEqual(empty, [0]);
});

test("upload streams a large source as a multipart upload with metadata (UTF-8 values survive)", async () => {
  const s3 = fakeS3();
  const b = buildCtx({ ...env, CAPSULE_SCOPES: "storage:biblioteca" }, s3.fetchImpl).storage.bucket("biblioteca");
  const total = 2 * UPLOAD_PART_SIZE + 123;
  const res = await b.upload("expedientes/García 2024/exp #1.pdf", chunks(total, 1 * MiB), {
    size: total,
    contentType: "application/pdf",
    metadata: { "source-path": "\\\\srv\\Expedientes\\García 2024\\exp #1.pdf", mtime: "2024-03-01T10:00:00Z" },
  });
  assert.deepEqual(res, { size: total, etag: "abc-3" });
  assert.deepEqual(s3.calls, ["POST create", "PUT part1", "PUT part2", "PUT part3", "POST complete"]);
  const o = s3.objects.get("expedientes/García 2024/exp #1.pdf")!;
  assert.equal(o.body.length, total);
  const info = await b.head("expedientes/García 2024/exp #1.pdf");
  assert.equal(info!.size, total, "callers that only read size keep working");
  assert.equal(info!.metadata["source-path"], "\\\\srv\\Expedientes\\García 2024\\exp #1.pdf");
  assert.equal(info!.metadata.mtime, "2024-03-01T10:00:00Z");
  assert.equal(await b.head("no-existe"), null);
});

test("a small source is one PUT; a wrong size or a failing part aborts the upload", async () => {
  const s3 = fakeS3({ failPart: 2 });
  const b = buildCtx(env, s3.fetchImpl).storage.bucket("biblioteca");
  assert.deepEqual(await b.upload("nota.txt", Buffer.from("hola"), { metadata: { a: "1" } }), { size: 4, etag: "single" });
  assert.deepEqual(s3.calls, ["PUT object"]);
  await assert.rejects(b.upload("corto.bin", Buffer.alloc(10), { size: 11 }), /gave 10 bytes, expected 11/);

  s3.calls.length = 0;
  await assert.rejects(b.upload("grande.bin", chunks(UPLOAD_PART_SIZE * 2 + 1, MiB)), /part 2: 500 InternalError/);
  assert.deepEqual(s3.calls, ["POST create", "PUT part1", "PUT part2", "PUT part2", "PUT part2", "DELETE abort"], "retried 3 times, then aborted");
  assert.equal(s3.uploads.size, 0, "no upload is left behind");
  assert.equal(s3.objects.has("grande.bin"), false);

  await assert.rejects(b.upload("x", Buffer.alloc(1), { partSize: MiB }), /between 5 MiB and 5 GiB/);
  await assert.rejects(b.upload("x", Buffer.alloc(1), { metadata: { "mal nombre": "x" } }), /metadata name/);
});

test("list pages through a prefix with after/limit", async () => {
  const s3 = fakeS3();
  const b = buildCtx(env, s3.fetchImpl).storage.bucket("biblioteca");
  for (const k of ["a/1", "a/2 x", "a/3", "b/1"]) await b.put(k, "x");
  const p1 = await b.list("a/", { limit: 2 });
  assert.deepEqual(p1.items.map((i) => i.key), ["a/1", "a/2 x"]);
  assert.equal(p1.next, "a/2 x");
  const p2 = await b.list("a/", { after: p1.next, limit: 2 });
  assert.deepEqual(p2.items.map((i) => i.key), ["a/3"]);
  assert.equal(p2.next, undefined);
  assert.equal(p2.items[0]!.size, 1);
});
