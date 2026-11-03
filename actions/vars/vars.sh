#!/usr/bin/env bash
# Syncs KEY=VALUE variables to Capsule (account: `capsule vars set`, project: `capsule env set`).
# Values are masked with ::add-mask:: BEFORE anything else when SECRET=true, and are never printed.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/capsule.sh"

TARGET="${V_TARGET:-}"; SECRET="${V_SECRET:-false}"; SCOPE="${V_SCOPE:-runtime}"; DRY="${V_DRY_RUN:-false}"
BLOCK="${V_VARIABLES:-}"; FILE="${V_FILE:-}"

if [ -n "${CAPSULE_TOKEN:-}" ]; then cap_mask "$CAPSULE_TOKEN"; fi

if [ -z "$TARGET" ]; then
  if [ -n "${CAPSULE_PROJECT_ID:-}" ]; then TARGET=project; else TARGET=account; fi
fi
case "$TARGET" in account|project) ;; *) cap_err "target must be 'account' or 'project' (got '${TARGET}')"; exit 1;; esac
case "$SECRET" in true|false) ;; *) cap_err "secret must be 'true' or 'false'"; exit 1;; esac
case "$DRY" in true|false) ;; *) cap_err "dry-run must be 'true' or 'false'"; exit 1;; esac
case "$SCOPE" in build|runtime|both) ;; *) cap_err "variable-scope must be build, runtime or both"; exit 1;; esac
[ -z "$BLOCK" ] && [ -z "$FILE" ] && { cap_err "provide 'variables' and/or 'file'"; exit 1; }
if [ "$TARGET" = project ] && [ -z "${CAPSULE_PROJECT_ID:-}" ]; then cap_err "project target needs project-id"; exit 1; fi
[ "$DRY" = true ] || cap_require CAPSULE_TOKEN CAPSULE_ORG_ID CAPSULE_API_URL || exit 1

content="$BLOCK"
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || { cap_err "file '${FILE}' not found"; exit 1; }
  content="$(cat "$FILE")"$'\n'"$BLOCK"
fi

keys=(); vals=()
lineno=0
while IFS= read -r line || [ -n "$line" ]; do
  lineno=$((lineno+1))
  line="${line%$'\r'}"
  trimmed="${line#"${line%%[![:space:]]*}"}"
  case "$trimmed" in ''|'#'*) continue;; esac
  trimmed="${trimmed#export }"
  if [[ "$trimmed" != *=* ]]; then cap_err "line ${lineno}: expected KEY=VALUE (value not shown)"; exit 1; fi
  k="${trimmed%%=*}"; v="${trimmed#*=}"
  k="${k//[[:space:]]/}"
  if ! [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then cap_err "line ${lineno}: invalid variable name '${k}'"; exit 1; fi
  # strip one pair of matching surrounding quotes
  if [[ "$v" =~ ^\"(.*)\"$ ]] || [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
  keys+=("$k"); vals+=("$v")
done <<< "$content"

[ "${#keys[@]}" -gt 0 ] || { cap_err "no variables found"; exit 1; }

# Mask every secret value before it is used for anything.
if [ "$SECRET" = true ]; then
  for v in "${vals[@]}"; do cap_mask "$v"; done
fi

echo "Syncing ${#keys[@]} variable(s) to ${TARGET} scope (secret=${SECRET}, scope=${SCOPE}, dry-run=${DRY})"
fail=0
for i in "${!keys[@]}"; do
  k="${keys[$i]}"; v="${vals[$i]}"
  if [ "$DRY" = true ]; then echo "  [dry-run] would set ${k}$([ "$SECRET" = true ] && echo ' (secret)')"; continue; fi
  args=()
  if [ "$TARGET" = account ]; then args=(vars set "${k}=${v}" --org "$CAPSULE_ORG_ID"); else args=(env set "${k}=${v}" --org "$CAPSULE_ORG_ID" --project "$CAPSULE_PROJECT_ID"); fi
  args+=(--scope "$SCOPE")
  [ "$SECRET" = true ] && args+=(--secret)
  out="$(capsule "${args[@]}" 2>&1)"; rc=$?
  if [ $rc -eq 0 ]; then echo "  set ${k}$([ "$SECRET" = true ] && echo ' (secret)')"
  else echo "  FAILED ${k} (exit ${rc})"; printf '%s\n' "${out//"$v"/***}" | head -5 | sed 's/^/    /'; fail=1; fi
done
unset vals v
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { printf '### Capsule variables (%s)\n' "$TARGET"; for k in "${keys[@]}"; do printf -- '- `%s`\n' "$k"; done; } >> "$GITHUB_STEP_SUMMARY"
fi
cap_out count "${#keys[@]}"
exit $fail
