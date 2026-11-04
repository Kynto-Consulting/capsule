#!/usr/bin/env bash
# control.sh start|stop : the REAL backend (cmd/server) against the disposable control database. Clean environment: no AWS credentials.
set -euo pipefail
W=${W:-/tmp/capsule-interop}; HERE=$(cd "$(dirname "$0")" && pwd)
SEED=$(printf 'interop-signing-seed-0123456789!' | head -c 32 | base64)
case "${1:-}" in
start)
  mkdir -p "$W/run"
  nohup env -i PATH=/usr/bin:/bin HOME="$W" \
    DATABASE_URL="postgres://postgres:interop-pg-pass@127.0.0.1:55440/capsule?sslmode=disable" \
    CAPSULE_SECRET_KEY=interop-secret-key-0123456789abcdef0123 CAPSULE_ENV=development CAPSULE_PORT=18080 CAPSULE_LOG_LEVEL=info \
    CAPSULE_TCP_HOST=tcp.interop.test REDIS_URL=redis://127.0.0.1:1/0 AWS_EC2_METADATA_DISABLED=true AWS_DEFAULT_REGION=us-east-1 \
    CAPSULE_GW_SECRET=interop-gw-secret-do-not-use CAPSULE_GW_ZONE=interop.test CAPSULE_GW_DEST_HOST=127.0.0.1 \
    CAPSULE_GW_POOL=20000-20019 CAPSULE_GW_SIGNING_KEY="$SEED" CAPSULE_GW_POLL_UNUSED=1 \
    "$HERE/bin/capsule-server" > "$W/server.log" 2>&1 &
  echo $! > "$W/run/server.pid"
  for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w %{http_code} http://127.0.0.1:18080/health)" != 000 ] && { echo started; exit 0; }; sleep 0.5; done
  echo "backend did not become healthy"; tail -20 "$W/server.log"; exit 1 ;;
stop)
  [ -f "$W/run/server.pid" ] && kill "$(cat "$W/run/server.pid")" 2>/dev/null || true; echo stopped ;;
esac
