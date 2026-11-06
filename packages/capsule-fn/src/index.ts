import { createApi, PART_SIZE, type Api, type ResumableUpload } from "./api.js";
import { createStorage, signV4, type Storage } from "./storage.js";
import { createVpn, type Vpn } from "./vpn.js";
import { relayConnect } from "./relay.js";
import { lambdaHandler, type LambdaEvent, type LambdaResult } from "./lambda.js";

export { PART_SIZE, signV4, relayConnect, lambdaHandler };
export type { Api, ResumableUpload, Storage, Vpn, LambdaEvent, LambdaResult };

export interface Db {
  /** Connection URL of a project database granted by a `db:<name>` scope (internal route host.docker.internal:<port>). */
  url(name: string): string;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

/** Resumable batches (functions with `--runtime lambda`; on the container runtime there is a single batch with no limit). */
export interface Batch {
  /** 0 for the first invocation of a run. */
  attempt: number;
  /** The cursor the previous batch returned in `{ continue: cursor }`; undefined on the first batch. */
  cursor: unknown;
  /** Milliseconds this batch may run (Infinity on the container runtime). */
  budgetMs: number;
  /** Milliseconds left in this batch. Return `{ continue: cursor }` before it reaches 0. */
  remainingMs(): number;
  /** True when less than `marginMs` (default 60 s) is left: time to checkpoint and return `{ continue: cursor }`. */
  shouldYield(marginMs?: number): boolean;
}

export interface Ctx {
  run: { id: string; function: string; scopes: string[] };
  batch: Batch;
  payload: unknown;
  log: Logger;
  vpn: Vpn;
  api: Api;
  db: Db;
  storage: Storage;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

const MARK = Symbol.for("capsule.fn");
export interface FunctionDef {
  [MARK]: true;
  handler: Handler;
}

/** `export default defineFunction(async (ctx) => { ... })` */
export function defineFunction(handler: Handler): FunctionDef {
  return { [MARK]: true, handler };
}

/** Masks the run token, database URLs (and their passwords) and any CAPSULE_* secret in log text. */
export function makeRedactor(env: NodeJS.ProcessEnv): (s: string) => string {
  const secrets = new Set<string>();
  const add = (v?: string) => v && v.length >= 4 && secrets.add(v);
  add(env.CAPSULE_TOKEN);
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("CAPSULE_DB_")) {
      add(v);
      try {
        add(decodeURIComponent(new URL(v!).password));
      } catch {}
    }
    if (/^CAPSULE_STORAGE_.*(SECRET|ACCESS)/.test(k)) add(v);
  }
  return (s) => {
    for (const v of secrets) s = s.split(v).join("***");
    return s;
  };
}

export function buildCtx(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Ctx {
  const mask = makeRedactor(env);
  const fmt = (a: unknown[]) => mask(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
  const log: Logger = {
    info: (...a) => process.stdout.write(fmt(a) + "\n"),
    warn: (...a) => process.stdout.write("WARN " + fmt(a) + "\n"),
    error: (...a) => process.stderr.write(fmt(a) + "\n"),
  };
  const scopes = (env.CAPSULE_SCOPES ?? "").split(",").filter(Boolean);
  let payload: unknown = undefined;
  if (env.CAPSULE_PAYLOAD) {
    try {
      payload = JSON.parse(env.CAPSULE_PAYLOAD);
    } catch {
      payload = env.CAPSULE_PAYLOAD;
    }
  }
  const started = Date.now();
  const budgetMs = env.CAPSULE_BATCH_BUDGET_MS ? Number(env.CAPSULE_BATCH_BUDGET_MS) : Infinity;
  let cursor: unknown = undefined;
  if (env.CAPSULE_BATCH_CURSOR) {
    try {
      cursor = JSON.parse(env.CAPSULE_BATCH_CURSOR);
    } catch {
      cursor = env.CAPSULE_BATCH_CURSOR;
    }
  }
  const remainingMs = () => Math.max(0, budgetMs - (Date.now() - started));
  const batch: Batch = { attempt: Number(env.CAPSULE_BATCH_ATTEMPT ?? 0), cursor, budgetMs, remainingMs, shouldYield: (m = 60_000) => remainingMs() < m };
  const relay = env.CAPSULE_VPN_RELAY && env.CAPSULE_TOKEN ? { url: env.CAPSULE_VPN_RELAY, token: env.CAPSULE_TOKEN } : undefined;
  return {
    run: { id: env.CAPSULE_RUN_ID ?? "", function: env.CAPSULE_FN ?? "", scopes },
    batch,
    payload,
    log,
    vpn: createVpn(env.CAPSULE_VPN_SOCKS, relay),
    api: createApi(env.CAPSULE_API ?? "", env.CAPSULE_TOKEN ?? "", fetchImpl),
    db: {
      url(name: string) {
        if (!scopes.includes(`db:${name}`)) throw new Error(`this function has no db:${name} scope`);
        const v = env[`CAPSULE_DB_${name.toUpperCase().replace(/[-.]/g, "_")}`];
        if (!v) throw new Error(`db:${name} is not available in this run`);
        return v;
      },
    },
    storage: createStorage(env, scopes, fetchImpl),
  };
}

/** Runs a defined function with the context of the current run. Returns the process exit code. */
export async function run(def: FunctionDef | Handler, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const handler = typeof def === "function" ? def : def.handler;
  const ctx = buildCtx(env);
  try {
    const out = await handler(ctx);
    if (out !== undefined) ctx.log.info(out);
    return 0;
  } catch (e) {
    ctx.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return 1;
  }
}
