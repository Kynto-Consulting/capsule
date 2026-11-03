#!/usr/bin/env bash
# gen_tunnelref.sh : copy the gateway's own codec (backend/internal/gateway/data/tunnel: request.go, response.go) into this module so
# the harness can compare it byte for byte with the Go library and the JS library. The copy is generated, never edited.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SRC="$HERE/../../backend/internal/gateway/data/tunnel"
mkdir -p "$HERE/internal/tunnelref"
for f in request.go response.go; do cp "$SRC/$f" "$HERE/internal/tunnelref/$f"; done
sed -i 's/\r$//' "$HERE"/internal/tunnelref/*.go
echo "tunnelref generated from $(cd "$SRC" && pwd)"
