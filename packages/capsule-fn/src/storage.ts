import { createHash, createHmac } from "node:crypto";

export interface BucketAccess {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS Signature V4 for the Capsule object store (S3 compatible, path style). Exported for tests. */
export function signV4(opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: Buffer | string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): Record<string, string> {
  const amz = opts.date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amz.slice(0, 8);
  const payload = hex(opts.body ?? "");
  const headers: Record<string, string> = { ...opts.headers, host: opts.url.host, "x-amz-date": amz };
  if (opts.service === "s3") headers["x-amz-content-sha256"] = payload;
  const names = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim()]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const query = [...opts.url.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : a[1]! < b[1]! ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const path = opts.service === "s3" ? opts.url.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/") : opts.url.pathname;
  const canonical = [opts.method, path, query, canonicalHeaders, names.join(";"), payload].join("\n");
  const scope = `${day}/${opts.region}/${opts.service}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + opts.secretAccessKey, day), opts.region), opts.service), "aws4_request");
  const sig = createHmac("sha256", key).update(sts).digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}`;
  return headers;
}

export interface Bucket {
  readonly name: string;
  put(key: string, body: Buffer | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<{ size: number } | null>;
}

export interface Storage {
  /** The bucket granted by a `storage:<name>` scope. */
  bucket(name: string): Bucket;
}

function envKey(name: string): string {
  return name.toUpperCase().replace(/[-.]/g, "_");
}

export function createStorage(env: NodeJS.ProcessEnv, granted: string[], fetchImpl: typeof fetch = fetch): Storage {
  return {
    bucket(name: string): Bucket {
      if (!granted.includes(`storage:${name}`)) throw new Error(`this function has no storage:${name} scope`);
      const p = `CAPSULE_STORAGE_${envKey(name)}_`;
      const a: BucketAccess = {
        endpoint: env[p + "ENDPOINT"] ?? "",
        bucket: env[p + "BUCKET"] ?? name,
        accessKeyId: env[p + "ACCESS_KEY_ID"] ?? "",
        secretAccessKey: env[p + "SECRET_ACCESS_KEY"] ?? "",
        region: env[p + "REGION"] ?? "us-east-1",
      };
      if (!a.endpoint || !a.accessKeyId) throw new Error(`storage:${name} is not available in this run (the object store is not configured for the project)`);
      const call = async (method: string, key: string, body?: Buffer | string, ct?: string) => {
        const url = new URL(`${a.endpoint.replace(/\/$/, "")}/${a.bucket}/${key.replace(/^\//, "")}`);
        const headers = signV4({ method, url, headers: ct ? { "content-type": ct } : {}, body, region: a.region, service: "s3", accessKeyId: a.accessKeyId, secretAccessKey: a.secretAccessKey, date: new Date() });
        return fetchImpl(url, { method, headers, body: body as any });
      };
      return {
        name,
        async put(key, body, ct) {
          const r = await call("PUT", key, body, ct);
          if (!r.ok) throw new Error(`storage put ${key}: ${r.status}`);
        },
        async get(key) {
          const r = await call("GET", key);
          if (!r.ok) throw new Error(`storage get ${key}: ${r.status}`);
          return Buffer.from(await r.arrayBuffer());
        },
        async head(key) {
          const r = await call("HEAD", key);
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`storage head ${key}: ${r.status}`);
          return { size: Number(r.headers.get("content-length") ?? 0) };
        },
      };
    },
  };
}
