import { createHash, createHmac } from "node:crypto";

export interface BucketAccess {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

const hex = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS Signature V4 for the Capsule object store (S3 compatible, path style). Exported for tests. */
export function signV4(opts: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: Uint8Array | string;
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

/** Default part of `Bucket.upload`: 8 MiB (S3 minimum is 5 MiB except for the last part). */
export const UPLOAD_PART_SIZE = 8 * 1024 * 1024;
const MIN_PART = 5 * 1024 * 1024;
const MAX_PART = 5 * 1024 * 1024 * 1024;
const MAX_PARTS = 10_000;

export interface UploadOptions {
  /** Expected total size in bytes. A source that yields a different amount fails the upload (and aborts it). */
  size?: number;
  contentType?: string;
  /** User metadata (x-amz-meta-*). Names are stored in lower case; values may be any UTF-8 text (2 KB in total). */
  metadata?: Record<string, string>;
  /** Bytes per part (default 8 MiB, between 5 MiB and 5 GiB). Only one part is held in memory at a time. */
  partSize?: number;
}

export interface ObjectInfo {
  size: number;
  /** User metadata (x-amz-meta-*), names in lower case. Empty when the object has none. */
  metadata: Record<string, string>;
  etag: string;
  contentType?: string;
  lastModified?: Date;
}

export interface ListItem {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
}

export interface ListPage {
  items: ListItem[];
  /** Pass as `after` to read the next page; undefined on the last page. */
  next?: string;
}

export interface Bucket {
  readonly name: string;
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Size and metadata of an object, or null when it does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /**
   * Streams `source` into `key` without holding it in memory: a single PUT when it fits in one part, otherwise a multipart
   * upload (CreateMultipartUpload → UploadPart → CompleteMultipartUpload) that is aborted if anything fails.
   */
  upload(key: string, source: AsyncIterable<Uint8Array> | Uint8Array, opts?: UploadOptions): Promise<{ size: number; etag: string }>;
  /** Objects whose key starts with `prefix`, in key order, at most `limit` (default and maximum 1000) per page. */
  list(prefix: string, opts?: { after?: string; limit?: number }): Promise<ListPage>;
}

export interface Storage {
  /** The bucket granted by a `storage:<name>` scope. */
  bucket(name: string): Bucket;
}

function envKey(name: string): string {
  return name.toUpperCase().replace(/[-.]/g, "_");
}

// Header values must be ASCII: anything else travels as an RFC 2047 encoded word (what S3 itself returns for UTF-8 metadata).
function encodeMeta(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
function decodeMeta(v: string): string {
  const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/i.exec(v);
  return m ? Buffer.from(m[1]!, "base64").toString("utf8") : v;
}

const xmlText = (s: string) =>
  s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlText(m[1]!) : undefined;
};
const unquote = (e: string | null | undefined) => (e ?? "").replace(/^"|"$/g, "");

/** Splits a source into parts of exactly `size` bytes (the last may be shorter; an empty source gives one empty part), holding at most one part. */
export async function* splitParts(source: AsyncIterable<Uint8Array> | Uint8Array, size: number): AsyncGenerator<Buffer> {
  if (source instanceof Uint8Array) {
    for (let i = 0; i < source.length; i += size) yield Buffer.from(source.buffer, source.byteOffset + i, Math.min(size, source.length - i));
    if (source.length === 0) yield Buffer.alloc(0);
    return;
  }
  let chunks: Buffer[] = [];
  let have = 0;
  let any = false;
  for await (const c of source) {
    let b = Buffer.isBuffer(c) ? c : Buffer.from(c.buffer, c.byteOffset, c.byteLength);
    while (b.length > 0) {
      const take = Math.min(size - have, b.length);
      chunks.push(b.subarray(0, take));
      have += take;
      b = b.subarray(take);
      if (have === size) {
        any = true;
        yield Buffer.concat(chunks, have);
        chunks = [];
        have = 0;
      }
    }
  }
  if (have > 0 || !any) yield Buffer.concat(chunks, have);
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
      const base = a.endpoint.replace(/\/$/, "");
      // path style: <endpoint>/<bucket>/<key>, every segment of the key escaped the way SigV4 canonicalises it
      const urlOf = (key: string | null, query?: Record<string, string>) => {
        const path = key === null ? `/${a.bucket}` : `/${a.bucket}/${key.replace(/^\//, "").split("/").map(enc).join("/")}`;
        const u = new URL(base + path);
        for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
        return u;
      };
      const call = (method: string, url: URL, body?: Uint8Array | string, extra: Record<string, string> = {}) => {
        const headers = signV4({ method, url, headers: extra, body, region: a.region, service: "s3", accessKeyId: a.accessKeyId, secretAccessKey: a.secretAccessKey, date: new Date() });
        return fetchImpl(url, { method, headers, body: body as any });
      };
      const fail = async (what: string, r: Response) => {
        const text = await r.text().catch(() => "");
        const code = tag(text, "Code");
        return new Error(`storage ${what}: ${r.status}${code ? " " + code : ""}`);
      };
      const metaHeaders = (o: UploadOptions) => {
        const h: Record<string, string> = {};
        if (o.contentType) h["content-type"] = o.contentType;
        for (const [k, v] of Object.entries(o.metadata ?? {})) {
          if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(k)) throw new Error(`storage metadata name ${JSON.stringify(k)}: use letters, digits, '-', '_' or '.'`);
          h["x-amz-meta-" + k.toLowerCase()] = encodeMeta(String(v));
        }
        return h;
      };
      // network errors and 5xx are retried (a part is idempotent: the same number with the same bytes)
      const withRetry = async (what: string, f: () => Promise<Response>): Promise<Response> => {
        let last: unknown;
        for (let i = 0; i < 3; i++) {
          try {
            const r = await f();
            if (r.status < 500) return r;
            last = await fail(what, r);
          } catch (e) {
            last = e;
          }
          if (i < 2) await new Promise((res) => setTimeout(res, 200 * 2 ** i));
        }
        throw last;
      };

      return {
        name,
        async put(key, body, ct) {
          const r = await call("PUT", urlOf(key), body, ct ? { "content-type": ct } : {});
          if (!r.ok) throw await fail(`put ${key}`, r);
        },
        async get(key) {
          const r = await call("GET", urlOf(key));
          if (!r.ok) throw await fail(`get ${key}`, r);
          return Buffer.from(await r.arrayBuffer());
        },
        async head(key) {
          const r = await call("HEAD", urlOf(key));
          if (r.status === 404) return null;
          if (!r.ok) throw new Error(`storage head ${key}: ${r.status}`);
          const metadata: Record<string, string> = {};
          r.headers.forEach((v, k) => {
            if (k.toLowerCase().startsWith("x-amz-meta-")) metadata[k.toLowerCase().slice("x-amz-meta-".length)] = decodeMeta(v);
          });
          const lm = r.headers.get("last-modified");
          return {
            size: Number(r.headers.get("content-length") ?? 0),
            metadata,
            etag: unquote(r.headers.get("etag")),
            contentType: r.headers.get("content-type") ?? undefined,
            lastModified: lm ? new Date(lm) : undefined,
          };
        },
        async upload(key, source, opts = {}) {
          let partSize = opts.partSize ?? UPLOAD_PART_SIZE;
          if (opts.size !== undefined && Math.ceil(opts.size / partSize) > MAX_PARTS) partSize = Math.ceil(opts.size / MAX_PARTS);
          if (partSize < MIN_PART || partSize > MAX_PART) throw new Error(`storage upload ${key}: partSize must be between 5 MiB and 5 GiB`);
          const headers = metaHeaders(opts);
          const checkSize = (n: number) => {
            if (opts.size !== undefined && n !== opts.size) throw new Error(`storage upload ${key}: the source gave ${n} bytes, expected ${opts.size}`);
          };
          const it = splitParts(source, partSize)[Symbol.asyncIterator]();
          const first = await it.next();
          const firstPart = first.done ? Buffer.alloc(0) : first.value;
          const second = first.done ? first : await it.next();
          if (second.done) {
            // fits in one part: a single PUT
            checkSize(firstPart.length);
            const r = await withRetry(`put ${key}`, () => call("PUT", urlOf(key), firstPart, headers));
            if (!r.ok) throw await fail(`put ${key}`, r);
            return { size: firstPart.length, etag: unquote(r.headers.get("etag")) };
          }
          const init = await call("POST", urlOf(key, { uploads: "" }), undefined, headers);
          if (!init.ok) throw await fail(`upload ${key} (create)`, init);
          const uploadId = tag(await init.text(), "UploadId");
          if (!uploadId) throw new Error(`storage upload ${key}: the store returned no UploadId`);
          const done: { n: number; etag: string }[] = [];
          let total = 0;
          try {
            const send = async (body: Buffer) => {
              const n = done.length + 1;
              if (n > MAX_PARTS) throw new Error(`storage upload ${key}: more than ${MAX_PARTS} parts; pass a larger partSize or the size`);
              const r = await withRetry(`upload ${key} part ${n}`, () => call("PUT", urlOf(key, { partNumber: String(n), uploadId }), body));
              if (!r.ok) throw await fail(`upload ${key} part ${n}`, r);
              done.push({ n, etag: unquote(r.headers.get("etag")) });
              total += body.length;
            };
            await send(firstPart);
            await send(second.value);
            for (let x = await it.next(); !x.done; x = await it.next()) {
              if (x.value.length > 0) await send(x.value);
            }
            checkSize(total);
            const xml = `<CompleteMultipartUpload>${done.map((d) => `<Part><PartNumber>${d.n}</PartNumber><ETag>"${d.etag}"</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
            const r = await withRetry(`upload ${key} (complete)`, () => call("POST", urlOf(key, { uploadId }), xml, { "content-type": "application/xml" }));
            const text = await r.text();
            const code = tag(text, "Code");
            if (!r.ok || code) throw new Error(`storage upload ${key} (complete): ${r.status}${code ? " " + code : ""}`);
            return { size: total, etag: unquote(tag(text, "ETag")) };
          } catch (e) {
            await call("DELETE", urlOf(key, { uploadId })).catch(() => undefined); // abort: the store discards the parts
            throw e;
          }
        },
        async list(prefix, opts = {}) {
          const limit = Math.max(1, Math.min(1000, Math.floor(opts.limit ?? 1000)));
          const q: Record<string, string> = { "list-type": "2", prefix, "max-keys": String(limit), "encoding-type": "url" };
          if (opts.after) q["start-after"] = opts.after;
          const r = await call("GET", urlOf(null, q));
          if (!r.ok) throw await fail(`list ${prefix}`, r);
          const xml = await r.text();
          const items: ListItem[] = [];
          for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
            const c = m[1]!;
            items.push({
              key: decodeURIComponent(tag(c, "Key") ?? ""),
              size: Number(tag(c, "Size") ?? 0),
              etag: unquote(tag(c, "ETag")),
              lastModified: new Date(tag(c, "LastModified") ?? 0),
            });
          }
          const truncated = tag(xml, "IsTruncated") === "true";
          return { items, next: truncated && items.length ? items[items.length - 1]!.key : undefined };
        },
      };
    },
  };
}
