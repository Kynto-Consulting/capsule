#!/usr/bin/env bash
# Conmutacion del 443: de Caddy al gateway (CAPSULE_GW_TAKE_443=1). Procedimiento y razones: docs/gateway/RUNBOOK-443.md
#   switch-443.sh                 -> SOLO LECTURA: comprobaciones previas y plan. No cambia nada.
#   switch-443.sh --yes           -> ejecuta (como root, en /opt/capsule).  Opciones: --wait-idle S (30), --max-established N (0), --force
#   switch-443.sh --finish        -> cuando el gateway viejo ya termino de drenar: deja UN solo gateway administrado por compose.
# Reversa de una orden: rollback-443.sh --yes
set -u
HERE=$(cd "$(dirname "$0")" && pwd); . "$HERE/lib-443.sh"
YES=0; FINISH=0; WAIT_IDLE=30; MAX_EST=0; FORCE=0
while [ $# -gt 0 ]; do case "$1" in
  --yes) YES=1;; --finish) FINISH=1;; --force) FORCE=1;; --wait-idle) WAIT_IDLE=$2; shift;; --max-established) MAX_EST=$2; shift;;
  -h|--help) sed -n '2,7p' "$0"; exit 0;; *) die "argumento desconocido: $1";; esac; shift; done
have docker || die "docker no disponible: ejecutar en el host"; have ss || die "falta ss"; have curl || die "falta curl"

if [ "$FINISH" -eq 1 ]; then
  running capsule-gateway && die "el gateway viejo (capsule-gateway) sigue en marcha/drenando: esperar a que termine (docker ps / docker logs -f capsule-gateway)"
  running "$NEXT" || die "no hay $NEXT en marcha: nada que finalizar"
  say "== Finalizar: un solo gateway administrado por compose (el viejo ya termino)"
  docker rm capsule-gateway >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker compose $CF_443 up -d --no-deps capsule-gateway || die "compose no pudo crear capsule-gateway"
  wait_for 60 healthy capsule-gateway || die "capsule-gateway no llego a healthy; $NEXT sigue sirviendo (no se toco)"
  docker kill -s TERM "$NEXT" >/dev/null && ok "SIGTERM a $NEXT (drena sus conexiones; ambos comparten el 443 por SO_REUSEPORT mientras tanto)"
  say "Cuando $NEXT termine: docker rm $NEXT"; exit 0
fi

echo "== Comprobaciones previas"; FAILS=0
compose_ok && ok "docker compose >= 2.24.4" || { bad "docker compose < 2.24.4 (la etiqueta !override no existe)"; FAILS=$((FAILS+1)); }
[ -f "$DIR/deploy/gateway/Caddyfile.take443" ] && ok "Caddyfile.take443 presente" || { bad "falta $DIR/deploy/gateway/Caddyfile.take443"; FAILS=$((FAILS+1)); }
bash "$HERE/check-caddyfile-drift.sh" "$DIR" || FAILS=$((FAILS+1))
[ -n "${CAPSULE_GATEWAY_IMAGE:-}" ] && ok "imagen del gateway: $CAPSULE_GATEWAY_IMAGE" || { bad "defina CAPSULE_GATEWAY_IMAGE (no hay gateway en marcha de donde leerla)"; FAILS=$((FAILS+1)); }
OWN=$(owner443); say "   dueño actual del 443: $OWN"
case "$OWN" in
  docker-proxy*|*caddy*) ok "el 443 es de Caddy (docker-proxy)";;
  capsule-gateway) ok "el gateway ya tiene el 443 (nada que conmutar)"; [ "$YES" -eq 1 ] && exit 0;;
  *) bad "dueño inesperado del 443: $OWN"; FAILS=$((FAILS+1));;
esac
running capsule-git-proxy && ok "capsule-git-proxy en marcha" || { bad "capsule-git-proxy no esta en marcha"; FAILS=$((FAILS+1)); }
if running capsule-gateway; then
  healthy capsule-gateway && ok "capsule-gateway (modo actual) healthy" || { bad "capsule-gateway no esta healthy"; FAILS=$((FAILS+1)); }
