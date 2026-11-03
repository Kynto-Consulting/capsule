#!/usr/bin/env bash
# Rolls back via `capsule deployments rollback` and requires the resulting deployment to be `success`.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/../_lib/capsule.sh"
cap_init || exit 1
LIMIT="$(cap_secs "${CAPSULE_TIMEOUT:-10m}")" || exit 1
command -v capsule >/dev/null || { cap_err "capsule CLI not found in PATH"; exit 1; }

LIST="/api/v1/orgs/${CAPSULE_ORG_ID}/projects/${CAPSULE_PROJECT_ID}/deployments"
cap_api GET "$LIST"
cap_http_ok "listing deployments" || exit 1
before="$(cap_latest_id)"

echo "Rolling back project ${CAPSULE_PROJECT_ID} (latest deployment: ${before:-none})"
if ! timeout "${LIMIT}" capsule deployments rollback; then
  cap_err "capsule deployments rollback failed (see output above)"
  cap_out status failed
  exit 1
fi

# The CLI polls to a terminal state; verify independently from the API.
cap_api GET "$LIST"
cap_http_ok "listing deployments" || exit 1
new_id="$(cap_latest_id)"
if [ -z "$new_id" ] || [ "$new_id" = "$before" ]; then
  cap_err "rollback did not create a new deployment (latest is still ${before:-none})"
  cap_out status failed
  exit 1
fi
CAP_POLL_SLEEP="${CAP_POLL_SLEEP:-3}"
if cap_wait_deployment "$new_id" "$LIMIT"; then
  echo "Rollback deployment ${new_id}: success"
  cap_out deployment-id "$new_id"; cap_out status success
else
  cap_err "rollback deployment ${new_id} ended as '${CAP_DEP_STATUS}', not 'success'"
  cap_out deployment-id "$new_id"; cap_out status "${CAP_DEP_STATUS:-failed}"
  exit 1
fi
