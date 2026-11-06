import { buildCtx, type Handler, type FunctionDef } from "./index.js";

/** What Capsule sends in each invocation of a function deployed with `--runtime lambda` (the backend's InvokePayload). */
export interface LambdaEvent {
  run_id: string;
  function: string;
  attempt: number;
  cursor?: unknown;
  payload?: unknown;
  env: Record<string, string>;
  budget_ms: number;
}

export interface LambdaResult {
  /** Present when the function asks Capsule to invoke it again with this cursor (a new token is minted for the next batch). */
  continue?: unknown;
}

/**
 * Entry point for an AWS Lambda image: `export const handler = lambdaHandler(defineFunction(async (ctx) => { ... }))`.
 *
 * Each invocation is one batch of at most ~13 minutes (Lambda caps an invocation at 15). Honour `ctx.batch.remainingMs()` and
 * return `{ continue: cursor }` before the budget runs out; Capsule re-invokes with `ctx.batch.cursor` and a fresh token until
 * the function returns anything else. Credentials arrive in the event, never in the Lambda's environment variables.
 */
export function lambdaHandler(def: FunctionDef | Handler): (event: LambdaEvent) => Promise<LambdaResult> {
  const handler = typeof def === "function" ? def : def.handler;
  return async (event) => {
    const env: NodeJS.ProcessEnv = {
      ...event.env,
      CAPSULE_RUN_ID: event.run_id,
      CAPSULE_FN: event.function,
      CAPSULE_BATCH_ATTEMPT: String(event.attempt),
      CAPSULE_BATCH_BUDGET_MS: String(event.budget_ms),
    };
    if (event.payload !== undefined && event.payload !== null) env.CAPSULE_PAYLOAD = JSON.stringify(event.payload);
    if (event.cursor !== undefined && event.cursor !== null) env.CAPSULE_BATCH_CURSOR = JSON.stringify(event.cursor);
    const ctx = buildCtx(env);
    const out = await handler(ctx);
    if (out && typeof out === "object" && "continue" in out && (out as LambdaResult).continue != null) {
      return { continue: (out as LambdaResult).continue };
    }
    if (out !== undefined) ctx.log.info(out);
    return {};
  };
}
