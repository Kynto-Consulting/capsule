#!/usr/bin/env bash
# Waits for a deployed URL to answer with an expected status; optionally rolls back on failure.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../_lib/capsule.sh"

URL="${WH_URL:-}"; PATH_="${WH_PATH:-/}"; EXPECTED="${WH_EXPECTED:-2xx}"
RETRIES="${WH_RETRIES:-30}"; INTERVAL="${WH_INTERVAL:-10}"; BACKOFF="${WH_BACKOFF:-1.2}"
MAX_INTERVAL="${WH_MAX_INTERVAL:-30}"; REQ_TIMEOUT="${WH_REQUEST_TIMEOUT:-15}"
ROLLBACK="${WH_ROLLBACK:-false}"

[ -n "$URL" ] || { cap_err "input 'url' is required (the deployed URL, e.g. the deploy action's url output)"; exit 1; }
case "$URL" in http://*|https://*) ;; *) cap_err "url must start with http:// or https:// (got '${URL}')"; exit 1;; esac
[[ "$RETRIES" =~ ^[0-9]+$ && "$RETRIES" -ge 1 ]] || { cap_err "retries must be a positive integer"; exit 1; }
[[ "$INTERVAL" =~ ^[0-9]+$ && "$MAX_INTERVAL" =~ ^[0-9]+$ ]] || { cap_err "interval and max-interval must be integers (seconds)"; exit 1; }
[[ "$BACKOFF" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { cap_err "backoff must be a number (e.g. 1.5)"; exit 1; }
if [ "$ROLLBACK" = true ]; then cap_require CAPSULE_TOKEN CAPSULE_ORG_ID CAPSULE_PROJECT_ID CAPSULE_API_URL || { cap_err "rollback-on-failure needs token, org-id, project-id and api-url"; exit 1; }; fi
TOTAL="$(cap_secs "${WH_TIMEOUT:-10m}")" || exit 1

[ "${PATH_:0:1}" = "/" ] || PATH_="/${PATH_}"
TARGET="${URL%/}${PATH_}"

# matches CODE against "2xx", "200", or "200,204,301"
status_ok() {
  local code="$1" tok
  IFS=',' read -ra toks <<< "${EXPECTED// /}"
  for tok in "${toks[@]}"; do
    case "$tok" in
      [1-5]xx|[1-5]XX) [ "${code:0:1}" = "${tok:0:1}" ] && return 0;;
      "$code") return 0;;
    esac
  done
  return 1
}

# Optional server-side health (deployment.health) for fast failure.
server_health() {
  [ -n "${WH_DEPLOYMENT_ID:-}" ] && [ -n "${CAPSULE_TOKEN:-}" ] && [ -n "${CAPSULE_ORG_ID:-}" ] \
    && [ -n "${CAPSULE_PROJECT_ID:-}" ] && [ -n "${CAPSULE_API_URL:-}" ] || return 0
  cap_api GET "/api/v1/orgs/${CAPSULE_ORG_ID}/projects/${CAPSULE_PROJECT_ID}/deployments/${WH_DEPLOYMENT_ID}"
  [[ "$CAP_HTTP" == 2* ]] || return 0
  SERVER_HEALTH="$(cap_json "$CAP_RESP" 'd.health && d.health.status')"
  SERVER_DEP_STATUS="$(cap_json "$CAP_RESP" 'd.status')"
}

if [ -n "${CAPSULE_TOKEN:-}" ]; then cap_mask "$CAPSULE_TOKEN"; fi
if [ -n "${WH_DEPLOYMENT_ID:-}" ] && [ -n "${CAPSULE_TOKEN:-}" ]; then cap_init || exit 1; fi

echo "Waiting for ${TARGET} to answer ${EXPECTED} (up to ${RETRIES} attempts, ${TOTAL}s)"
start=$(date +%s); attempt=0; code=000; ok=false; wait_s="$INTERVAL"; SERVER_HEALTH=""; SERVER_DEP_STATUS=""
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$((attempt+1))
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$REQ_TIMEOUT" "$TARGET" 2>/dev/null)" || code=000
  [ -n "$code" ] || code=000
  if status_ok "$code"; then ok=true; echo "attempt ${attempt}/${RETRIES}: HTTP ${code} - healthy"; break; fi
  echo "attempt ${attempt}/${RETRIES}: HTTP ${code} (want ${EXPECTED})"
  server_health
  if [ "$SERVER_HEALTH" = "unhealthy" ]; then echo "server-side health check reports 'unhealthy'"; break; fi
  if [ "$SERVER_DEP_STATUS" = "failed" ]; then echo "deployment status is 'failed' (server rolled it back)"; break; fi
  now=$(date +%s)
  if [ $((now-start)) -ge "$TOTAL" ]; then echo "overall timeout (${TOTAL}s) reached"; break; fi
  [ "$attempt" -lt "$RETRIES" ] || break
  sleep "$wait_s"
  # exponential backoff, capped
  wait_s="$(awk -v w="$wait_s" -v b="$BACKOFF" -v m="$MAX_INTERVAL" 'BEGIN{n=int(w*b+0.5); if(n<w+0) n=w; if(n>m) n=m; print n}')"
done

server_health
cap_out healthy "$ok"; cap_out status-code "$code"; cap_out attempts "$attempt"; cap_out health "${SERVER_HEALTH:-unknown}"
cap_out rolled-back false
if [ "$ok" = true ]; then
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Health check\n- %s: HTTP %s after %s attempt(s)\n' "$TARGET" "$code" "$attempt" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

cap_err "${TARGET} did not become healthy: last HTTP ${code} after ${attempt} attempt(s)"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Health check FAILED\n- %s: last HTTP %s after %s attempt(s)\n' "$TARGET" "$code" "$attempt" >> "$GITHUB_STEP_SUMMARY"

if [ "$ROLLBACK" = true ]; then
  echo "rollback-on-failure is on: rolling back"
  if bash "$HERE/../rollback/rollback.sh"; then
    cap_out rolled-back true
    cap_err "deployment was unhealthy and has been rolled back to the previous successful deployment"
  else
    cap_err "rollback FAILED too; the project may be serving a broken deployment. Act manually."
  fi
fi
exit 1
