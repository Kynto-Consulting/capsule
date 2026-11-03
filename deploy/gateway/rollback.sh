#!/usr/bin/env bash
# Reversa del gateway. Por defecto es una VISTA DE SOLO LECTURA: solo imprime lo que haría y lo que debe hacer el dueño fuera del host.
#   rollback.sh            -> muestra el estado y el plan de reversa (no cambia nada)
#   rollback.sh --yes      -> en el host: para y borra SOLO el contenedor capsule-gateway (nada más)
# Nunca toca: Caddy/git-proxy, Forgejo, backend, bases, puertos directos 40000-41999, reglas del security group, DNS.
# Lo de AWS y DNS lo hace el dueño con los comandos que imprime (PLAN.md 12.3: cada capa se revierte por separado).
set -u
YES=0; [ "${1:-}" = "--yes" ] && YES=1
DIR=${CAPSULE_DIR:-/opt/capsule}
CF="-f $DIR/docker-compose.prod.yml -f $DIR/deploy/gateway/docker-compose.gateway.yml --profile gateway"

echo "== Estado actual"
command -v docker >/dev/null || { echo "docker no disponible: este script se ejecuta en el host"; exit 2; }
docker ps -a --filter name=capsule-gateway --format '   gateway: {{.Names}} {{.Status}}'
echo "   dueño del 443: $(docker port capsule-git-proxy 443 2>/dev/null | head -1 || true) (capsule-git-proxy)  |  $(ss -ltnp 'sport = :443' 2>/dev/null | tail -n +2 | awk '{print $NF}' | head -2 | tr '\n' ' ')"
if ! docker port capsule-git-proxy 443 >/dev/null 2>&1; then
  echo "   ATENCIÓN: Caddy NO publica el 443. Si el gateway lo tomó (CAPSULE_GW_TAKE_443=1), devolverlo exige revertir en"
  echo "   docker-compose.prod.yml la línea de ports de git-proxy (\"443:443\") ANTES de parar el gateway; este script no edita el compose."
fi
echo "   puertos directos 40000-40199 escuchando: $(ss -ltn | awk '{print $4}' | sed 's/.*://' | awk '$1>=40000 && $1<=41999' | wc -l)"

echo; echo "== Plan de reversa, de adentro hacia afuera (cada paso es independiente)"
echo " 1. [host]   CAPSULE_GW_TAKE_443=0 en gateway.env y, si el 443 estaba tomado, devolverlo a Caddy (compose de producción)."
echo " 2. [host]   docker compose $CF rm -sf capsule-gateway      (este script con --yes)"
echo " 3. [host]   comprobar: curl -sI https://git.tumi-ai.com | head -1 ; ssh -p 22 git@git.tumi-ai.com (Forgejo) ; psql en un puerto directo 40xxx"
echo " 4. [DNS]    borrar en Namecheap los registros de RUNBOOK-dns.md (tcp.apps, udp.apps, *.db, AAAA nuevos). Los existentes no se tocan."
echo " 5. [AWS]    cd deploy/terraform && terraform plan -var ipv6_enabled=true -var git_enabled=true -var gateway_enabled=false"
echo "             (debe mostrar SOLO destruir aws_security_group_rule.gw_*; si muestra algo más, parar). Luego apply por el dueño."
echo " 6. [AWS]    IPv6 de la instancia y del ALB: no se revierten aquí (docs/ipv6.md sección 4, reversa general)."

if [ "$YES" -eq 1 ]; then
  echo; echo "== Ejecutando paso 2"
  # shellcheck disable=SC2086
  docker compose $CF rm -sf capsule-gateway && echo "gateway detenido y eliminado" || { echo "falló docker compose"; exit 1; }
  docker ps --filter name=capsule- --format '   {{.Names}} {{.Status}}'
else
  echo; echo "(no se cambió nada; use --yes para ejecutar el paso 2)"
fi
