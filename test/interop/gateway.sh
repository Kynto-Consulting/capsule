#!/usr/bin/env bash
# gateway.sh start|stop|reload|term : the REAL capsule-gateway binary against the real backend, with the self-signed test certificate.
#   IPv4 + IPv6 listeners on 18443 (two sockets, SO_REUSEPORT), admin on 127.0.0.1:19102.
#   CGC=none starts without local cgc_ keys (the control plane then verifies cgc_ tokens through /authorize).
set -euo pipefail
W=${W:-/tmp/capsule-interop}; HERE=$(cd "$(dirname "$0")" && pwd)
case "${1:-}" in
start)
  mkdir -p "$W/run"
  keys=""
  if [ "${CGC:-local}" != none ]; then
    kj=$(curl -s -m 3 -H "X-Gateway-Secret: interop-gw-secret-do-not-use" http://127.0.0.1:18080/internal/gateway/keys || true)
    kid=$(echo "$kj" | grep -o "\"kid\":\"[^\"]*\"" | head -1 | cut -d\" -f4 || true); x=$(echo "$kj" | grep -o "\"x\":\"[^\"]*\"" | head -1 | cut -d\" -f4 || true)
    if [ -n "$x" ]; then keys="$kid=$x"; echo "$keys" > "$W/run/cgc.keys"; elif [ -f "$W/run/cgc.keys" ]; then keys=$(cat "$W/run/cgc.keys"); fi
  fi
  nohup env -i PATH=/usr/bin:/bin HOME="$W" \
    CAPSULE_GW_LISTEN="${GW_LISTEN:-0.0.0.0:18443,[::]:18443}" CAPSULE_GW_ZONE=interop.test CAPSULE_GW_CONTROL_URL=http://127.0.0.1:18080 \
    CAPSULE_GW_SECRET=interop-gw-secret-do-not-use CAPSULE_GW_TLS_CERT="$W/certs/gw.crt" CAPSULE_GW_TLS_KEY="$W/certs/gw.key" \
    CAPSULE_GW_METRICS_ADDR="${GW_ADMIN:-127.0.0.1:19102}" CAPSULE_GW_ROUTES_CACHE="$W/run/routes.cache" CAPSULE_GW_ALLOW_LOOPBACK_DEST=true \
    CAPSULE_GW_ROUTES_WAIT=10s CAPSULE_GW_CGC_KEYS="$keys" CAPSULE_GW_LOG_LEVEL=debug CAPSULE_GW_DRAIN_TIMEOUT=60s ${GWENV:-} \
    "$HERE/bin/capsule-gateway" >> "$W/${GW_NAME:-gateway}.log" 2>&1 &
  echo $! > "$W/run/${GW_NAME:-gateway}.pid"
  for i in $(seq 1 60); do curl -fs -o /dev/null "http://${GW_ADMIN:-127.0.0.1:19102}/readyz" && { echo "started keys=${keys:+yes}"; exit 0; }; sleep 0.25; done
  echo "gateway not ready"; tail -5 "$W/${GW_NAME:-gateway}.log" | cut -c1-300; exit 1 ;;
reload) kill -HUP "$(cat "$W/run/${GW_NAME:-gateway}.pid")"; echo hup ;;
term) kill -TERM "$(cat "$W/run/${GW_NAME:-gateway}.pid")"; echo term ;;
stop) [ -f "$W/run/${GW_NAME:-gateway}.pid" ] && kill -KILL "$(cat "$W/run/${GW_NAME:-gateway}.pid")" 2>/dev/null || true; echo stopped ;;
esac
