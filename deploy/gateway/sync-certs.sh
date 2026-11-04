#!/bin/bash
# Copia el certificado de tcp.apps que emite Caddy (contenedor capsule-git-proxy) al directorio que lee el gateway y le envia SIGHUP
# si cambio. Fase 1 (hasta el comodin DNS-01 de la fase 2). Ejecutar como root: a mano o por cron (deploy/gateway/gateway-certs.cron).
set -euo pipefail
ZONE="${CAPSULE_GW_ZONE:-tumi-ai.com}"; HOST="tcp.apps.$ZONE"
SRC="/data/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$HOST"
DST=/opt/capsule/gateway/certs; UID_GW="${GW_UID:-65532}"
mkdir -p "$DST"; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
docker cp "capsule-git-proxy:$SRC/$HOST.crt" "$tmp/tls.crt" 2>/dev/null || { echo "sin certificado todavia para $HOST"; exit 1; }
docker cp "capsule-git-proxy:$SRC/$HOST.key" "$tmp/tls.key"
if [ -f "$DST/$HOST.crt" ] && cmp -s "$tmp/tls.crt" "$DST/$HOST.crt"; then echo "sin cambios"; exit 0; fi
install -m 0644 -o "$UID_GW" -g "$UID_GW" "$tmp/tls.crt" "$DST/$HOST.crt"
install -m 0600 -o "$UID_GW" -g "$UID_GW" "$tmp/tls.key" "$DST/$HOST.key"
docker kill -s HUP capsule-gateway >/dev/null 2>&1 || true
echo "certificado de $HOST actualizado"
