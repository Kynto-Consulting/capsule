cd /mnt/d/Github/Kynto/capsule/test/interop
W=/tmp/capsule-interop; . $W/run/tokens.env
./gateway.sh stop >/dev/null; ./gateway.sh start
export CAPSULE_GATEWAY_CA_FILE=$W/certs/ca.crt PGPASSWORD=app-pass-1 CAPSULE_GATEWAY_TOKEN=$CAP_OK
echo "--- capsule connect exec psql v4"
./bin/capsule connect "capsule://shop/pg?gateway=127.0.0.1:18443&sni=tcp.interop.test" --exec -- psql "sslmode=require user=app dbname=app" -Atc "select v from blob" ; echo "exit=$?"
echo "--- v6"
./bin/capsule connect "capsule://shop/pg?gateway=%5B::1%5D:18443&sni=tcp.interop.test" --exec -- psql "sslmode=require user=app dbname=app" -Atc "select v from blob" ; echo "exit=$?"
echo "--- bad token"
CAPSULE_GATEWAY_TOKEN=cap_nonsense12345678 ./bin/capsule connect "capsule://shop/pg?gateway=127.0.0.1:18443&sni=tcp.interop.test" --exec -- psql "sslmode=require user=app dbname=app" -Atc "select 1"; echo "exit=$?"
echo "--- psql SNI classic"
psql "host=pg-shop.db.interop.test hostaddr=127.0.0.1 port=18443 sslmode=require user=app dbname=app" -Atc "select v from blob"; echo "exit=$?"
echo "--- psql SNI direct"
psql "host=pg-shop.db.interop.test hostaddr=::1 port=18443 sslmode=require sslnegotiation=direct user=app dbname=app" -Atc "select v from blob"; echo "exit=$?"
tail -5 $W/gateway.log | cut -c1-300
