#!/usr/bin/env bash
# build.sh : cross-compile every Linux binary the interop run needs into test/interop/bin (run from Git Bash/Windows or Linux with Go).
# Never uses -mod=mod on the backend or the CLI: their go.mod/go.sum are left as they are.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT="$HERE/../.."
export GOOS=linux GOARCH=amd64 CGO_ENABLED=0
mkdir -p "$HERE/bin"
( cd "$ROOT/backend" && go build -o "$HERE/bin/capsule-gateway" ./cmd/capsule-gateway && go build -o "$HERE/bin/capsule-server" ./cmd/server )
( cd "$ROOT/cli" && go build -o "$HERE/bin/capsule" ./cmd/capsule )
"$HERE/gen_tunnelref.sh"
# the harness is its own module (own go.mod); -mod=mod is allowed here only, offline, from the module cache
( cd "$HERE" && GOFLAGS=-mod=mod GOPROXY=off GONOSUMDB='*' GONOSUMCHECK=1 GOFLAGS=-mod=mod go build -o bin/harness ./cmd/harness )
ls -la "$HERE/bin"
