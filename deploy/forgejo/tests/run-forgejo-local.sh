#!/usr/bin/env bash
# Levanta un Forgejo EFIMERO (binario oficial, sin Docker) con la MISMA configuracion FORGEJO__* de docker-compose.prod.yml
# y la personalizacion de deploy/forgejo/custom, para las pruebas de tema y de acceso. Linux o WSL.
#   [GIT_AUTH_HEADER=X-GC-<hex>] FORGEJO_BIN=/ruta/forgejo-15.0.11-linux-amd64 E2I_BIN=/ruta/environment-to-ini [WORKDIR=~/gc-test/work] bash run-forgejo-local.sh start|stop|status
# Solo para pruebas locales: crea un admin local con contrasena aleatoria (archivo $WORKDIR/admin.pass) y habilita login local en ESTA instancia.
# El binario debe haberse descargado y verificado con su .sha256 (ver README, "Probar sin Docker").
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
COMPOSE="${COMPOSE:-$ROOT/docker-compose.prod.yml}"
FORGEJO_BIN="${FORGEJO_BIN:?FORGEJO_BIN=/ruta/al/binario}"
E2I_BIN="${E2I_BIN:?E2I_BIN=/ruta/a/environment-to-ini (es lo que hace la imagen oficial al arrancar; ver README)}"
WORKDIR="${WORKDIR:-$HOME/gc-test/work}"
PORT="${PORT:-3000}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost:28480/}"   # la que ve el navegador (Caddy de las pruebas)
TRUSTED="${TRUSTED:-0.0.0.0/0,::/0}"                 # solo pruebas: el origen de Caddy depende del entorno
cmd="${1:-start}"

case "$cmd" in
stop)   [ -f "$WORKDIR/forgejo.pid" ] && kill "$(cat "$WORKDIR/forgejo.pid")" 2>/dev/null || true; exit 0 ;;
status) curl -fsS "http://127.0.0.1:$PORT/api/healthz" || exit 1; exit 0 ;;
start) ;;
*) echo "uso: $0 start|stop|status" >&2; exit 2 ;;
esac

mkdir -p "$WORKDIR/custom" "$WORKDIR/data" "$WORKDIR/repos" "$WORKDIR/log"
# Emula los montajes de solo lectura del compose (templates y public) copiando.
rm -rf "$WORKDIR/custom/templates" "$WORKDIR/custom/public"
cp -r "$HERE/../custom/templates" "$HERE/../custom/public" "$WORKDIR/custom/"

# 1. variables FORGEJO__* del servicio git, con ${VAR:-defecto} resuelto al defecto
sed -n '/^  git:$/,/^  git-proxy:$/p' "$COMPOSE" | sed -n 's/^      - \(FORGEJO__[^=]*\)=\(.*\)$/\1=\2/p' \
  | sed 's/\${[A-Z_]*:-\([^}]*\)}/\1/g' > "$WORKDIR/compose.env"
while IFS= read -r line; do export "$line"; done < "$WORKDIR/compose.env"

# 2. ajustes locales (solo en esta instancia de prueba)
export FORGEJO_WORK_DIR="$WORKDIR" FORGEJO_CUSTOM="$WORKDIR/custom"
export FORGEJO__server__ROOT_URL="$PUBLIC_URL" FORGEJO__server__DOMAIN=localhost FORGEJO__server__SSH_DOMAIN=localhost
export FORGEJO__server__HTTP_ADDR=0.0.0.0 FORGEJO__server__HTTP_PORT="$PORT" FORGEJO__server__DISABLE_SSH=true
export FORGEJO__server__APP_DATA_PATH="$WORKDIR/data" FORGEJO__database__PATH="$WORKDIR/forgejo.db"
export FORGEJO__repository__ROOT="$WORKDIR/repos" FORGEJO__session__COOKIE_SECURE=false
export FORGEJO__service__ENABLE_INTERNAL_SIGNIN=true FORGEJO__security__REVERSE_PROXY_TRUSTED_PROXIES="$TRUSTED"
export FORGEJO__log__ROOT_PATH="$WORKDIR/log" FORGEJO__actions__ENABLED=false
export FORGEJO__webhook__ALLOWED_HOST_LIST=loopback
# Como en el compose: ${GIT_AUTH_HEADER:-X-WEBAUTH-USER}
[ -n "${GIT_AUTH_HEADER:-}" ] && export FORGEJO__security__REVERSE_PROXY_AUTHENTICATION_USER="$GIT_AUTH_HEADER"
[ -f "$WORKDIR/secrets.env" ] || {
  printf 'FORGEJO__security__SECRET_KEY=%s\nFORGEJO__security__INTERNAL_TOKEN=%s\n' \
    "$("$FORGEJO_BIN" generate secret SECRET_KEY)" "$("$FORGEJO_BIN" generate secret INTERNAL_TOKEN)" > "$WORKDIR/secrets.env"; }
while IFS= read -r line; do export "$line"; done < "$WORKDIR/secrets.env"

[ -f "$WORKDIR/app.ini" ] || printf '[DEFAULT]\n' > "$WORKDIR/app.ini"
"$E2I_BIN" --config "$WORKDIR/app.ini" >/dev/null
"$FORGEJO_BIN" --config "$WORKDIR/app.ini" web > "$WORKDIR/forgejo.out" 2>&1 &
echo $! > "$WORKDIR/forgejo.pid"
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/healthz" >/dev/null || { tail -30 "$WORKDIR/forgejo.out"; exit 1; }

# 4. admin local de prueba (idempotente)
if [ ! -f "$WORKDIR/admin.pass" ]; then
  head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$WORKDIR/admin.pass"; chmod 600 "$WORKDIR/admin.pass"
  "$FORGEJO_BIN" --config "$WORKDIR/app.ini" admin user create --admin --username gcadmin --email gcadmin@example.test \
     --password "$(cat "$WORKDIR/admin.pass")" --must-change-password=false >/dev/null
fi
echo "forgejo listo en $PUBLIC_URL (puerto local $PORT); configuracion efectiva en $WORKDIR/app.ini"
