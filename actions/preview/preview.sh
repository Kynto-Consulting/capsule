#!/usr/bin/env bash
# Creates/updates (deploy) or removes (destroy) the Capsule preview of a pull request and keeps ONE PR comment.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/capsule.sh"

MODE="${P_ACTION:-deploy}"
case "$MODE" in deploy|destroy) ;; *) cap_err "action must be 'deploy' or 'destroy' (got '${MODE}')"; exit 1;; esac
cap_init || exit 1
LIMIT="$(cap_secs "${P_TIMEOUT:-10m}")" || exit 1
MARKER='<!-- capsule-preview -->'
BASE="/api/v1/orgs/${CAPSULE_ORG_ID}/projects/${CAPSULE_PROJECT_ID}/previews"

[ -n "${P_GIT_TOKEN:-}" ] && cap_mask "$P_GIT_TOKEN"

# ---- event data (PR number, head ref/sha, fork detection) ----
ev() { [ -f "${GITHUB_EVENT_PATH:-}" ] && node -e 'try{const e=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=new Function("e","return ("+process.argv[2]+")")(e);if(v!=null)process.stdout.write(String(v))}catch(x){}' "$GITHUB_EVENT_PATH" "$1"; }
PR="${P_PR_NUMBER:-}"; [ -n "$PR" ] || PR="$(ev 'e.pull_request&&e.pull_request.number || e.number')"
if ! [[ "$PR" =~ ^[0-9]+$ ]]; then cap_err "this is not a pull request event (no PR number). Run the action on pull_request events or pass 'pr-number'."; exit 1; fi
REF="${P_REF:-}"; [ -n "$REF" ] || REF="$(ev 'e.pull_request&&e.pull_request.head.ref')"; [ -n "$REF" ] || REF="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
SHA="${P_SHA:-}"; [ -n "$SHA" ] || SHA="$(ev 'e.pull_request&&e.pull_request.head.sha')"; [ -n "$SHA" ] || SHA="${GITHUB_SHA:-}"
HEAD_REPO="$(ev 'e.pull_request&&e.pull_request.head.repo&&e.pull_request.head.repo.full_name')"
if [ -n "$HEAD_REPO" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ "$HEAD_REPO" != "$GITHUB_REPOSITORY" ]; then
  cap_note "PR #${PR} comes from a fork (${HEAD_REPO}); secrets are unavailable to forks, so no preview is created."
  cap_out status skipped; cap_out url ''
  exit 0
fi

# ---- provider detection ----
PROVIDER="${P_PROVIDER:-auto}"
if [ "$PROVIDER" = auto ]; then
  if [ "${GITEA_ACTIONS:-}" = true ]; then PROVIDER=forgejo
  elif [ "${GITHUB_SERVER_URL:-https://github.com}" = "https://github.com" ]; then PROVIDER=github
  elif [[ "${GITHUB_API_URL:-}" == */api/v1* ]]; then PROVIDER=forgejo
  else PROVIDER=github; fi
fi
case "$PROVIDER" in github|forgejo|gitea) ;; *) cap_err "provider must be auto, github or forgejo"; exit 1;; esac
if [ "$PROVIDER" = github ]; then
  FORGE_API="${GITHUB_API_URL:-https://api.github.com}"; AUTH="Bearer"
else
  FORGE_API="${GITHUB_SERVER_URL%/}/api/v1"; AUTH="token"
fi

# forge METHOD PATH [BODY] -> FORGE_HTTP, body in $FORGE_RESP
FORGE_RESP="$(mktemp)"
forge() {
  local m="$1" p="$2" b="${3:-}" a
  a=(-sS -o "$FORGE_RESP" -w '%{http_code}' --max-time 30 -X "$m" -H 'Accept: application/json')
  [ -n "$b" ] && a+=(-H 'Content-Type: application/json' --data-binary "$b")
  FORGE_HTTP="$(printf 'header = "Authorization: %s %s"\n' "$AUTH" "$P_GIT_TOKEN" | curl -K - "${a[@]}" "${FORGE_API}${p}" 2>/dev/null)" || FORGE_HTTP=000
}

# ---- comment (never fails the job) ----
post_comment() {
  local text="$1" id page body
  [ "${P_COMMENT:-true}" = true ] || return 0
  if [ -z "${P_GIT_TOKEN:-}" ] || [ -z "${GITHUB_REPOSITORY:-}" ]; then cap_warn "no git token or repository: skipping the PR comment"; return 0; fi
  body="$(MARKER="$MARKER" TEXT="$text" node -e 'process.stdout.write(JSON.stringify({body:process.env.MARKER+"\n"+process.env.TEXT}))')"
  id=""
  for page in 1 2 3 4 5; do
    forge GET "/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments?per_page=100&limit=100&page=${page}"
    [[ "$FORGE_HTTP" == 2* ]] || { cap_warn "could not list PR comments (HTTP ${FORGE_HTTP}); the token needs pull-requests/issues write access"; return 0; }
    id="$(MARKER="$MARKER" node -e 'try{const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=a.find(x=>x.body&&x.body.startsWith(process.env.MARKER));if(c)process.stdout.write(String(c.id));process.stderr.write("")}catch(e){}' "$FORGE_RESP")"
    [ -n "$id" ] && break
    [ "$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length))}catch(e){process.stdout.write("0")}' "$FORGE_RESP")" -lt 100 ] && break
  done
  if [ -n "$id" ]; then
    forge PATCH "/repos/${GITHUB_REPOSITORY}/issues/comments/${id}" "$body"
  else
    forge POST "/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments" "$body"
  fi
  if [[ "$FORGE_HTTP" == 2* ]]; then if [ -n "$id" ]; then echo "PR comment updated"; else echo "PR comment created"; fi; else cap_warn "could not write the PR comment (HTTP ${FORGE_HTTP})"; fi
  return 0
}

