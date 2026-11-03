#!/bin/bash
# One-off administration inside the Forgejo container. Secrets come from env, never from argv.
#   forgejo-bootstrap.sh auth             register the Capsule OIDC source (idempotent)
#   forgejo-bootstrap.sh emergency-admin  create break-glass admin and print a one-time API token
# env for auth: OIDC_CLIENT_ID OIDC_CLIENT_SECRET [CAPSULE_API_URL] [ADMIN_GROUP] [GROUP_TEAM_MAP]
set -euo pipefail
APP_INI="${FORGEJO_APP_INI:-/data/gitea/conf/app.ini}"
fj() { su-exec git forgejo --config "$APP_INI" "$@"; }

case "${1:-}" in
  auth)
    : "${OIDC_CLIENT_ID:?}" "${OIDC_CLIENT_SECRET:?}"
    API="${CAPSULE_API_URL:-https://api.tumi-ai.com}"
    if fj admin auth list | awk '{print $2}' | grep -qx capsule; then
      echo "auth source 'capsule' already exists (use 'forgejo admin auth update-oauth' to change it)"; exit 0
    fi
    args=(admin auth add-oauth --provider openidConnect --name capsule
      --key "$OIDC_CLIENT_ID" --secret "$OIDC_CLIENT_SECRET"
      --auto-discover-url "$API/.well-known/openid-configuration"
      --scopes openid --scopes profile --scopes email --scopes groups --group-claim-name groups)
    [ -n "${ADMIN_GROUP:-}" ] && args+=(--admin-group "$ADMIN_GROUP")
    [ -n "${GROUP_TEAM_MAP:-}" ] && args+=(--group-team-map "$GROUP_TEAM_MAP" --group-team-map-removal)
    fj "${args[@]}"
    ;;
  emergency-admin)
    NAME="${EMERGENCY_ADMIN_NAME:-emergency-admin}"
    : "${EMERGENCY_ADMIN_EMAIL:?}"
    fj admin user create --admin --username "$NAME" --email "$EMERGENCY_ADMIN_EMAIL" --random-password
    echo "Token (shown once, store offline):"
    fj admin user generate-access-token --username "$NAME" --token-name breakglass --scopes all --raw
    ;;
  *) echo "usage: $0 auth|emergency-admin" >&2; exit 2 ;;
esac
