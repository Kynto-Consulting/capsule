#!/usr/bin/env bash
# teardown.sh : stop and DELETE everything the run created (processes, clusters, work dir, copies) and verify it.
HERE=$(cd "$(dirname "$0")" && pwd)
W=${W:-/tmp/capsule-interop}
pkill -KILL -f "$HERE/bin/harness" 2>/dev/null
pkill -KILL -f "$HERE/bin/capsule-gateway" 2>/dev/null
pkill -KILL -f "$HERE/bin/capsule-server" 2>/dev/null
pkill -KILL -f "$HERE/bin/capsule " 2>/dev/null
"$HERE/infra.sh" down >/dev/null 2>&1
pkill -KILL -u postgres -f "$W/pg/" 2>/dev/null
sleep 1
rm -rf "$W" "$HERE/.run"
echo "--- verification"
left=$(pgrep -af "$HERE/bin/|$W" | grep -v pgrep | grep -v teardown || true)
echo "processes left: ${left:-none}"
ports=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(18080|18443|19102|19103|55440|55441|55442|55407|55408|55409|55410|55411|55422|55423|55424|5550[0-9])$' || true)
echo "ports left: ${ports:-none}"
echo "work dir: $( [ -e "$W" ] && echo present || echo deleted )"
docker ps -a --format '{{.Names}}' 2>/dev/null | grep -i interop || echo "containers left: none (no container was ever created)"
