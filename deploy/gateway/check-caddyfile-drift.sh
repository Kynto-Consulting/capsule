#!/usr/bin/env bash
# Comprueba que deploy/gateway/Caddyfile.take443 y deploy/forgejo/Caddyfile solo difieren en el bloque global (todo lo que va
# desde el primer sitio, "{$GIT_DOMAIN...", es identico). Solo lectura. Salida 0 = sin deriva.
set -eu
D=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
tail_of() { sed -n '/^{\$GIT_DOMAIN/,$p' "$1" | tr -d '\r'; }
if diff <(tail_of "$D/deploy/forgejo/Caddyfile") <(tail_of "$D/deploy/gateway/Caddyfile.take443") >/dev/null; then
  echo "OK    Caddyfile.take443 identico al de produccion salvo el bloque global"
else
  echo "FALLA Caddyfile.take443 derivo de deploy/forgejo/Caddyfile (copiar los sitios de nuevo):"
  diff <(tail_of "$D/deploy/forgejo/Caddyfile") <(tail_of "$D/deploy/gateway/Caddyfile.take443") | head -20
  exit 1
fi
