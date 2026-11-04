#!/usr/bin/env bash
# Comprueba que deploy/gateway/Caddyfile.take443 y deploy/forgejo/Caddyfile solo difieren en el bloque global (todo lo que va
# desde el primer sitio, "{$GIT_DOMAIN...", es identico) y que AMBOS importan los sitios compartidos (deploy/forgejo/caddy/capsule-sites.caddy,
# montado en /etc/caddy/sites.d/ por docker-compose.alb-off.yml) y declaran on_demand_tls. Solo lectura. Salida 0 = sin deriva.
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
rc=0
for f in deploy/forgejo/Caddyfile deploy/gateway/Caddyfile.take443; do
  grep -q '^import /etc/caddy/sites.d/\*\.caddy' "$D/$f" || { echo "FALLA $f no importa /etc/caddy/sites.d/*.caddy"; rc=1; }
  grep -q 'on_demand_tls' "$D/$f" || { echo "FALLA $f no declara on_demand_tls { ask }"; rc=1; }
done
[ -s "$D/deploy/forgejo/caddy/capsule-sites.caddy" ] || { echo "FALLA falta deploy/forgejo/caddy/capsule-sites.caddy"; rc=1; }
[ "$rc" = 0 ] && echo "OK    ambos Caddyfile importan los sitios compartidos y declaran on_demand_tls"
exit $rc
