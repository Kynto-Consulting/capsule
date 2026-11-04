#!/usr/bin/env bash
# Verificación del gateway universal. SOLO LECTURA: abre conexiones de prueba y lee estado; no cambia nada.
#
# Modo cliente (desde cualquier máquina con Internet; ideal una con IPv6 real, p. ej. un móvil o un VPS):
#   verify.sh --ipv4 3.224.61.221 --ipv6 2600:1f18:... [--zone tumi-ai.com] [--test-port 8443] [--git-domain git.tumi-ai.com] [--custom-domain d.cliente.com] [--web-apps-host x-y.apps.tumi-ai.com]
#             [--sni-name mi-proyecto.db.tumi-ai.com] [--pg "user=u dbname=d"]  (la clave: variable PGPASSWORD)
# Modo host (en el servidor, solo lectura: ss, docker inspect/stats, /proc):
#   verify.sh --host [--env /opt/capsule/deploy/gateway/gateway.env]
#
# Códigos de salida: 0 todo bien, 1 hubo fallos, 2 uso incorrecto. Un resultado SKIP no es fallo.
# Estados de un puerto TCP: open (acepta), refused (RST: el security group deja pasar y nada escucha), filtered (sin respuesta:
# el security group lo bloquea o no hay ruta).
set -u

ZONE=tumi-ai.com; V4=""; V6=""; TEST_PORT=""; SNI_NAME=""; PGSTR=""; HOSTMODE=0; ENVF=/opt/capsule/deploy/gateway/gateway.env
STD_PORTS="5432 3306 6379 27017"; POOL_SAMPLE=20000; GIT_DOMAIN=git.tumi-ai.com
PASS=0; FAIL=0; SKIP=0; CUSTOM_DOMAIN=""; WEB_APPS_HOST=""

while [ $# -gt 0 ]; do
  case "$1" in
    --zone) ZONE=$2; shift 2;; --ipv4) V4=$2; shift 2;; --ipv6) V6=$2; shift 2;; --test-port) TEST_PORT=$2; shift 2;;
    --sni-name) SNI_NAME=$2; shift 2;; --pg) PGSTR=$2; shift 2;; --std-ports) STD_PORTS=$2; shift 2;;
    --host) HOSTMODE=1; shift;; --env) ENVF=$2; shift 2;; --git-domain) GIT_DOMAIN=$2; shift 2;; --custom-domain) CUSTOM_DOMAIN=$2; shift 2;; --web-apps-host) WEB_APPS_HOST=$2; shift 2;;
    -h|--help) sed -n '2,15p' "$0"; exit 0;;
    *) echo "argumento desconocido: $1" >&2; exit 2;;
  esac
done