else say "   (no hay capsule-gateway en marcha: se arranca directamente en modo 443)"; fi
if running "$NEXT"; then bad "ya existe $NEXT en marcha: un traspaso anterior sin terminar (usar --finish o rollback-443.sh)"; FAILS=$((FAILS+1)); fi
say "   observando desde que IP ve Caddy a docker-proxy (sondas efimeras en loopback:$PROBE_PORT)..."
SRC=$(observe_sources); TRUSTED=$(printf '%s\n' "$SRC" | to_cidrs)
if [ -n "$TRUSTED" ]; then ok "GW_PROXY_TRUSTED = $TRUSTED"
else
  bad "no se pudo determinar GW_PROXY_TRUSTED (fijarlo a mano en .env y repetir)"; TRUSTED=${GW_PROXY_TRUSTED:-}; [ -n "$TRUSTED" ] || FAILS=$((FAILS+1))
fi
export GW_PROXY_TRUSTED=$TRUSTED
# shellcheck disable=SC2086
if docker compose $CF_443 config -q 2>/tmp/switch443.cfg.err; then ok "compose config (prod + gateway + take443) valido"; else bad "compose config: $(head -2 /tmp/switch443.cfg.err)"; FAILS=$((FAILS+1)); fi
IMG=$(docker inspect -f '{{.Config.Image}}' capsule-git-proxy 2>/dev/null)
if [ -n "$IMG" ]; then
  if docker run --rm -e GIT_ACME_EMAIL=a@b.co -e GW_PROXY_TRUSTED="$TRUSTED" -e CAPSULE_GIT_AUTH_SECRET=x -e GIT_DOMAIN="$GIT_DOMAIN" -v "$DIR/deploy/gateway/Caddyfile.take443:/c/Caddyfile:ro" "$IMG" caddy validate --config /c/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    ok "Caddyfile.take443 valida con $IMG"
  else bad "caddy validate fallo con Caddyfile.take443"; FAILS=$((FAILS+1)); fi
fi
if ls "${CAPSULE_GW_CERTS_DIR:-/opt/capsule/gateway/certs}"/"$TUNNEL_HOST".crt >/dev/null 2>&1; then ok "certificado de $TUNNEL_HOST para el gateway presente"
else say "AVISO no hay certificado de $TUNNEL_HOST en el directorio del gateway: el tunel capsule:// no tendra TLS (sync-certs.sh)"; fi
say "   conexiones establecidas en el 443 ahora: $(established443)"
say "   gateway viejo: $(docker ps --filter name=^capsule-gateway$ --format '{{.Names}} {{.Status}}')"

echo; echo "== Plan"
cat <<PLAN
 1. Escribe GW_PROXY_TRUSTED en $DIR/.env (copia .env.bak-443) para que cualquier 'compose up' posterior conserve la conmutacion.
 2. Arranca $NEXT (modo 443, uid 0 con solo NET_BIND_SERVICE+DAC_READ_SEARCH). Los puertos que sigan ocupados (443 de Caddy; 8443/5432 del
    gateway viejo, que corre con otro uid) los reintenta cada 100 ms: no hay hueco en los puertos del gateway viejo.
 3. Espera a que el 443 quede quieto (<= $MAX_EST conexiones en $WAIT_IDLE s; --force salta esto). Un 'git push' en curso por Caddy se corta al recrearlo.
 4. Recrea SOLO git-proxy con el override (publica 127.0.0.1:8444 y el 80; suelta el 443). El gateway toma el 443 en <= 100 ms.
 5. Comprueba por 127.0.0.1:443: git (Caddy via PROXY v2), 8444 sin PROXY rechazado, capsule/1. Si algo falla: rollback-443.sh --yes automatico.
 6. SIGTERM al gateway viejo (drena sus conexiones hasta CAPSULE_GW_DRAIN_TIMEOUT). Cuando termine: switch-443.sh --finish.
PLAN
if [ "$YES" -ne 1 ]; then
  echo; if [ "$FAILS" -eq 0 ]; then say "Previas OK. No se cambio nada (use --yes)."; exit 0; else say "Hay $FAILS fallas previas. No se cambio nada."; exit 1; fi
