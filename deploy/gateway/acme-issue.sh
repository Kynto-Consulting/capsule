#!/bin/bash
# Emite/renueva los certificados comodin *.apps.<zona> y *.db.<zona> (Let's Encrypt, DNS-01 por CNAME delegado a Route53) con lego
# en un contenedor, los instala en /opt/capsule/gateway/certs y envia SIGHUP al gateway. Idempotente: no hace nada si ambos
# certificados existen y les quedan mas de ACME_RENEW_DAYS (30) dias. Ver docs/gateway/RUNBOOK-acme.md.
#
# Uso (root):  acme-issue.sh [--staging] [--force] [--check]
#   --staging  usa el CA de pruebas de Let's Encrypt; NO instala en el directorio del gateway (deja los archivos en
#              $ACME_STATE/staging-out), para no sustituir un certificado valido por uno de pruebas.
#   --force    emite aunque falten mas de ACME_RENEW_DAYS dias.
#   --check    no emite: sale 1 si algun certificado falta o le quedan < ACME_ALERT_DAYS (21) dias (para la alarma).
#
# Credenciales: el rol de la instancia asume el rol minimo capsule-acme (solo TXT apps.acme/db.acme en una zona); las credenciales
# temporales (15 min) van a un archivo 0600 en /dev/shm que se borra al salir. No hay claves de larga vida ni nada en /tmp.
# Configuracion: /opt/capsule/deploy/gateway/acme.env (acme.env.example). Las variables ACME_TEST_* solo las usa la prueba local.
set -euo pipefail
umask 077

ENV_FILE="${ACME_ENV_FILE:-/opt/capsule/deploy/gateway/acme.env}"
[ -r "$ENV_FILE" ] && { set -a; . "$ENV_FILE"; set +a; }

ZONE="${CAPSULE_GW_ZONE:-tumi-ai.com}"
EMAIL="${ACME_EMAIL:?ACME_EMAIL en acme.env}"
ZONE_ID="${ACME_ZONE_ID:-}"
ROLE_ARN="${ACME_ROLE_ARN:-}"
PROVIDER="${ACME_DNS_PROVIDER:-route53}"
STATE="${ACME_STATE:-/opt/capsule/gateway/acme}"
DST="${ACME_CERT_DIR:-/opt/capsule/gateway/certs}"
UID_GW="${GW_UID:-65532}"
RENEW_DAYS="${ACME_RENEW_DAYS:-30}"
ALERT_DAYS="${ACME_ALERT_DAYS:-21}"
GW_CONTAINER="${ACME_GATEWAY_CONTAINER:-capsule-gateway}"
FAMILIES="${ACME_FAMILIES:-apps db}"
# lego v4.25.2, fijado por digest (indice multi-arquitectura). Actualizar a proposito: docker pull + comprobar el digest nuevo.
LEGO_IMAGE="${ACME_LEGO_IMAGE:-goacme/lego@sha256:01d6d764dec61ca9d39f43320657c5652106e9d9f326bde6d402c4853451a40b}"
PROD_SERVER="https://acme-v02.api.letsencrypt.org/directory"
STAGING_SERVER="https://acme-staging-v02.api.letsencrypt.org/directory"

STAGING=0; FORCE=0; CHECK=0
for a in "$@"; do case "$a" in
  --staging) STAGING=1 ;; --force) FORCE=1 ;; --check) CHECK=1 ;;
  *) echo "uso: $0 [--staging] [--force] [--check]" >&2; exit 2 ;; esac; done

SERVER="${ACME_SERVER:-$PROD_SERVER}"
if [ "$STAGING" = 1 ]; then SERVER="$STAGING_SERVER"; STATE="$STATE/staging"; DST="${ACME_STAGING_OUT:-$STATE-out}"; fi