ok()   { PASS=$((PASS+1)); printf 'OK    %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf 'FALLA %s\n' "$*"; }
skip() { SKIP=$((SKIP+1)); printf 'SKIP  %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# probe HOST PORT -> imprime open|refused|filtered
probe() {
  local h=$1 p=$2 t0 t1 rc
  t0=$(date +%s%N)
  timeout 5 bash -c "exec 3<>/dev/tcp/$h/$p" 2>/dev/null; rc=$?
  t1=$(date +%s%N)
  if [ $rc -eq 0 ]; then echo open
  elif [ $rc -eq 124 ] || [ $(( (t1-t0)/1000000 )) -ge 4500 ]; then echo filtered
  else echo refused; fi
}

# ---------------------------------------------------------------------------------------------------------------------------
if [ "$HOSTMODE" -eq 1 ]; then
  echo "== Modo host (solo lectura)"
  have ss || { echo "falta ss"; exit 2; }
  # shellcheck disable=SC1090
  [ -r "$ENVF" ] && . "$ENVF" || skip "no se pudo leer $ENVF (se usan valores por defecto)"
  POOL=${CAPSULE_GW_PORT_POOL:-20000-29999}; STD=${CAPSULE_GW_LISTEN_STD:-5432}; TEST=${CAPSULE_GW_TEST_LISTEN:-:8443}

  echo "-- contenedor"
  if have docker; then
    st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' capsule-gateway 2>/dev/null || true)
    case "$st" in "running healthy") ok "capsule-gateway running healthy";; "") skip "capsule-gateway no existe (todavía no desplegado)";;
      *) bad "capsule-gateway: $st";; esac
    docker inspect -f 'nofile={{range .HostConfig.Ulimits}}{{.Name}}:{{.Soft}}/{{.Hard}} {{end}} mem={{.HostConfig.Memory}} net={{.HostConfig.NetworkMode}}' capsule-gateway 2>/dev/null || true
  else skip "docker no está disponible"; fi

  echo "-- escuchas (doble pila: [::]:puerto o *:puerto)"
  for p in $(echo "$STD" | tr ',' ' ') $(echo "$TEST" | sed 's/.*://'); do
    [ -z "$p" ] && continue
    if ss -ltn "sport = :$p" | grep -Eq '\[::\]:|\*:|0\.0\.0\.0:'; then
      v6=$(ss -ltn "sport = :$p" | grep -c '\[::\]:'); [ "$v6" -gt 0 ] && ok "puerto $p escucha en IPv6 (doble pila)" || bad "puerto $p solo escucha en IPv4"
    else bad "nada escucha en el puerto $p"; fi
  done
  for p in 443 80; do ss -ltnp "sport = :$p" | tail -n +2 | sed "s/^/   puerto $p: /"; done
  echo "   (con CAPSULE_GW_TAKE_443=${CAPSULE_GW_TAKE_443:-0}: el dueño del 443 debe ser $( [ "${CAPSULE_GW_TAKE_443:-0}" = 1 ] && echo capsule-gateway || echo docker-proxy/caddy ))"

  echo "-- 443 compartido con Caddy (CAPSULE_GW_TAKE_443=${CAPSULE_GW_TAKE_443:-0} en el archivo de entorno; lo efectivo es lo que muestra ss)"
  own=$(ss -ltnpH 'sport = :443' 2>/dev/null | grep -o 'users:(("[^"]*"' | head -1 | sed 's/.*(("//; s/"//')
  if [ -z "$own" ] && ss -ltnH 'sport = :443' 2>/dev/null | grep -q .; then
    if have docker && docker port capsule-git-proxy 443 2>/dev/null | grep -Eq ':443$'; then own=docker-proxy; elif have docker && docker ps --format '{{.Names}}' | grep -q '^capsule-gateway'; then own=capsule-gateway; fi
  fi
  case "${own:-nadie}" in
    docker-proxy*|caddy*) ok "el 443 es de Caddy (modo F1); 8444 no debe escucharse"
      ss -ltnH 'sport = :8444' 2>/dev/null | grep -q . && bad "8444 escucha con el 443 en Caddy: estado mixto (�conmutacion a medias? ver RUNBOOK-443.md)";;
    capsule-gateway*) ok "el 443 es del gateway (modo F2)"
      ss -ltnH 'sport = :8444' 2>/dev/null | grep -q '127.0.0.1:8444' && ok "Caddy escucha en 127.0.0.1:8444" || bad "nada escucha en 127.0.0.1:8444: el HTTPS de git falla"
      ss -ltnH 'sport = :8444' 2>/dev/null | grep -Eq '(0\.0\.0\.0|\*|\[::\]):8444' && bad "8444 escucha en TODAS las interfaces (debe ser solo loopback)"
      if have curl; then
        code=$(curl -s -k -m 8 --haproxy-protocol --resolve "$GIT_DOMAIN:8444:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$GIT_DOMAIN:8444/" 2>/dev/null)
        case "$code" in 2??|3??|401|403|404) ok "Caddy acepta PROXY v2 en 8444 (HTTP $code)";; *) bad "Caddy no acepta PROXY v2 en 8444: '$code' (GW_PROXY_TRUSTED)";; esac
        code=$(curl -s -k -m 8 --resolve "$GIT_DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$GIT_DOMAIN/" 2>/dev/null)
        case "$code" in 2??|3??|401|403|404) ok "https://$GIT_DOMAIN por el 443 llega a Caddy (HTTP $code)";; *) bad "https://$GIT_DOMAIN por el 443: '$code'";; esac
      fi
      for mp in 9102 9112; do
        if have curl && curl -sf -m 3 "http://127.0.0.1:$mp/metrics" 2>/dev/null | grep -q '^gw_take443_bound 1'; then ok "metrica gw_take443_bound=1 (instancia con admin en $mp)"; fi
      done;;
    nadie) bad "NADIE escucha el 443";;
    *) bad "due�o inesperado del 443: $own";;
  esac
  [ "${CAPSULE_GW_TAKE_443:-0}" = 1 ] && [ "${own:-}" != capsule-gateway ] && echo "   (gateway.env dice TAKE_443=1 pero lo efectivo lo fija docker-compose.take443.yml: esto solo es un aviso)"

  echo "-- pool ${POOL} frente a puertos directos 40000-41999: no deben solaparse"
  lo=${POOL%-*}; hi=${POOL#*-}
  { [ "$hi" -lt 40000 ] && [ "$lo" -ge 1024 ]; } && ok "pool fuera de 40000-41999" || bad "el pool se solapa con los puertos directos"
  n=$(ss -ltn | awk '{print $4}' | sed 's/.*://' | awk -v lo="$lo" -v hi="$hi" '$1>=lo && $1<=hi' | sort -u | wc -l)
  echo "   puertos del pool con listener ahora: $n"

  echo "-- descriptores y memoria del proceso"
  pid=$(pgrep -f 'capsule-gateway' | head -1)
  if [ -n "${pid:-}" ] && [ -r /proc/$pid/limits ]; then
    fds=$(ls /proc/$pid/fd 2>/dev/null | wc -l); lim=$(awk '/Max open files/{print $4}' /proc/$pid/limits)
    conns=$(ss -tn state established 2>/dev/null | awk -v p="$pid" 'NR>1' | wc -l)
    echo "   fds=$fds limite=$lim rss=$(awk '/VmRSS/{print $2" kB"}' /proc/$pid/status)"
    [ "$lim" -ge 65536 ] && ok "LimitNOFILE >= 65536" || bad "LimitNOFILE $lim < 65536"
    pipes=$(ls -l /proc/$pid/fd 2>/dev/null | grep -c 'pipe:')
    echo "   de ellos pipes (splice, 4 por conexión en passthrough): $pipes"
    [ "$lim" -gt 0 ] && [ $((fds*100/lim)) -lt 80 ] && ok "uso de descriptores < 80 %" || bad "descriptores al ${fds}/${lim}"
  else skip "proceso capsule-gateway no encontrado en este namespace de PID"; fi
  have docker && docker stats --no-stream --format '   docker stats: {{.Name}} mem={{.MemUsage}} cpu={{.CPUPerc}}' capsule-gateway capsule-git capsule-git-proxy capsule-backend 2>/dev/null
  free -m | sed 's/^/   /'
  echo "-- IPv6 del host"
  ip -6 addr show scope global | grep -q inet6 && ok "el host tiene dirección IPv6 global" || bad "sin IPv6 global"
  ip -6 route show default | grep -q default && ok "hay ruta IPv6 por defecto" || bad "sin ruta IPv6 por defecto (¿accept_ra? ver RUNBOOK-ipv6.md)"
  echo; echo "Resumen: $PASS ok, $FAIL fallas, $SKIP omitidas"; [ "$FAIL" -eq 0 ]; exit $?
fi

# ---------------------------------------------------------------------------------------------------------------------------
[ -n "$V4" ] || [ -n "$V6" ] || { echo "indique --ipv4 y/o --ipv6 (o use --host en el servidor)" >&2; exit 2; }
echo "== Modo cliente: zona $ZONE"

CLIENT_V6=$(curl -6 -s -m 5 https://ifconfig.co 2>/dev/null || true)
[ -n "$V6" ] && [ -z "$CLIENT_V6" ] && echo "AVISO: este cliente no tiene salida IPv6: se omiten las pruebas IPv6 (ejecute desde una red con IPv6 real)."

echo "-- DNS (debe coincidir con RUNBOOK-dns.md)"
if have dig; then
  for n in "tcp.apps.$ZONE" "udp.apps.$ZONE" "verify-probe.db.$ZONE"; do
    a=$(dig +short A "$n" | tr '\n' ' '); aaaa=$(dig +short AAAA "$n" | tr '\n' ' ')
    [ -z "$V4" ] || { [ "$a" = "$V4 " ] && ok "A    $n = $V4" || bad "A    $n = '${a}' (esperado $V4)"; }
    [ -z "$V6" ] || { [ "$aaaa" = "$V6 " ] && ok "AAAA $n = $V6" || bad "AAAA $n = '${aaaa}' (esperado $V6)"; }
  done
else skip "dig no está instalado (apt install dnsutils)"; fi

echo "-- puertos TCP (open o refused = el security group deja pasar; filtered = bloqueado)"
for fam in 4 6; do
  H=$V4; [ "$fam" = 6 ] && H=$V6; [ -z "$H" ] && continue
  if [ "$fam" = 6 ] && [ -z "$CLIENT_V6" ]; then skip "IPv6 puertos: el cliente no tiene IPv6"; continue; fi
  for p in 443 $STD_PORTS $TEST_PORT; do
    [ -z "$p" ] && continue
    s=$(probe "$H" "$p")
    case "$s" in open) ok "IPv$fam $p abierto y con listener";; refused) ok "IPv$fam $p sin listener (el security group deja pasar; esperado hasta desplegar el gateway)";;
      *) bad "IPv$fam $p filtered: el security group lo bloquea (¿gateway_enabled aplicado?)";; esac
  done
  s=$(probe "$H" "$POOL_SAMPLE")
  [ "$s" = filtered ] && bad "IPv$fam pool (muestra $POOL_SAMPLE) filtered: falta la regla capsule:gwpool" || ok "IPv$fam pool (muestra $POOL_SAMPLE): $s"