has_cli_previews() { command -v capsule >/dev/null 2>&1 && capsule previews --help >/dev/null 2>&1; }

# ---------------------------------------------------------------- destroy
if [ "$MODE" = destroy ]; then
  echo "Removing preview of PR #${PR}"
  done_=false
  if has_cli_previews; then
    if capsule previews delete --pr "$PR"; then done_=true; else cap_warn "capsule previews delete failed; trying the API"; fi
  fi
  if [ "$done_" != true ]; then
    cap_api DELETE "${BASE}/${PR}"
    if [ "$CAP_HTTP" = 404 ]; then echo "preview for PR #${PR} does not exist (already removed?)"; done_=true
    elif cap_http_ok "deleting the preview"; then done_=true; fi
  fi
  [ "$done_" = true ] || exit 1
  cap_out status destroyed; cap_out url ''
  post_comment "**Capsule preview removed.** The preview environment of this pull request was deleted when it was closed."
  exit 0
fi

# ---------------------------------------------------------------- deploy
[ -n "$SHA" ] || { cap_err "could not determine the commit SHA"; exit 1; }
echo "Deploying preview of PR #${PR} (ref ${REF}, sha ${SHA:0:12})"
created=false
if has_cli_previews; then
  if capsule previews create --pr "$PR" --ref "$REF" --sha "$SHA"; then created=true
  else cap_err "capsule previews create failed (see output above)"; exit 1; fi
else
  cap_warn "the installed Capsule CLI has no 'previews' command; calling the API directly"
  payload="$(PR="$PR" REF="$REF" SHA="$SHA" node -e 'process.stdout.write(JSON.stringify({pr:Number(process.env.PR),ref:process.env.REF,sha:process.env.SHA}))')"
  cap_api POST "$BASE" "$payload"
  cap_http_ok "creating the preview" || exit 1
  created=true
fi

# Read back the authoritative state (works for both paths).
URL=""; STATUS=""; DEP=""
if [ "$created" = true ]; then
  if [ -s "$CAP_RESP" ] && { [ "${CAP_HTTP:-}" = 201 ] || [ "${CAP_HTTP:-}" = 200 ]; }; then
    URL="$(cap_json "$CAP_RESP" 'd.url')"; STATUS="$(cap_json "$CAP_RESP" 'd.status')"; DEP="$(cap_json "$CAP_RESP" 'd.deployment_id')"
  fi
  if [ -z "$URL" ] || [ -z "$STATUS" ]; then
    cap_api GET "$BASE"
    if cap_http_ok "listing previews"; then
      sel="(Array.isArray(j.data)?j.data:(Array.isArray(j)?j:[])).find(p=>Number(p.pr)===${PR})"
      URL="$(cap_json "$CAP_RESP" "(${sel}||{}).url")"; STATUS="$(cap_json "$CAP_RESP" "(${sel}||{}).status")"; DEP="$(cap_json "$CAP_RESP" "(${sel}||{}).deployment_id")"
    else exit 1; fi
  fi
fi
if [ -z "$URL" ]; then cap_err "the server did not return a preview URL for PR #${PR}"; exit 1; fi

# Wait until the preview reaches a terminal state. Previews live in their own ephemeral project,
# so poll the previews list of the parent (status of the preview itself) instead of the parent's deployments.
start=$(date +%s)
while [[ "$CAP_TERMINAL" != *" ${STATUS} "* ]] && [ "$STATUS" != running ] && [ "$STATUS" != active ] && [ "$STATUS" != ready ]; do
  now=$(date +%s)
  if [ $((now-start)) -ge "$LIMIT" ]; then cap_err "timed out after ${LIMIT}s waiting for the preview (status: ${STATUS:-unknown})"; break; fi
  sleep "${CAP_POLL_SLEEP:-5}"
  cap_api GET "$BASE"
  [[ "$CAP_HTTP" == 2* ]] || continue
  sel="(Array.isArray(j.data)?j.data:(Array.isArray(j)?j:[])).find(p=>Number(p.pr)===${PR})"
  s2="$(cap_json "$CAP_RESP" "(${sel}||{}).status")"
  [ -n "$s2" ] && [ "$s2" != "$STATUS" ] && echo "preview status: ${s2}"
  [ -n "$s2" ] && STATUS="$s2"
  u2="$(cap_json "$CAP_RESP" "(${sel}||{}).url")"; [ -n "$u2" ] && URL="$u2"
done
echo "preview: ${URL} (status: ${STATUS:-unknown})"
cap_out url "$URL"; cap_out status "${STATUS:-unknown}"
[ -n "$DEP" ] && cap_out deployment-id "$DEP"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Capsule preview\n- PR #%s: %s (%s)\n' "$PR" "$URL" "${STATUS:-unknown}" >> "$GITHUB_STEP_SUMMARY"

if [ "$STATUS" = success ] || [ "$STATUS" = running ] || [ "$STATUS" = active ] || [ "$STATUS" = ready ]; then
  post_comment "**Capsule preview ready**"$'\n\n'"- URL: ${URL}"$'\n'"- Commit: \`${SHA:0:12}\`"$'\n'"- Status: ${STATUS}"$'\n\n'"_Updated on every push; removed when the PR is closed._"
  exit 0
fi
post_comment "**Capsule preview failed**"$'\n\n'"- Commit: \`${SHA:0:12}\`"$'\n'"- Status: ${STATUS:-unknown}"$'\n'"- URL (if it came up): ${URL}"
cap_err "preview deployment ended as '${STATUS:-unknown}'"
exit 1
