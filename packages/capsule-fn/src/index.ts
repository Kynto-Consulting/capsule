import { createApi, PART_SIZE, type Api, type ResumableUpload } from "./api.js";
import { createStorage, signV4, type Storage } from "./storage.js";
import { createVpn, type Vpn } from "./vpn.js";

export { PART_SIZE, signV4 };
export type { Api, ResumableUpload, Storage, Vpn };

export interface Db {
  /** Connection URL of a project database granted by a `db:<name>` scope (internal route host.docker.internal:<port>). */
  url(name: string): string;
}

export interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

export interface Ctx {
  run: { id: string; function: string; scopes: string[] };
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
  return {
    run: { id: env.CAPSULE_RUN_ID ?? "", function: env.CAPSULE_FN ?? "", scopes },
    payload,
    log,
    vpn: createVpn(env.CAPSULE_VPN_SOCKS),
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