done

echo "-- SNI con openssl (el gateway debe enrutar por nombre; un nombre sin ruta se cierra sin certificado)"
if have openssl; then
  PORT=${TEST_PORT:-443}; [ -z "$TEST_PORT" ] && PORT=5432
  NAME=${SNI_NAME:-verify-probe.db.$ZONE}
  for fam in 4 6; do
    if [ "$fam" = 4 ]; then H=$V4; else H=$V6; fi; [ -z "$H" ] && continue
    if [ "$fam" = 6 ] && [ -z "$CLIENT_V6" ]; then skip "IPv6 SNI: el cliente no tiene IPv6"; continue; fi
    [ "$fam" = 6 ] && H="[$H]"
    if [ "$PORT" = 5432 ]; then SSLARGS="-starttls postgres"; else SSLARGS=""; fi
    out=$(echo | timeout 8 openssl s_client $SSLARGS -connect "$H:$PORT" -servername "$NAME" 2>&1)
    if echo "$out" | grep -q 'BEGIN CERTIFICATE'; then
      ok "IPv$fam $NAME:$PORT presentó certificado: $(echo "$out" | grep -m1 -E 'subject=' )"
    elif [ -n "$SNI_NAME" ]; then bad "IPv$fam $NAME:$PORT no presentó certificado (ruta inexistente o gateway caído)"
    else skip "IPv$fam $NAME:$PORT sin certificado (normal si no hay ruta; pase --sni-name con un proyecto real)"; fi
    out2=$(echo | timeout 8 openssl s_client $SSLARGS -connect "$H:$PORT" -servername "no-existe-$RANDOM.db.$ZONE" 2>&1)
    if ! echo "$out2" | grep -q 'CONNECTED'; then skip "IPv$fam $H:$PORT no conectó: no se evalúa el nombre inexistente"
    elif echo "$out2" | grep -q 'BEGIN CERTIFICATE'; then bad "IPv$fam un nombre inexistente recibió certificado (enumeración posible)"
    else ok "IPv$fam nombre inexistente: cierre sin certificado"; fi
  done
