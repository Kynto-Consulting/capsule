#!/usr/bin/env bash
# Funciones comunes de switch-443.sh y rollback-443.sh (se carga con `. lib-443.sh`; no se ejecuta). Ver docs/gateway/RUNBOOK-443.md.
DIR=${CAPSULE_DIR:-/opt/capsule}
EXTRA=${CAPSULE_COMPOSE_EXTRA:-}            # archivos -f adicionales (pruebas): "-f otro.yml"
GIT_DOMAIN=${GIT_DOMAIN:-git.tumi-ai.com}
TUNNEL_HOST=${TUNNEL_HOST:-tcp.apps.tumi-ai.com}   # = tcp.<CAPSULE_GW_ZONE>: con zona apps.tumi-ai.com
CURL_K=${CURL_K:-}                           # "-k" solo en pruebas con certificados internos
NEXT=capsule-gateway-next                    # gateway nuevo mientras el viejo drena
PROBE_PORT=${PROBE_PORT:-18444}
CF_BASE="--project-directory $DIR -f $DIR/docker-compose.prod.yml -f $DIR/deploy/gateway/docker-compose.gateway.yml $EXTRA --profile gateway"
CF_443="--project-directory $DIR -f $DIR/docker-compose.prod.yml -f $DIR/deploy/gateway/docker-compose.gateway.yml -f $DIR/deploy/gateway/docker-compose.take443.yml $EXTRA --profile gateway"
export CAPSULE_GATEWAY_IMAGE=${CAPSULE_GATEWAY_IMAGE:-$(docker inspect -f '{{.Config.Image}}' capsule-gateway 2>/dev/null || true)}

say()  { printf '%s\n' "$*"; }
ok()   { printf 'OK    %s\n' "$*"; }
bad()  { printf 'FALLA %s\n' "$*"; }
die()  { printf 'ABORTA %s\n' "$*" >&2; exit 1; }
ms()   { echo $(( $(date +%s%N) / 1000000 )); }
have() { command -v "$1" >/dev/null 2>&1; }

compose_ok() {
  local v; v=$(docker compose version --short 2>/dev/null | sed 's/^v//') || return 1
  [ "$(printf '%s\n2.24.4\n' "$v" | sort -V | head -1)" = "2.24.4" ]   # !override exige >= 2.24.4
}

# Dueño actual del 443: "docker-proxy", "capsule-gateway", otro nombre o "nadie".
owner443() {
  local o; o=$(ss -ltnpH 'sport = :443' 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/.*(("//; s/"//')
  if [ -z "$o" ] && ss -ltnH 'sport = :443' 2>/dev/null | grep -q .; then   # sin root ss no muestra procesos ajenos: se deduce de docker
    if docker port capsule-git-proxy 443 2>/dev/null | grep -Eq ':443$'; then o=docker-proxy
    elif docker ps --format '{{.Names}}' | grep -q '^capsule-gateway'; then o=capsule-gateway
    else o="(desconocido)"; fi
  fi
  [ -n "$o" ] && echo "$o" || echo nadie
}
established443() { ss -tnH state established '( sport = :443 )' 2>/dev/null | wc -l; }
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; }
wait_for() { # wait_for SEGUNDOS comando...
  local t=$1; shift; local end=$(( $(date +%s) + t ))
  while [ "$(date +%s)" -lt "$end" ]; do "$@" >/dev/null 2>&1 && return 0; sleep 0.2; done; return 1
}

# IPs desde las que Caddy ve llegar a docker-proxy (127.0.0.1:PUERTO publicado): una sonda `caddy respond` por cada red de git-proxy.
observe_sources() {
  local img nets n ip; img=$(docker inspect -f '{{.Config.Image}}' capsule-git-proxy) || return 1
  nets=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' capsule-git-proxy)
  for n in $nets; do
    docker rm -f capsule-443-probe >/dev/null 2>&1
    docker run -d --rm --name capsule-443-probe --network "$n" -p "127.0.0.1:$PROBE_PORT:8000" "$img" caddy respond --listen :8000 --access-log --body ok >/dev/null 2>&1 || continue
    wait_for 10 curl -s "http://127.0.0.1:$PROBE_PORT/" || true
    ip=$(docker logs capsule-443-probe 2>&1 | grep -o '"remote_ip":"[^"]*"' | head -1 | cut -d'"' -f4)
    docker rm -f capsule-443-probe >/dev/null 2>&1
    [ -n "$ip" ] && echo "$ip"
  done | sort -u
}
to_cidrs() { while read -r a; do [ -z "$a" ] && continue; case "$a" in *:*) echo "$a/128";; *) echo "$a/32";; esac; done | tr '\n' ' ' | sed 's/ $//'; }

# Comprobaciones de extremo a extremo por 127.0.0.1:443 (las usan switch y rollback). owner = quien debe tener el 443.
check_443_path() { # check_443_path gateway|caddy
  local want=$1 rc=0 code
  code=$(curl -s $CURL_K -m 8 --resolve "$GIT_DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$GIT_DOMAIN/" 2>/dev/null)
  case "$code" in 2??|3??|401|403|404) ok "https://$GIT_DOMAIN por 127.0.0.1:443 responde HTTP $code (Caddy)";; *) bad "https://$GIT_DOMAIN por el 443: codigo '$code'"; rc=1;; esac
  if [ "$want" = gateway ]; then
    code=$(curl -s $CURL_K -m 8 --haproxy-protocol --resolve "$GIT_DOMAIN:8444:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$GIT_DOMAIN:8444/" 2>/dev/null)
    case "$code" in 2??|3??|401|403|404) ok "Caddy acepta PROXY v2 en 127.0.0.1:8444 (HTTP $code)";; *) bad "Caddy no acepta el encabezado PROXY desde el origen del docker-proxy (GW_PROXY_TRUSTED mal): '$code'"; rc=1;; esac
    if have openssl; then
      if echo | timeout 8 openssl s_client -connect 127.0.0.1:443 -servername "$TUNNEL_HOST" -alpn capsule/1 -tls1_3 2>&1 | grep -q "ALPN protocol: capsule/1"; then ok "capsule/1 por el 443 (ALPN capsule/1, $TUNNEL_HOST)"
      else say "AVISO no se pudo negociar capsule/1 en $TUNNEL_HOST (certificado del gateway ausente o sin sincronizar: ver sync-certs.sh)"; fi
    fi
  fi
  return $rc
}
