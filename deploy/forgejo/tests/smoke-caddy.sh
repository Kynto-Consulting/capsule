#!/usr/bin/env bash
# Prueba de humo del Caddyfile contra un stub de /internal/git-auth y un upstream de eco (sin Forgejo, sin Docker).
#   CADDY_BIN=/ruta/a/caddy PYTHON=python bash deploy/forgejo/tests/smoke-caddy.sh
# Opcional: SMOKE_BIG=1 envia 513 MB para comprobar el limite de pushes; RATELIMIT_SNIPPET=1 prueba conf.d/ratelimit.caddy (requiere un Caddy con caddy-ratelimit).
# Ejecutalo desde fuera de carpetas con binarios descargados: no carga nada del directorio actual.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE="${CADDYFILE:-$HERE/../Caddyfile}"
CADDY_BIN="${CADDY_BIN:-caddy}"
PYTHON="${PYTHON:-python3}"
P_PROXY=${P_PROXY:-28580}; P_AUTH=${P_AUTH:-28581}; P_UP=${P_UP:-28582}
BASE="http://localhost:$P_PROXY"
WORK="$(mktemp -d)"
PIDS=()
pass=0; fail=0
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; rm -rf "$WORK"; }
trap cleanup EXIT

ok()   { pass=$((pass+1)); echo "ok   - $1"; }
bad()  { fail=$((fail+1)); echo "FAIL - $1  ($2)"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "esperado '$3', obtenido '$2'"; fi; }
jget() { "$PYTHON" -I -c 'import sys,json
d=json.load(sys.stdin); v=d
for k in sys.argv[1].split("."): v=v.get(k) if isinstance(v,dict) else None
print("" if v is None else v)' "$1"; }
basic() { printf '%s:%s' "$1" "$2" | base64 | tr -d '\n'; }
calls() { curl -s "http://127.0.0.1:$P_AUTH/__calls" | jget calls; }

export CAPSULE_GIT_AUTH_SECRET="smoke-secret-$RANDOM$RANDOM"
"$PYTHON" -I "$HERE/stub-git-auth.py" $P_AUTH & PIDS+=($!)
"$PYTHON" -I "$HERE/echo-upstream.py" $P_UP & PIDS+=($!)
export GIT_DOMAIN="http://localhost:$P_PROXY" GIT_UPSTREAM="127.0.0.1:$P_UP" GIT_AUTH_UPSTREAM="127.0.0.1:$P_AUTH"
"$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>"$WORK/validate.log" || { cat "$WORK/validate.log"; echo "FAIL - caddy validate"; exit 1; }
ok "caddy validate"
"$CADDY_BIN" run --config "$CADDYFILE" --adapter caddyfile >"$WORK/caddy.out" 2>"$WORK/caddy.log" & PIDS+=($!)
for i in $(seq 1 50); do curl -s -o /dev/null "$BASE/" && break; sleep 0.2; done

GITPATH=/evvg/web.git/info/refs
# Nombre de la cabecera que llega a Forgejo (GIT_AUTH_HEADER o X-WEBAUTH-USER), en minusculas
AH="$(echo "${GIT_AUTH_HEADER:-X-WEBAUTH-USER}" | tr A-Z a-z)"

# 1. cabecera entrante en una ruta web: no llega a Forgejo
r=$(curl -s -H 'X-WEBAUTH-USER: admin' -H "$(echo "${GIT_AUTH_HEADER:-X-Dummy}: admin")" -H 'x-webauth-email: a@b.c' -H 'X-Webauth-Fullname: x' "$BASE/evvg/web")
check "web: X-WEBAUTH-USER entrante descartada" "$(echo "$r" | jget headers.$AH)" ""
check "web: X-WEBAUTH-USER literal tambien descartada" "$(echo "$r" | jget headers.x-webauth-user)" ""
check "web: X-WEBAUTH-EMAIL entrante descartada" "$(echo "$r" | jget headers.x-webauth-email)" ""
check "web: X-WEBAUTH-FULLNAME entrante descartada" "$(echo "$r" | jget headers.x-webauth-fullname)" ""

# 2. ruta Git sin credenciales: sin forward_auth y sin cabecera
c0=$(calls)
r=$(curl -s -H 'X-WEBAUTH-USER: admin' "$BASE$GITPATH?service=git-upload-pack")
check "git sin credenciales: cabecera descartada" "$(echo "$r" | jget headers.$AH)" ""
check "git sin credenciales: no consulta al backend" "$(calls)" "$c0"

# 3. credencial que no es cgt_: pasa sin cabecera
r=$(curl -s -u 'alice:ghp_abc' -H 'X-WEBAUTH-USER: admin' "$BASE$GITPATH")
check "git con credencial no cgt_: llega a Forgejo" "$(echo "$r" | jget path)" "$GITPATH"
check "git con credencial no cgt_: sin X-WEBAUTH-USER (ni la falsificada)" "$(echo "$r" | jget headers.$AH)" ""
check "git con credencial no cgt_: Authorization llega a Forgejo" "$([ -n "$(echo "$r" | jget headers.authorization)" ] && echo si || echo no)" "si"

# 4. cgt_ valido inyecta la cabecera
r=$(curl -s -u 'alice:cgt_good1' "$BASE$GITPATH")
check "git con cgt_ valido: X-WEBAUTH-USER=alice" "$(echo "$r" | jget headers.$AH)" "alice"
check "git con cgt_ valido: el backend vio X-Forwarded-Uri" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget last_path)" "$GITPATH"

