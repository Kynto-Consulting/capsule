import type { Readable } from "node:stream";

/** 8 MiB: the part size of the migration protocol (list -> known -> parts -> close). */
export const PART_SIZE = 8 * 1024 * 1024;

export interface ResumableUpload {
  /** Opens (or resumes) the upload and returns the indexes of the parts the server already has. */
  init(): Promise<{ known: number[] } | void>;
  /** Sends one part (index, bytes). Retried with backoff. */
  putPart(index: number, bytes: Buffer): Promise<void>;
  /** Closes the upload once every part is in. */
  close(info: { parts: number; size: number }): Promise<void>;
  /** Bytes of the source, or the source itself; a Readable is consumed once and cut in PART_SIZE chunks. */
  source: Buffer | Readable;
  partSize?: number;
  retries?: number;
  onProgress?(sent: number): void;
}

export interface Api {
  readonly base: string;
  /** fetch against the app's API with the run's short-lived token (`Authorization: Bearer capfn_...`). */
  fetch(pathOrUrl: string, init?: RequestInit): Promise<Response>;
  /** Resumable upload in 8 MiB parts: asks which parts are known, sends only the missing ones, then closes. */
  upload(u: ResumableUpload): Promise<{ parts: number; skipped: number; bytes: number }>;
}

export function createApi(base: string, token: string, fetchImpl: typeof fetch = fetch): Api {
  const f: Api["fetch"] = (p, init = {}) => {
    const url = /^https?:\/\//.test(p) ? p : base.replace(/\/$/, "") + "/" + p.replace(/^\//, "");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetchImpl(url, { ...init, headers });
  };
  return { base, fetch: f, upload };
}

async function* chunks(src: Buffer | Readable, size: number): AsyncGenerator<Buffer> {
  if (Buffer.isBuffer(src)) {
    for (let o = 0; o < src.length; o += size) yield src.subarray(o, Math.min(o + size, src.length));
    return;
  }
  let pending: Buffer[] = [];
  let have = 0;
  for await (const c of src) {
    pending.push(c as Buffer);
    have += (c as Buffer).length;
    while (have >= size) {
      const all = Buffer.concat(pending);
      yield all.subarray(0, size);
      const rest = all.subarray(size);
      pending = rest.length ? [rest] : [];
      have = rest.length;
    }
  }
  if (have) yield Buffer.concat(pending);
}

async function upload(u: ResumableUpload): Promise<{ parts: number; skipped: number; bytes: number }> {
  const size = u.partSize ?? PART_SIZE;
  const retries = u.retries ?? 4;
  const init = await u.init();
  const known = new Set((init && init.known) || []);
  let index = 0;
  let skipped = 0;
  let bytes = 0;
  for await (const part of chunks(u.source, size)) {
    bytes += part.length;
    if (known.has(index)) {
      skipped++;
    } else {
      for (let attempt = 0; ; attempt++) {
        try {
          await u.putPart(index, part);
          break;
        } catch (e) {
          if (attempt >= retries) throw e;
          await new Promise((r) => setTimeout(r, Math.min(100 * 2 ** attempt, 5000)));
        }
      }
    }
    index++;
    u.onProgress?.(bytes);
  }
  await u.close({ parts: index, size: bytes });
  return { parts: index, skipped, bytes };
}