else skip "openssl no está instalado"; fi

echo "-- PostgreSQL con psql sslmode=require (libpq envía SNI con sslsni=1, el valor por defecto)"
if [ -n "$PGSTR" ] && [ -n "$SNI_NAME" ]; then
  if have psql; then
    for fam in 4 6; do
      A=$V4; [ "$fam" = 6 ] && A=$V6; [ -z "$A" ] && continue
      [ "$fam" = 6 ] && [ -z "$CLIENT_V6" ] && { skip "IPv6 psql: el cliente no tiene IPv6"; continue; }
      r=$(psql "host=$SNI_NAME hostaddr=$A port=5432 sslmode=require sslsni=1 connect_timeout=8 $PGSTR" -Atc 'select 1' 2>&1)
      [ "$r" = 1 ] && ok "IPv$fam psql conectó por nombre ($SNI_NAME)" || bad "IPv$fam psql: $(echo "$r" | head -1)"
    done
    r=$(psql "host=$SNI_NAME hostaddr=${V4:-$V6} port=5432 sslmode=require sslsni=0 connect_timeout=8 $PGSTR" -Atc 'select 1' 2>&1)
    [ "$r" = 1 ] && bad "sslsni=0 conectó: el gateway no debería poder enrutar sin nombre" || ok "sslsni=0 rechazado (sin nombre no hay ruta, esperado)"
  else skip "psql no está instalado (apt install postgresql-client)"; fi
else skip "indique --sni-name y --pg para la prueba con psql (clave en PGPASSWORD)"; fi

echo "-- 443 compartido: el HTTPS de $GIT_DOMAIN debe llegar a Caddy y capsule/1 al gateway"
if have curl; then
  for fam in 4 6; do
    A=$V4; [ "$fam" = 6 ] && A=$V6; [ -z "$A" ] && continue
    if [ "$fam" = 6 ] && [ -z "$CLIENT_V6" ]; then skip "IPv6 git: el cliente no tiene IPv6"; continue; fi
    HH=$A; [ "$fam" = 6 ] && HH="[$A]"
    code=$(curl -s -m 10 -g --resolve "$GIT_DOMAIN:443:$A" -o /dev/null -w '%{http_code}' "https://$GIT_DOMAIN/" 2>/dev/null)
    case "$code" in 2??|3??|401|403|404) ok "IPv$fam https://$GIT_DOMAIN:443 -> HTTP $code (certificado valido, Caddy)";; *) bad "IPv$fam https://$GIT_DOMAIN:443 fallo ('$code')";; esac
  done
