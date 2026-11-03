#!/usr/bin/env bash
# Shared helpers for the Capsule actions. Sourced, never executed.
# Requires: bash, curl, node (setup-node runs in every action that sources this).
# Secrets: the token is only ever handed to curl through stdin (-K -), never argv, never printed.

cap_mask() { [ -n "${1:-}" ] && printf '::add-mask::%s\n' "$1"; return 0; }
cap_err()  { printf '::error::%s\n' "$*" >&2; }
cap_warn() { printf '::warning::%s\n' "$*" >&2; }
cap_note() { printf '::notice::%s\n' "$*" >&2; }

# cap_out name value : write a step output (single-line values).
cap_out() { [ -n "${GITHUB_OUTPUT:-}" ] && printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"; return 0; }

# cap_secs 10m|90s|2h|600 -> seconds
cap_secs() {
  local v="${1:-}" n u
  if [[ "$v" =~ ^([0-9]+)([smh]?)$ ]]; then
    n="${BASH_REMATCH[1]}"; u="${BASH_REMATCH[2]}"
    case "$u" in h) echo $((n*3600));; m) echo $((n*60));; *) echo "$n";; esac
  else
    cap_err "invalid duration '$v' (use e.g. 90s, 10m, 1h)"; return 1
  fi
}

# cap_require VAR... : fail with a clear message when a variable is empty.
cap_require() {
  local v miss=0
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then cap_err "missing required input for ${v}"; miss=1; fi
  done
  return $miss
}

# cap_init : validates CAPSULE_* and masks the token.
cap_init() {
  cap_require CAPSULE_TOKEN CAPSULE_ORG_ID CAPSULE_PROJECT_ID CAPSULE_API_URL || return 1
  cap_mask "$CAPSULE_TOKEN"
  CAPSULE_API_URL="${CAPSULE_API_URL%/}"
  case "$CAPSULE_API_URL" in http://*|https://*) ;; *) cap_err "api-url must start with http:// or https://"; return 1;; esac
  CAP_RESP="$(mktemp)"
  export CAPSULE_API_URL CAP_RESP
}

# cap_api METHOD PATH [JSON_BODY]
# Sets CAP_HTTP (000 on network failure) and writes the response body to $CAP_RESP.
cap_api() {
  local method="$1" path="$2" body="${3:-}" args
  : > "$CAP_RESP"
  args=(-sS -o "$CAP_RESP" -w '%{http_code}' --max-time 60 -X "$method" -H 'Accept: application/json')
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data-binary "$body"); fi
  # The Authorization header travels on stdin so it never shows in `ps` or logs.
  CAP_HTTP="$(printf 'header = "Authorization: Bearer %s"\n' "$CAPSULE_TOKEN" | curl -K - "${args[@]}" "${CAPSULE_API_URL}${path}" 2>/dev/null)" || CAP_HTTP=000
  [ -n "$CAP_HTTP" ] || CAP_HTTP=000
}

# cap_http_ok [what] : 0 if CAP_HTTP is 2xx; otherwise prints a clear error and returns 1.
cap_http_ok() {
  local what="${1:-request}" msg=""
  case "$CAP_HTTP" in
    2??) return 0;;
    000) msg="could not reach ${CAPSULE_API_URL} (network error or timeout)";;
    401) msg="the API rejected the token (401). Check the CAPSULE_TOKEN secret.";;
    403) msg="the token is not allowed to do this (403). It needs scope 'deploy' on the (parent) project; rollback may need a full-access token.";;
    404) msg="endpoint or resource not found (404). The Capsule server may not support this feature yet, or org-id/project-id/PR is wrong.";;
    501) msg="the Capsule server does not implement this feature yet (501). Upgrade the backend.";;
    *)   msg="unexpected HTTP ${CAP_HTTP}";;
  esac
  cap_err "${what} failed: ${msg}"
  local detail
  detail="$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const m=j.error||j.message||"";process.stdout.write(String(typeof m==="object"?JSON.stringify(m):m).slice(0,300))}catch(e){}' "$CAP_RESP" 2>/dev/null)"
  if [ -n "$detail" ]; then printf 'server said: %s\n' "$detail" >&2; fi
  return 1
}

# cap_json FILE 'JS expression over d,j' : prints the value (empty if missing/invalid).
# d is the parsed body, unwrapped from {data: {...}} when data is an object; j is the raw body.
cap_json() {
  node -e '
    try {
      const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const d = (j && j.data && !Array.isArray(j.data) && typeof j.data === "object") ? j.data : j;
      const v = new Function("d", "j", "return (" + process.argv[2] + ")")(d, j);
      if (v !== undefined && v !== null) process.stdout.write(typeof v === "object" ? JSON.stringify(v) : String(v));
    } catch (e) {}
  ' "$1" "$2" 2>/dev/null
}

# Id of the newest deployment in the last list response (API returns newest first).
cap_latest_id() {
  cap_json "$CAP_RESP" 'Array.isArray(j.data)?(j.data[0]&&j.data[0].id):(Array.isArray(j)?(j[0]&&j[0].id):"")'
}

CAP_TERMINAL=" success failed cancelled error "

# cap_wait_deployment ID TIMEOUT_SECONDS : polls until terminal; prints progress; sets CAP_DEP_STATUS.
# Returns 0 only for `success`.
cap_wait_deployment() {
  local id="$1" limit="$2" start now last="" st
  start=$(date +%s)
  while :; do
    cap_api GET "/api/v1/orgs/${CAPSULE_ORG_ID}/projects/${CAPSULE_PROJECT_ID}/deployments/${id}"
    if [[ "$CAP_HTTP" == 2* ]]; then
      st="$(cap_json "$CAP_RESP" 'd.status')"
      if [ "$st" != "$last" ]; then echo "deployment ${id}: ${st:-unknown}"; last="$st"; fi
      CAP_DEP_STATUS="$st"
      if [[ "$CAP_TERMINAL" == *" $st "* ]]; then [ "$st" = success ]; return; fi
    elif [ "$CAP_HTTP" = 404 ] || [ "$CAP_HTTP" = 401 ] || [ "$CAP_HTTP" = 403 ]; then
      cap_http_ok "reading deployment ${id}" || true; CAP_DEP_STATUS=unknown; return 1
    fi
    now=$(date +%s)
    if [ $((now-start)) -ge "$limit" ]; then
      cap_err "timed out after ${limit}s waiting for deployment ${id} (last status: ${last:-unknown})"
      CAP_DEP_STATUS="${last:-timeout}"; return 1
    fi
    sleep "${CAP_POLL_SLEEP:-5}"
  done
}
