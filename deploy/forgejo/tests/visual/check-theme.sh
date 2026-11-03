#!/usr/bin/env bash
# Comprobaciones sin navegador del tema Git Capsule contra un Forgejo ya servido (local con run-forgejo-local.sh, o el real).
#   BASE=http://localhost:28480 bash check-theme.sh
# Ejecutar en CADA subida de GIT_VERSION (ver README, "Actualizar Forgejo"): si una plantilla propia dejo de aplicar o un nombre de
# variable CSS cambio, falla aqui. Las capturas se revisan a mano (README) porque dependen de un navegador.
set -u
BASE="${BASE:-http://localhost:28480}"
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "ok   - $1"; }
bad(){ fail=$((fail+1)); echo "FAIL - $1"; }
has(){ if printf '%s' "$2" | grep -q -- "$3"; then ok "$1"; else bad "$1 (falta: $3)"; fi; }
hasnt(){ if printf '%s' "$2" | grep -q -- "$3"; then bad "$1 (aparece: $3)"; else ok "$1"; fi; }

login="$(curl -fsS "$BASE/user/login")" || { echo "FAIL - no responde $BASE/user/login"; exit 1; }
has   "login: titulo con la marca"            "$login" '<title>[^<]*Git Capsule'
has   "login: tema oscuro por defecto"        "$login" 'data-theme="forgejo-dark"'
has   "login: carga git-capsule.css"          "$login" 'css/git-capsule.css?v='
has   "login: plantilla propia (bloque de marca)" "$login" 'gc-login-title'
has   "login: enlace Volver a Capsule"        "$login" 'Volver a Capsule'
hasnt "login: sin 'Powered by Forgejo'"       "$login" 'Powered by'
hasnt "login: sin version de Forgejo en el pie" "$login" 'class="[^"]*">[0-9]\+\.[0-9]\+\.[0-9]\+'
has   "css: oculta los enlaces de explorar"    "$(curl -fsS "$BASE/assets/css/git-capsule.css")" 'a.item\[href\$="/explore/repos"\]'
hasnt "login: sin la palabra demo/simulado/ficticio" "$login" '[Dd]emo[^a-z]\|[Ss]imulad\|[Ff]ictici'

css="$(curl -fsS "$BASE/assets/css/git-capsule.css")" || { bad "git-capsule.css no se sirve"; css=""; }
for v in '--color-primary: #7c3aed' '--color-body: #000000' '--color-box-body: #111111' '--color-text: #ededed' '--gc-accent-light: #a78bfa'; do
  has "css: $v" "$css" "$v"
done
theme="$(curl -fsS "$BASE/assets/css/theme-forgejo-dark.css")" || theme=""
# Los nombres --color-* que sobrescribimos deben seguir existiendo en el tema base de la version instalada.
missing=0
for n in $(printf '%s' "$css" | grep -o '^  --color-[a-z0-9-]*' | sort -u | tr -d ' '); do
  printf '%s' "$theme" | grep -q -- "$n:" || { bad "css: la variable $n ya no existe en theme-forgejo-dark.css (revisar nombre)"; missing=1; }
done
[ "$missing" = 0 ] && ok "css: todas las variables --color-* sobrescritas existen en el tema base"

for f in logo.svg favicon.svg logo.png favicon.png apple-touch-icon.png avatar_default.png repo_default.png git-capsule-wordmark.svg; do
  code="$(curl -s -o /tmp/gc-asset.$$ -w '%{http_code}' "$BASE/assets/img/$f")"
  [ "$code" = 200 ] && ok "img: $f servido" || bad "img: $f -> $code"
done
svg="$(curl -fsS "$BASE/assets/img/logo.svg")"; has "img: logo.svg embebe el logo real de Capsule (PNG)" "$svg" 'data:image/png;base64,'
rm -f /tmp/gc-asset.$$

code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/explore/repos")"; { [ "$code" = 302 ] || [ "$code" = 303 ]; } && ok "explore redirige ($code)" || bad "explore -> $code"
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/swagger")"; { [ "$code" = 404 ] || [ "$code" = 303 ] || [ "$code" = 302 ]; } && ok "swagger no publico ($code)" || bad "swagger -> $code"

echo; echo "resultado: $pass ok, $fail fallos"; [ "$fail" = 0 ]