fi
[ "$FAILS" -eq 0 ] || die "$FAILS comprobaciones previas fallaron: no se conmuta"

echo; echo "== Ejecutando"
[ -f "$DIR/.env" ] && cp -p "$DIR/.env" "$DIR/.env.bak-443"
if grep -q '^GW_PROXY_TRUSTED=' "$DIR/.env" 2>/dev/null; then sed -i "s|^GW_PROXY_TRUSTED=.*|GW_PROXY_TRUSTED=\"$TRUSTED\"|" "$DIR/.env"; else printf 'GW_PROXY_TRUSTED="%s"\n' "$TRUSTED" >> "$DIR/.env"; fi
# shellcheck disable=SC2086
docker compose $CF_443 run -d --no-deps --name "$NEXT" -e CAPSULE_GW_METRICS_ADDR=127.0.0.1:9112 capsule-gateway >/dev/null || die "no arranco $NEXT"
wait_for 40 curl -sf http://127.0.0.1:9112/readyz || { docker logs --tail 5 "$NEXT" 2>&1; docker rm -f "$NEXT" >/dev/null; die "$NEXT no llego a healthy; no se toco nada mas"; }
ok "$NEXT listo (/readyz; esperando los puertos ocupados)"
end=$(( $(date +%s) + WAIT_IDLE )); n=$(established443)
while [ "$n" -gt "$MAX_EST" ] && [ "$(date +%s)" -lt "$end" ]; do sleep 1; n=$(established443); done
if [ "$n" -gt "$MAX_EST" ] && [ "$FORCE" -ne 1 ]; then docker rm -f "$NEXT" >/dev/null; die "$n conexiones aun en el 443 tras ${WAIT_IDLE}s (un git push?). No se toco nada; repetir luego o usar --force"; fi
[ "$n" -gt "$MAX_EST" ] && say "AVISO --force: se cortan $n conexiones del 443 al recrear Caddy"
# sonda de continuidad: intentos de conexion al 443 durante la conmutacion
PROBE_LOG=$(mktemp)
( while [ ! -f "$PROBE_LOG.stop" ]; do t=$(ms); if timeout 0.5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/443' 2>/dev/null; then echo "$t ok"; else echo "$t fail"; fi; sleep 0.02; done ) > "$PROBE_LOG" &
PROBER=$!
T0=$(ms)
# shellcheck disable=SC2086
if ! docker compose $CF_443 up -d --no-deps git-proxy >/dev/null 2>&1; then touch "$PROBE_LOG.stop"; bad "no se pudo recrear git-proxy"; "$HERE/rollback-443.sh" --yes; exit 1; fi
if ! wait_for 40 bash -c "curl -s http://127.0.0.1:9112/metrics | grep -q '^gw_take443_bound 1'"; then touch "$PROBE_LOG.stop"; bad "el gateway no tomo el 443 en 40 s"; "$HERE/rollback-443.sh" --yes; exit 1; fi
T1=$(ms); sleep 1; touch "$PROBE_LOG.stop"; wait $PROBER 2>/dev/null
FAILSPAN=$(awk '$2=="fail"{ if(!s)s=$1; e=$1 } END{ if(s) print e-s+20; else print 0 }' "$PROBE_LOG")
ok "el gateway tomo el 443 $((T1-T0)) ms despues de ordenar recrear Caddy; conexiones fallidas al 443: $(grep -c fail "$PROBE_LOG") (ventana ~${FAILSPAN} ms)"
rm -f "$PROBE_LOG" "$PROBE_LOG.stop"
sleep 2
if ! check_443_path gateway; then bad "comprobacion posterior fallida: reversa automatica"; "$HERE/rollback-443.sh" --yes; exit 1; fi
if running capsule-gateway; then docker kill -s TERM capsule-gateway >/dev/null && ok "SIGTERM al gateway viejo: drena (no acepta nuevas tras ~2 s; sigue con las abiertas)"; fi
say "Hecho. Vigilar: docker logs -f $NEXT ; verify.sh --host ; cuando el viejo termine: switch-443.sh --finish"