r=$(curl -s -u 'alice:cgt_good1' "$BASE$GITPATH?service=git-upload-pack")
check "git con cgt_ valido y query (?service=...): X-WEBAUTH-USER=alice" "$(echo "$r" | jget headers.$AH)" "alice"

# 4b. secreto compartido, Authorization retirada solo con usuario validado, forwarded sin normalizar
r=$(curl -s -u 'alice:cgt_good1' "$BASE$GITPATH")
check "cgt_ valido: Authorization NO llega a Forgejo" "$(echo "$r" | jget headers.authorization)" ""
check "backend recibio el secreto compartido (X-Capsule-Git-Auth)" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget secret_ok)" "True"
check "el secreto no viaja a Forgejo" "$(echo "$r" | jget headers.x-capsule-git-auth)" ""
r=$(curl -s -H 'Authorization: token abc123' "$BASE$GITPATH")
check "token de Forgejo (no cgt_): Authorization intacta" "$(echo "$r" | jget headers.authorization)" "token abc123"
r=$(curl -s -H 'Authorization: Bearer svc-token' "$BASE/evvg/web.git/info/lfs/objects/batch")
check "Bearer (token de servicio): Authorization intacta" "$(echo "$r" | jget headers.authorization)" "Bearer svc-token"
r=$(curl -s -u 'alice:ghp_abc' "$BASE$GITPATH")
check "Basic no cgt_: Authorization intacta" "$([ -n "$(echo "$r" | jget headers.authorization)" ] && echo si || echo no)" "si"
curl -s -o /dev/null -u 'alice:cgt_good1' -X POST --data-binary x "$BASE/evvg/web.git/git-upload-pack?a=%2Fb%20c&z=1"
check "X-Forwarded-Uri llega tal cual (sin normalizar)" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget last_path)" "/evvg/web.git/git-upload-pack?a=%2Fb%20c&z=1"
check "X-Forwarded-Method llega tal cual" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget last_method)" "POST"
check "Caddy no anade X-Amzn-Trace-Id" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget last_headers.X-Amzn-Trace-Id)" ""
code=$(curl -s -o /dev/null -w '%{http_code}' -u 'alice:cgt_good1' -H 'X-Amzn-Trace-Id: Root=1-x' "$BASE$GITPATH")
check "X-Amzn-Trace-Id del cliente llega al backend (que lo rechaza: 400)" "$code" "400"

# 5. cgt_ valido + cabecera falsificada: gana la del backend
r=$(curl -s -u 'alice:cgt_good1' -H 'X-WEBAUTH-USER: mallory' "$BASE/evvg/web/git-receive-pack")
check "git con cgt_ valido + cabecera falsa: queda alice" "$(echo "$r" | jget headers.$AH)" "alice"
check "backend no recibe la cabecera falsa" "$(curl -s http://127.0.0.1:$P_AUTH/__calls | jget last_headers.x-webauth-user)" ""

# 6. cgt_ invalido: 401 con desafio y sin llegar a Forgejo
code=$(curl -s -o "$WORK/b" -D "$WORK/h" -w '%{http_code}' -u 'alice:cgt_nope' -H 'X-WEBAUTH-USER: admin' "$BASE$GITPATH")
check "git con cgt_ invalido: 401" "$code" "401"
check "git con cgt_ invalido: WWW-Authenticate" "$(grep -ci '^www-authenticate: Basic realm="Git Capsule"' "$WORK/h")" "1"
check "git con cgt_ invalido: no llega a Forgejo" "$(grep -c '"path"' "$WORK/b")" "0"

# 7. limite del backend (429) se propaga
code=$(curl -s -o /dev/null -D "$WORK/h" -w '%{http_code}' -u 'alice:cgt_limited' "$BASE$GITPATH")
check "429 del backend llega al cliente" "$code" "429"
check "Retry-After se conserva" "$(grep -ci '^retry-after: 30' "$WORK/h")" "1"

# 8. rutas LFS y variantes
r=$(curl -s -u 'alice:cgt_good1' "$BASE/evvg/web.git/info/lfs/objects/batch")
check "LFS pasa por forward_auth" "$(echo "$r" | jget headers.$AH)" "alice"
r=$(curl -s -u 'alice:cgt_good1' "$BASE/evvg/web/commits/branch/main")
check "ruta web con Basic cgt_: NO se inyecta cabecera (solo rutas Git)" "$(echo "$r" | jget headers.$AH)" ""