days_left() { # archivo -> dias enteros hasta expirar (negativo/0 si falta o ya expiro)
  [ -f "$1" ] || { echo 0; return; }
  local end; end="$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)"
  echo $(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
}

if [ "$CHECK" = 1 ]; then
  rc=0
  for f in $FAMILIES; do d="$(days_left "$DST/wildcard-$f.crt")"; echo "wildcard-$f: $d dias"; [ "$d" -ge "$ALERT_DAYS" ] || rc=1; done
  exit $rc
fi

need=""
for f in $FAMILIES; do
  if [ "$FORCE" = 1 ] || [ ! -f "$DST/wildcard-$f.key" ] || [ "$(days_left "$DST/wildcard-$f.crt")" -lt "$RENEW_DAYS" ]; then need="$need $f"; fi
done
[ -n "$need" ] || { echo "certificados vigentes (> $RENEW_DAYS dias): nada que hacer"; exit 0; }

exec 9>"${ACME_LOCK:-/run/capsule-acme.lock}"; flock -n 9 || { echo "otra emision en curso"; exit 0; }

mkdir -p "$STATE" "$DST"; chown "$UID_GW:$UID_GW" "$STATE"; chmod 0700 "$STATE"
work="$(mktemp -d "$DST/.acme.XXXXXX")"          # en el mismo sistema de archivos que el destino: mv atomico, nunca /tmp
envf="$(mktemp /dev/shm/capsule-acme.XXXXXX)"
trap 'rm -rf "$work" "$envf"' EXIT

: >"$envf"
if [ "$PROVIDER" = route53 ]; then
  : "${ZONE_ID:?ACME_ZONE_ID en acme.env}" "${ROLE_ARN:?ACME_ROLE_ARN en acme.env}"
  creds="$(aws sts assume-role --role-arn "$ROLE_ARN" --role-session-name capsule-acme --duration-seconds 900 \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)"
  read -r ak sk st <<<"$creds"
  printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_SESSION_TOKEN=%s\nAWS_REGION=us-east-1\nAWS_HOSTED_ZONE_ID=%s\nAWS_PROPAGATION_TIMEOUT=300\nAWS_POLLING_INTERVAL=5\n' \
    "$ak" "$sk" "$st" "$ZONE_ID" >"$envf"
  unset ak sk st creds
fi
[ -n "${ACME_TEST_ENV_FILE:-}" ] && cat "$ACME_TEST_ENV_FILE" >>"$envf"   # solo pruebas locales

lego() { # sin red del host, sin capacidades, sistema de archivos de solo lectura; el estado es lo unico escribible
  # shellcheck disable=SC2086
  docker run --rm --user "$UID_GW:$UID_GW" --read-only --cap-drop ALL --security-opt no-new-privileges \
    --env-file "$envf" -v "$STATE:/data" ${ACME_TEST_DOCKER_ARGS:-} "$LEGO_IMAGE" \
    --path /data --server "$SERVER" --email "$EMAIL" --accept-tos --dns "$PROVIDER" \
    --dns.resolvers "${ACME_RESOLVERS:-1.1.1.1:53}" ${ACME_TEST_LEGO_ARGS:-} "$@"
}

changed=0
for f in $need; do
  dom="*.$f.$ZONE"; name="wildcard-$f"
  echo "emitiendo/renovando $dom"
  if [ -f "$STATE/certificates/_.$f.$ZONE.crt" ] && [ "$FORCE" = 0 ]; then
    lego --domains "$dom" renew --no-random-sleep --days "$RENEW_DAYS"
  elif [ -f "$STATE/certificates/_.$f.$ZONE.crt" ]; then
    lego --domains "$dom" renew --no-random-sleep --days 100000
  else
    lego --domains "$dom" run
  fi
  src="$STATE/certificates/_.$f.$ZONE"   # lego guarda el comodin como _.<dominio>
  [ -s "$src.crt" ] && [ -s "$src.key" ] || { echo "lego no dejo $name" >&2; exit 1; }
  # el par debe coincidir antes de tocar nada
  [ "$(openssl x509 -in "$src.crt" -noout -pubkey | openssl sha256)" = "$(openssl pkey -in "$src.key" -pubout | openssl sha256)" ] \
    || { echo "la clave no corresponde al certificado de $name" >&2; exit 1; }
  if [ -f "$DST/$name.crt" ] && cmp -s "$src.crt" "$DST/$name.crt"; then continue; fi
  install -m 0600 "$src.key" "$work/$name.key"; chown "$UID_GW:$UID_GW" "$work/$name.key"
  install -m 0644 "$src.crt" "$work/$name.crt"; chown "$UID_GW:$UID_GW" "$work/$name.crt"
  mv -f "$work/$name.key" "$DST/$name.key"; mv -f "$work/$name.crt" "$DST/$name.crt"
  changed=1; echo "instalado $name ($(days_left "$DST/$name.crt") dias)"
done

if [ "$changed" = 1 ] && [ "$STAGING" = 0 ]; then
  docker kill -s HUP "$GW_CONTAINER" >/dev/null 2>&1 && echo "SIGHUP enviado a $GW_CONTAINER" || echo "aviso: $GW_CONTAINER no esta en marcha; recargara al arrancar"
fi
