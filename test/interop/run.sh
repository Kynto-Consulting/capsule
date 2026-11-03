#!/usr/bin/env bash
# run.sh [phase...] : the whole end-to-end run, inside WSL as root (needs PostgreSQL 18 binaries, psql, ssh, openssl; node.exe from Windows).
# Everything is local and disposable; teardown.sh removes it at the end (also on failure).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
export W=${W:-/tmp/capsule-interop}
[ "$(id -u)" = 0 ] || { echo "run as root inside WSL (pg_ctl runs as the postgres user via runuser)"; exit 1; }
for f in capsule capsule-gateway capsule-server harness; do [ -x "$HERE/bin/$f" ] || { echo "missing bin/$f: run build.sh first"; exit 1; }; done
sed -i 's/\r$//' "$HERE"/*.sh 2>/dev/null
"$HERE/teardown.sh" >/dev/null 2>&1
trap '"$HERE/teardown.sh"' EXIT
mkdir -p "$W/run"
"$HERE/certs.sh" && "$HERE/infra.sh" up || exit 1
rnd() { head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9; }
cat > "$W/run/tokens.env" <<T
CAP_OK=cap_$(rnd)
CAP_OTHER=cap_$(rnd)
CAP_SCOPED=cap_$(rnd)
T
"$HERE/reset_control.sh" && "$HERE/seed.sh" || exit 1
"$HERE/bin/harness" "$@" 2>&1 | tee "$HERE/last-run.log"
exit "${PIPESTATUS[0]}"