# 9. /explore redirige
code=$(curl -s -o /dev/null -D "$WORK/h" -w '%{http_code}' "$BASE/explore/repos")
check "/explore/repos -> 302" "$code" "302"
check "/explore/repos -> /" "$(grep -i '^location:' "$WORK/h" | tr -d '\r' | awk '{print $2}')" "/"

# 10. cabeceras de seguridad
curl -s -o /dev/null -D "$WORK/h" "$BASE/"
for hname in x-content-type-options x-frame-options referrer-policy permissions-policy cross-origin-opener-policy strict-transport-security; do
  check "cabecera $hname presente" "$(grep -ci "^$hname:" "$WORK/h")" "1"
done
check "cabecera Server ausente" "$(grep -ci '^server:' "$WORK/h")" "0"

# 11. limites de cuerpo
head -c $((65*1024*1024)) /dev/zero > "$WORK/65m"
code=$(curl -s -o /dev/null -w '%{http_code}' --data-binary @"$WORK/65m" "$BASE/evvg/web/settings")
check "cuerpo de 65 MB en ruta web: rechazado (413)" "$code" "413"
code=$(curl -s -o "$WORK/b" -w '%{http_code}' -u 'alice:cgt_good1' --data-binary @"$WORK/65m" -H 'Content-Type: application/x-git-receive-pack-request' "$BASE/evvg/web.git/git-receive-pack")
check "push de 65 MB por ruta Git: aceptado" "$code:$(jget body_bytes < "$WORK/b")" "200:$((65*1024*1024))"
if [ "${SMOKE_BIG:-0}" = 1 ]; then
  head -c $((513*1024*1024)) /dev/zero > "$WORK/513m"
  code=$(curl -s -o /dev/null -w '%{http_code}' -u 'alice:cgt_good1' --data-binary @"$WORK/513m" "$BASE/evvg/web.git/git-receive-pack")
  check "push de 513 MB: rechazado (413)" "$code" "413"
fi
rm -f "$WORK/65m" "$WORK/513m"

# 12. los registros de acceso no contienen credenciales
curl -s -o /dev/null -u 'alice:cgt_good-SECRETMARK' "$BASE$GITPATH"
sleep 0.5
check "registro de Caddy sin el token" "$(grep -c 'cgt_good-SECRETMARK\|Y2d0X2dvb2Qt' "$WORK/caddy.log")" "0"
check "registro de Caddy con acceso y Authorization oculta" "$(grep -c 'REDACTED' "$WORK/caddy.log" | awk '{print ($1>0)?"si":"no"}')" "si"

# 13. si el backend de autenticacion cae, no se sigue sin validar (se hace al final)
kill "${PIDS[0]}" 2>/dev/null; sleep 0.5
code=$(curl -s -o "$WORK/b" -w '%{http_code}' -u 'alice:cgt_good1' "$BASE$GITPATH")
check "backend de auth caido: error (no pasa)" "$([ "$code" = 502 ] || [ "$code" = 503 ] && echo si || echo "no($code)")" "si"
check "backend de auth caido: no llega a Forgejo" "$(grep -c '"path"' "$WORK/b")" "0"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/evvg/web")
check "backend de auth caido: la web sigue funcionando" "$code" "200"

# 14. limite de tasa (solo con RATELIMIT_SNIPPET=1 y un Caddy con caddy-ratelimit en CADDY_BIN): se reinicia Caddy con el snippet y 5 eventos/min
if [ "${RATELIMIT_SNIPPET:-0}" = 1 ]; then
  kill "${PIDS[2]}" 2>/dev/null; sleep 1
  mkdir -p "$WORK/confd"; sed 's/events 120/events 5/' "$HERE/../caddy/ratelimit.caddy" > "$WORK/confd/ratelimit.caddy"
  "$PYTHON" -I "$HERE/stub-git-auth.py" $P_AUTH & PIDS+=($!)
  GIT_CONF_D="$WORK/confd" "$CADDY_BIN" validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>"$WORK/v2.log" || { cat "$WORK/v2.log"; bad "validate con ratelimit" "ver arriba"; }
  GIT_CONF_D="$WORK/confd" "$CADDY_BIN" run --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>"$WORK/caddy2.log" & PIDS+=($!)
  for i in $(seq 1 50); do curl -s -o /dev/null "$BASE/" && break; sleep 0.2; done
  codes=""; for i in 1 2 3 4 5 6 7 8; do codes="$codes $(curl -s -o /dev/null -w '%{http_code}' -u 'alice:cgt_nope' "$BASE$GITPATH")"; done
  check "ratelimit: 5 primeras 401 y luego 429" "$codes" " 401 401 401 401 401 429 429 429"
  check "ratelimit: la web general no se ve afectada" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/evvg/web")" "200"
fi

echo; echo "resultado: $pass ok, $fail fallos"
[ "$fail" = 0 ]
