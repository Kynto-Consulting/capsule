#!/usr/bin/env bash
# Reversa del 443: del gateway de vuelta a Caddy, de UNA orden (tambien la llama switch-443.sh si falla su comprobacion).
#   rollback-443.sh               -> SOLO LECTURA: estado y plan. No cambia nada.
#   rollback-443.sh --yes         -> ejecuta (root, /opt/capsule)
#   rollback-443.sh --finish      -> cuando los gateways que drenan terminaron: un solo gateway (modo F1) administrado por compose
# Orden exacto (el 443 nunca queda sin dueño mas de unos segundos): (1) arranca un gateway en modo F1 (sin 443) que espera los
# puertos 8443/5432 del que drena; (2) SIGTERM a los gateways que tienen el 443: tras ~2 s sueltan TODOS sus puertos y siguen con las
# conexiones abiertas; (3) recrea git-proxy con el compose de PRODUCCION (80 y 443:443) reintentando hasta que el 443 este libre.
# No toca: Forgejo, backend, bases, puertos directos 40000-41999, reglas del security group, DNS, docker-compose.prod.yml ni el Caddyfile.
set -u
HERE=$(cd "$(dirname "$0")" && pwd); . "$HERE/lib-443.sh"
YES=0; FINISH=0
for a in "$@"; do case "$a" in --yes) YES=1;; --finish) FINISH=1;; -h|--help) sed -n '2,10p' "$0"; exit 0;; *) die "argumento desconocido: $a";; esac; done
have docker || die "docker no disponible: ejecutar en el host"
R0=capsule-gateway-r0
HOLDERS=$(docker ps --format '{{.Names}}' | grep -E '^capsule-gateway(-next)?$' | tr '\n' ' ')

if [ "$FINISH" -eq 1 ]; then
  running "$R0" || die "no hay $R0 en marcha: nada que finalizar"
  for g in capsule-gateway "$NEXT"; do running "$g" && die "$g sigue drenando: esperar a que termine"; done
  docker rm capsule-gateway "$NEXT" >/dev/null 2>&1
  # shellcheck disable=SC2086
  docker compose $CF_BASE up -d --no-deps capsule-gateway || die "compose no pudo crear capsule-gateway"
  wait_for 60 healthy capsule-gateway || die "capsule-gateway no llego a healthy; $R0 sigue sirviendo"
  docker kill -s TERM "$R0" >/dev/null && ok "SIGTERM a $R0"; say "Cuando termine: docker rm $R0"; exit 0
fi

echo "== Estado"; say "   dueño del 443: $(owner443) | gateways en marcha: ${HOLDERS:-ninguno} | git-proxy publica: $(docker port capsule-git-proxy 2>/dev/null | tr '\n' ' ')"
echo "== Plan"
cat <<PLAN
 1. Arranca $R0 (modo F1: sin 443; reintenta 8443/5432 hasta que el gateway que drena los suelte).
 2. SIGTERM a: ${HOLDERS:-(ninguno)}  -> sueltan sus puertos y drenan lo abierto.
 3. Recrea git-proxy con docker-compose.prod.yml (80:80 y 443:443, Caddyfile de produccion), reintentando hasta que el 443 este libre (<= 60 s).
 4. Comprueba https://$GIT_DOMAIN por 127.0.0.1:443. Las conexiones abiertas hacia 127.0.0.1:8444 se cortan (git push en curso: reintento del cliente).
 5. Despues: rollback-443.sh --finish (un solo gateway administrado por compose).
PLAN
if [ "$YES" -ne 1 ]; then echo; say "(no se cambio nada; use --yes)"; exit 0; fi
[ -n "${CAPSULE_GATEWAY_IMAGE:-}" ] || die "defina CAPSULE_GATEWAY_IMAGE"
echo; echo "== Ejecutando"; T0=$(ms)
if running "$R0"; then say "$R0 ya estaba en marcha"; else
  # shellcheck disable=SC2086
  docker compose $CF_BASE run -d --no-deps --name "$R0" -e CAPSULE_GW_TAKE_443=0 -e CAPSULE_GW_BIND_RETRY=10m -e CAPSULE_GW_METRICS_ADDR=127.0.0.1:9122 capsule-gateway >/dev/null || die "no arranco $R0"
  wait_for 30 curl -sf http://127.0.0.1:9122/readyz || say "AVISO $R0 aun no responde /readyz; se sigue"
fi
for g in $HOLDERS; do docker kill -s TERM "$g" >/dev/null && ok "SIGTERM a $g"; done
if wait_for 40 bash -c "[ \"\$(ss -ltnH 'sport = :443' | wc -l)\" = 0 ]"; then ok "el 443 quedo libre a los $(( $(ms) - T0 )) ms"; else say "AVISO el 443 sigue ocupado: $(owner443) (se reintenta igual)"; fi
ok_caddy=0
for i in $(seq 1 60); do
  # shellcheck disable=SC2086
  if docker compose $CF_BASE up -d --no-deps --force-recreate git-proxy >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' capsule-git-proxy)" = true ] && docker port capsule-git-proxy 443 2>/dev/null | grep -Eq ':443$'; then ok_caddy=1; break; fi
  sleep 1
done
[ "$ok_caddy" = 1 ] || die "Caddy no pudo volver al 443 en 60 s: revisar 'ss -ltnp sport = :443' y 'docker compose ... up -d git-proxy' a mano"
ok "Caddy publica el 443 otra vez ($(( $(ms) - T0 )) ms desde el inicio)"
wait_for 20 check_443_path caddy; check_443_path caddy || bad "comprobacion final fallida: revisar docker logs capsule-git-proxy"
say "Hecho. Cuando los gateways que drenan terminen: rollback-443.sh --finish"
