#!/usr/bin/env bash
# certs.sh : self-signed test CA + gateway cert (SANs for the interop names) + target PostgreSQL cert. Output in $W/certs.
set -euo pipefail
W=${W:-/tmp/capsule-interop}; D="$W/certs"; mkdir -p "$D"; cd "$D"
if [ ! -f ca.crt ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ca.key -out ca.crt -days 2 -subj "/CN=interop test CA" 2>/dev/null
fi
mk() { # name cn san
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$1.key" -out "$1.csr" -subj "/CN=$2" 2>/dev/null
  printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$3" > "$1.ext"
  openssl x509 -req -in "$1.csr" -CA ca.crt -CAkey ca.key -CAcreateserial -out "$1.crt" -days 2 -extfile "$1.ext" 2>/dev/null
}
[ -f gw.crt ] || mk gw tcp.interop.test "DNS:tcp.interop.test,DNS:udp.interop.test,DNS:*.db.interop.test,DNS:*.apps.interop.test,DNS:localhost"
[ -f gw2.crt ] || mk gw2 tcp.interop.test "DNS:tcp.interop.test,DNS:udp.interop.test,DNS:*.db.interop.test,DNS:*.apps.interop.test,DNS:localhost,DNS:rotated.interop.test"
[ -f target.crt ] || mk target pg.target.test "DNS:pg.target.test,DNS:localhost,IP:127.0.0.1"
chmod 644 *.crt; chmod 600 *.key
echo certs ok
