#!/usr/bin/env bash
# Prueba REAL (Linux/WSL): Forgejo 15.0.11 + forgejo-runner con etiqueta host (sin Docker) ejecutan un workflow que
# usa permissions, concurrency, el lint de politica y el re-enmascarado de ::add-mask::. Todo en WORKDIR aislado,
# binarios descargados y verificados con checksum, ejecutados desde fuera de WORKDIR/bin como usuario normal.
#   WORKDIR=$HOME/gc-b6 bash run-real-runner.sh            (puerto 3398 en 127.0.0.1)
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${WORKDIR:-$HOME/gc-b6}"
PORT=3398
FJ=15.0.11; RV=13.2.1
RUNNER_SHA=bb369fe1ecb50fdc983c0b1d993f19b0920df6e5864511892b3cdbf16d858b34
mkdir -p "$WORKDIR/bin" "$WORKDIR/data" "$WORKDIR/runner" "$WORKDIR/repo-src"
cd "$WORKDIR"
if [ ! -x bin/forgejo ]; then
  curl -fsSLo bin/forgejo "https://codeberg.org/forgejo/forgejo/releases/download/v$FJ/forgejo-$FJ-linux-amd64"
  curl -fsSLo bin/forgejo.sha256 "https://codeberg.org/forgejo/forgejo/releases/download/v$FJ/forgejo-$FJ-linux-amd64.sha256"
  want="$(cut -d' ' -f1 bin/forgejo.sha256)"
  echo "$want  bin/forgejo" | sha256sum -c -
  chmod +x bin/forgejo
fi
if [ ! -x bin/forgejo-runner ]; then
  curl -fsSLo bin/forgejo-runner "https://code.forgejo.org/forgejo/runner/releases/download/v$RV/forgejo-runner-$RV-linux-amd64"
  echo "$RUNNER_SHA  bin/forgejo-runner" | sha256sum -c -
  chmod +x bin/forgejo-runner
fi
SK="$(./bin/forgejo generate secret SECRET_KEY)"; IT="$(./bin/forgejo generate secret INTERNAL_TOKEN)"
mkdir -p data/custom/conf
# DEFAULT_ACTIONS_URL: igual que en produccion (acciones desde data.forgejo.org; aqui no se usan: el host no tiene node)
cat > app.ini <<INI
APP_NAME = b6
RUN_MODE = prod
WORK_PATH = $WORKDIR/data
[server]
HTTP_ADDR = 127.0.0.1
HTTP_PORT = $PORT
ROOT_URL = http://127.0.0.1:$PORT/
DISABLE_SSH = true
[database]
DB_TYPE = sqlite3
PATH = $WORKDIR/data/forgejo.db
[repository]
ROOT = $WORKDIR/data/repos
[security]
INSTALL_LOCK = true
SECRET_KEY = $SK
INTERNAL_TOKEN = $IT
[service]
DISABLE_REGISTRATION = true
[actions]
ENABLED = true
DEFAULT_ACTIONS_URL = https://data.forgejo.org
[webhook]
ALLOWED_HOST_LIST = loopback
INI
FJ_CMD="./bin/forgejo --config $WORKDIR/app.ini"
$FJ_CMD web > forgejo.out 2>&1 &
echo $! > forgejo.pid
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null
PASS="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
$FJ_CMD admin user create --admin --username b6admin --email b6@example.test --password "$PASS" --must-change-password=false >/dev/null
TOKEN="$($FJ_CMD admin user generate-access-token --username b6admin --scopes all --raw)"
api() { curl -fsS -H "Authorization: token $TOKEN" -H 'Content-Type: application/json' "$@"; }
api -X POST "http://127.0.0.1:$PORT/api/v1/user/repos" -d '{"name":"wf","auto_init":false,"private":true}' >/dev/null
REG="$($FJ_CMD forgejo-cli actions generate-runner-token)"
( cd runner && ../bin/forgejo-runner register --no-interactive --instance "http://127.0.0.1:$PORT" --token "$REG" --name b6-runner --labels host:host >register.out 2>&1 )
( cd runner && ../bin/forgejo-runner daemon > ../runner.out 2>&1 & echo $! > ../runner.pid )
# repo con workflow + lint de politica
rm -rf repo-src && mkdir -p repo-src/.forgejo/workflows repo-src/.forgejo/policy && cd repo-src
cp "$HERE/../lint-workflows.py" .forgejo/policy/
cat > .forgejo/workflows/b6.yml <<'YML'
name: b6-real
on: [push]
permissions:
  contents: read
concurrency:
  group: b6
  cancel-in-progress: false
jobs:
  policy:
    runs-on: host
    steps:
      - name: Checkout (manual)
        run: |
          git clone --depth=1 "http://b6admin:${{ github.token }}@127.0.0.1:3398/${{ github.repository }}.git" /tmp/b6-src-$$ && echo "clon ok"
      - name: Lint de politica sobre los workflows de este repo
        run: |
          rm -rf /tmp/b6-pol; git clone --depth=1 "http://b6admin:${{ github.token }}@127.0.0.1:3398/${{ github.repository }}.git" /tmp/b6-pol
          python3 -I /tmp/b6-pol/.forgejo/policy/lint-workflows.py --labels host /tmp/b6-pol/.forgejo/workflows
      - name: Enmascarado del runner
        env:
          SECRETO: valor-secreto-b6-12345
        run: |
          echo "::add-mask::valor-secreto-b6-12345"
          echo "imprimo: $SECRETO"
          echo "en base64: $(printf %s "$SECRETO" | base64)"
YML
git init -q -b main && git -c user.name=b6 -c user.email=b6@example.test add -A && git -c user.name=b6 -c user.email=b6@example.test commit -qm "b6 workflow"
git push -q "http://b6admin:$TOKEN@127.0.0.1:$PORT/b6admin/wf.git" main
cd "$WORKDIR"
for i in $(seq 1 90); do
  st="$(api "http://127.0.0.1:$PORT/api/v1/repos/b6admin/wf/actions/tasks" 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);t=d.get("workflow_runs",[]);print(t[0]["status"] if t else "none")' 2>/dev/null || echo none)"
  echo "estado: $st"; case "$st" in success|failure|cancelled) break;; esac; sleep 2
done
echo "--- runner.out"; tail -40 runner.out || true
echo "--- tasks"; api "http://127.0.0.1:$PORT/api/v1/repos/b6admin/wf/actions/tasks" || true
echo "token=$TOKEN" > "$WORKDIR/api.env"
echo "(servidor y runner siguen vivos: kill \$(cat $WORKDIR/forgejo.pid) \$(cat $WORKDIR/runner.pid))"