fi
if have openssl; then
  for fam in 4 6; do
    A=$V4; [ "$fam" = 6 ] && A=$V6; [ -z "$A" ] && continue
    if [ "$fam" = 6 ] && [ -z "$CLIENT_V6" ]; then continue; fi
    [ "$fam" = 6 ] && A="[$A]"
    if echo | timeout 8 openssl s_client -connect "$A:443" -servername "tcp.apps.$ZONE" -alpn capsule/1 -tls1_3 2>&1 | grep -q "ALPN protocol: capsule/1"; then ok "IPv$fam capsule/1 por el 443 (tcp.apps.$ZONE)"
    else skip "IPv$fam capsule/1 por el 443 no negociado (normal con el 443 en Caddy o sin certificado de tcp.apps)"; fi
  done
fi

echo "-- web sin ALB (Caddy): app, api, *.apps y /internal/* cerrado (certificado VALIDO, sin -k; ver docs/gateway/RUNBOOK-alb-removal.md)"
if have curl && [ -n "$V4" ]; then
  APPS_HOST="${WEB_APPS_HOST:-verify-probe-sin-proyecto.apps.$ZONE}"
  for h in "app.$ZONE" "api.$ZONE" "$APPS_HOST"; do
    code=$(curl -s -m 10 --resolve "$h:443:$V4" -o /dev/null -w '%{http_code} %{http_version} %{ssl_verify_result}' "https://$h/" 2>/dev/null)
    case "$code" in
      [1-4]??" "*" 0") ok "https://$h por la IP del servidor: HTTP ${code%% *} (h${code#* }, certificado valido)";;
      *) bad "https://$h por la IP del servidor: '$code' (certificado invalido o sin respuesta; 3.. 4.. son normales segun la app)";;
    esac
  done
  for h in "api.$ZONE" "app.$ZONE" "$APPS_HOST"; do
    for p in /internal/git-auth /internal/gateway/routes /INTERNAL/x /internal/tls/ask?domain=x.example; do
      code=$(curl -s -m 10 --resolve "$h:443:$V4" -o /dev/null -w '%{http_code}' "https://$h$p" 2>/dev/null)
      [ "$code" = 404 ] && ok "https://$h$p -> 404 (cerrado)" || bad "https://$h$p -> '$code' (debe ser 404 desde fuera)"
    done
  done
  c80=$(curl -s -m 10 --resolve "app.$ZONE:80:$V4" -o /dev/null -w '%{http_code} %{redirect_url}' "http://app.$ZONE/x" 2>/dev/null)
  case "$c80" in 30[18]" https://app.$ZONE/x") ok "http://app.$ZONE -> redireccion a https ($c80)";; *) bad "http://app.$ZONE: '$c80' (se esperaba 308 a https)";; esac
  if [ -n "$CUSTOM_DOMAIN" ]; then
    code=$(curl -s -m 20 --resolve "$CUSTOM_DOMAIN:443:$V4" -o /dev/null -w '%{http_code} %{ssl_verify_result}' "https://$CUSTOM_DOMAIN/" 2>/dev/null)
    case "$code" in [1-5]??" 0") ok "dominio personalizado $CUSTOM_DOMAIN: certificado a demanda valido (HTTP ${code%% *})";; *) bad "dominio personalizado $CUSTOM_DOMAIN: '$code'";; esac
  else skip "indique --custom-domain <dominio verificado de un proyecto> para probar TLS a demanda"; fi
  echo | timeout 8 openssl s_client -connect "$V4:443" -servername "no-avalado-$$.example.invalid" 2>&1 | grep -q "BEGIN CERTIFICATE" \
    && bad "un nombre NO avalado recibio certificado (on_demand_tls ask no esta filtrando)" || ok "nombre no avalado: sin certificado (ask rechaza)"
else skip "web sin ALB: falta curl o --ipv4"; fi

echo "-- IPv6 real del cliente: ${CLIENT_V6:-no tiene salida IPv6}"
echo; echo "Resumen: $PASS ok, $FAIL fallas, $SKIP omitidas"; [ "$FAIL" -eq 0 ]
