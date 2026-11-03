set -e
cd /mnt/d/Github/Kynto/capsule/test/interop
W=/tmp/capsule-interop; mkdir -p $W/run
cat > $W/run/tokens.env <<T
CAP_OK=cap_$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
CAP_OTHER=cap_$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
CAP_SCOPED=cap_$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9)
T
./reset_control.sh; ./seed.sh
. $W/run/tokens.env
A=http://localhost:18080/api/v1/orgs/00000000-0000-0000-0000-0000000000b1/projects/00000000-0000-0000-0000-0000000000c1/gateway
curl -s -H "Authorization: Bearer $CAP_OK" $A/services | head -c 700; echo
curl -s -X PATCH -H "Authorization: Bearer $CAP_OK" -H 'Content-Type: application/json' -d '{"gateway_enabled":true}' $A/services/pg | head -c 800; echo
curl -s -H "Authorization: Bearer $CAP_OK" $A/services/pg/connection-info | head -c 700; echo
curl -s -X POST -H "Authorization: Bearer $CAP_OK" $A/services/pg/connection-token | head -c 300; echo
curl -s -H "X-Gateway-Secret: interop-gw-secret-do-not-use" http://127.0.0.1:18080/internal/gateway/routes | head -c 1000
