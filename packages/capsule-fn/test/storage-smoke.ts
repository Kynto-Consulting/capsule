// Run by backend/internal/fn/storage_sdk_test.go against Capsule's own object store: the SDK's ctx.storage does a real signed
// PUT, GET and HEAD with the access that the `storage:<name>` scope resolved to. Prints one JSON line with what it saw.
import { buildCtx } from "../src/index.ts";

const name = process.env.SMOKE_BUCKET ?? "biblioteca";
const ctx = buildCtx(process.env);
const out: Record<string, unknown> = {};

const bucket = ctx.storage.bucket(name);
const body = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
await bucket.put("expedientes/exp-001.pdf", body, "application/pdf");
await bucket.put("nota.txt", "hola desde la función");
out.putBytes = body.length;
out.getEqual = Buffer.compare(await bucket.get("expedientes/exp-001.pdf"), body) === 0;
out.getText = (await bucket.get("nota.txt")).toString();
out.headSize = (await bucket.head("expedientes/exp-001.pdf"))?.size;
out.headMissing = await bucket.head("no-existe.bin");
// streaming multipart upload (3 parts of 5 MiB + a tail) with UTF-8 metadata, then head, then paginated list
const MiB = 1024 * 1024;
const total = 3 * 5 * MiB + 1234;
async function* source() {
  for (let i = 0; i < total; i += 777_777) yield new Uint8Array(Math.min(777_777, total - i)).fill(i % 251);
}
const up = await bucket.upload("migracion/García/escrito final.pdf", source(), { size: total, partSize: 5 * MiB, contentType: "application/pdf", metadata: { "source-path": String.raw`\\srv\Expedientes\García\escrito final.pdf`, mtime: "2024-03-01T10:00:00Z" } });
out.uploadSize = up.size;
out.uploadEtagParts = up.etag.split("-")[1];
const info = await bucket.head("migracion/García/escrito final.pdf");
out.uploadHeadSize = info?.size;
out.uploadMeta = info?.metadata;
out.uploadContentType = info?.contentType;
const small = await bucket.upload("migracion/nota.txt", Buffer.from("pequeño"), { metadata: { origen: "smb" } });
out.smallSize = small.size;
out.smallMeta = (await bucket.head("migracion/nota.txt"))?.metadata;
try {
  await bucket.upload("migracion/corto.bin", source(), { size: total + 1, partSize: 5 * MiB });
  out.wrongSize = "accepted";
} catch (e) {
  out.wrongSize = (e as Error).message;
}
out.wrongSizeStored = (await bucket.head("migracion/corto.bin")) !== null;
const keys: string[] = [];
let after: string | undefined;
let pages = 0;
do {
  const page = await bucket.list("migracion/", { after, limit: 1 });
  keys.push(...page.items.map((i) => i.key));
  after = page.next;
  pages++;
} while (after && pages < 10);
out.listKeys = keys;
out.listPages = pages;
try {
  ctx.storage.bucket("otro");
  out.otherScope = "allowed";
} catch (e) {
  out.otherScope = (e as Error).message;
}
console.log(JSON.stringify(out));
