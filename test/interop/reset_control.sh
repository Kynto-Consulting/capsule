#!/usr/bin/env bash
# reset_control.sh : fresh control database (the backend applies every migration when it starts).
set -euo pipefail
W=${W:-/tmp/capsule-interop}; HERE=$(cd "$(dirname "$0")" && pwd)
"$HERE/control.sh" stop >/dev/null; sleep 1
export PGPASSWORD=interop-pg-pass
psql -h 127.0.0.1 -p 55440 -U postgres -d postgres -qc "DROP DATABASE IF EXISTS capsule WITH (FORCE)" -c "CREATE DATABASE capsule"
"$HERE/control.sh" start
