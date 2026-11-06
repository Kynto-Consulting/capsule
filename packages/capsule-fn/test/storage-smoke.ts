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
try {
  ctx.storage.bucket("otro");
  out.otherScope = "allowed";
} catch (e) {
  out.otherScope = (e as Error).message;
}
console.log(JSON.stringify(out));
