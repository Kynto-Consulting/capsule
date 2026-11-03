#!/usr/bin/env bash
# Experimentos (b)(c)(d)(e)(f) + IPv6 con el gateway propio (cmd/gw). Se ejecuta en WSL Ubuntu desde ~/gw (binarios linux compilados
# con GOOS=linux go build ./cmd/...). Salida: results/gw-*.txt
set -u
cd ~/gw
OUT=~/gw/results; mkdir -p $OUT
pkill -f "gw/(backends|gw|ct)" 2>/dev/null; sleep 0.5
cat > routes.json <<'EOF'
{"routes":[
 {"sni":"a.test","mode":"passthrough","backend":"127.0.0.1:9001"},
 {"sni":"b.test","mode":"passthrough","backend":"127.0.0.1:9002"},
 {"sni":"pg-a.db.test","mode":"passthrough","backend":"127.0.0.1:9101"},
 {"sni":"pg-b.db.test","mode":"passthrough","backend":"127.0.0.1:9102"},
 {"sni":"pgd.db.test","mode":"passthrough","backend":"127.0.0.1:9103"},
 {"sni":"pgt-a.db.test","mode":"terminate","backend":"127.0.0.1:9111"},
 {"sni":"pgt-b.db.test","mode":"terminate","backend":"127.0.0.1:9112"},
 {"sni":"ssh-a.git.test","mode":"terminate","backend":"127.0.0.1:9201"},
 {"sni":"ssh-b.git.test","mode":"terminate","backend":"127.0.0.1:9202"},
 {"sni":"echo.test","mode":"passthrough","backend":"127.0.0.1:9301"}
],"tokens":{"tok1":["127.0.0.1:9302","127.0.0.1:9303","127.0.0.1:9201","127.0.0.1:9304"]}}
EOF
./backends tls:A:127.0.0.1:9001 tls:B:127.0.0.1:9002 pg:A:127.0.0.1:9101:ssl pg:B:127.0.0.1:9102:ssl pg:D:127.0.0.1:9103:direct \
  pg:TA:127.0.0.1:9111:plain pg:TB:127.0.0.1:9112:plain ssh:A:127.0.0.1:9201 ssh:B:127.0.0.1:9202 \
  tlsecho:E:127.0.0.1:9301 echo:_:127.0.0.1:9302 sink:_:127.0.0.1:9303 udpecho:_:127.0.0.1:9304 tlsecho:E2:127.0.0.1:9305 > $OUT/backends.log 2>&1 &
./gw -listen '[::]:8443' -routes routes.json > $OUT/gw.log 2>&1 &
sleep 2

echo "== (b0) TLS por SNI, mismo puerto 8443, dos backends (openssl s_client -servername)" | tee $OUT/gw-tls-sni.txt
for n in a.test b.test; do
  echo -n "$n -> "; echo | openssl s_client -connect 127.0.0.1:8443 -servername $n 2>/dev/null | grep -E "hello-from|subject=" | tr '\n' ' '; echo
done | tee -a $OUT/gw-tls-sni.txt
echo -n "desconocido.test (sin ruta) -> " | tee -a $OUT/gw-tls-sni.txt
(echo | timeout 5 openssl s_client -connect 127.0.0.1:8443 -servername desconocido.test 2>&1 | grep -cE "hello-from|BEGIN CERT") | tee -a $OUT/gw-tls-sni.txt

echo "== (b1) openssl -starttls postgres con -servername (SSLRequest + TLS, passthrough con replay del SSLRequest)" | tee $OUT/gw-pg.txt
for n in pg-a.db.test pg-b.db.test; do
  echo -n "$n -> " ; echo | openssl s_client -starttls postgres -connect 127.0.0.1:8443 -servername $n 2>/dev/null | grep -E "subject=" | tr '\n' ' '; echo
done | tee -a $OUT/gw-pg.txt
echo "== (b2) pgx (cliente Go real; ServerName=host), sslmode=require" | tee -a $OUT/gw-pg.txt
for n in pg-a.db.test pg-b.db.test pgt-a.db.test pgt-b.db.test; do ./pgclient $n 8443 require; done | tee -a $OUT/gw-pg.txt
echo "== (b3) libpq real (psycopg 3 binary, libpq 18.x) via hostaddr, sslmode=require, sslsni=1 (por defecto)" | tee -a $OUT/gw-pg.txt
cat > pgpy.py <<'EOF'
import psycopg, sys
host, port, extra = sys.argv[1], sys.argv[2], sys.argv[3:]
kw = dict(host=host, hostaddr="127.0.0.1", port=port, user="u", dbname="d", password="p", sslmode="require", connect_timeout=5)
for e in extra:
    k, v = e.split("=", 1); kw[k] = v
try:
    psycopg.connect(**kw)
except Exception as ex:
    print("libpq", psycopg.pq.version(), host, extra, "->", str(ex).strip().replace("\n", " | "))
EOF
for n in pg-a.db.test pg-b.db.test pgt-a.db.test pgt-b.db.test; do ~/gwvenv/bin/python pgpy.py $n 8443; done | tee -a $OUT/gw-pg.txt
echo "== (b4) libpq 17+ sslnegotiation=direct (ALPN postgresql, sin SSLRequest)" | tee -a $OUT/gw-pg.txt
~/gwvenv/bin/python pgpy.py pgd.db.test 8443 sslnegotiation=direct | tee -a $OUT/gw-pg.txt
echo "== (b5) libpq sslsni=0 (sin SNI): el gateway no puede enrutar" | tee -a $OUT/gw-pg.txt
~/gwvenv/bin/python pgpy.py pg-a.db.test 8443 sslsni=0 | tee -a $OUT/gw-pg.txt

echo "== (c) SSH sobre TLS+SNI con ProxyCommand estandar (OpenSSH $(ssh -V 2>&1)), 2 servidores en el mismo puerto" | tee $OUT/gw-ssh.txt
SSHO="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o PreferredAuthentications=none"
for n in ssh-a.git.test ssh-b.git.test; do
  echo -n "$n (openssl s_client -quiet) -> "
  ssh $SSHO -o "ProxyCommand=openssl s_client -quiet -connect 127.0.0.1:8443 -servername $n 2>/dev/null" u@$n whoami 2>&1 | head -2
done | tee -a $OUT/gw-ssh.txt
echo -n "ssh-a por 'capsule tunnel' stdio (ct) con token -> " | tee -a $OUT/gw-ssh.txt
ssh $SSHO -o "ProxyCommand=./ct -gw 127.0.0.1:8443 -token tok1 -target 127.0.0.1:9201" u@x whoami 2>&1 | head -2 | tee -a $OUT/gw-ssh.txt
echo -n "ct con token invalido -> " | tee -a $OUT/gw-ssh.txt
./ct -gw 127.0.0.1:8443 -token malo -target 127.0.0.1:9201 2>&1 </dev/null | head -1 | tee -a $OUT/gw-ssh.txt

echo "== (e) UDP sobre el tunel TLS (trama len16+datos), eco UDP" | tee $OUT/gw-udp.txt
./ct -gw 127.0.0.1:8443 -token tok1 -target 127.0.0.1:9304 -proto udp -listen 127.0.0.1:9400 &
sleep 1
~/gwvenv/bin/python - <<'EOF' | tee -a $OUT/gw-udp.txt
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(2)
ts = []
for i in range(1000):
    t = time.perf_counter(); s.sendto(b"ping%d" % i, ("127.0.0.1", 9400)); d, _ = s.recvfrom(100); ts.append(time.perf_counter() - t)
    assert d == b"ping%d" % i
ts.sort(); print("UDP eco por tunel: 1000/1000 ok, rtt p50=%.0fus p99=%.0fus" % (ts[500]*1e6, ts[990]*1e6))
EOF
pkill -f "ct -gw.*-proto udp"

echo "== (d) latencia y throughput (TLS extremo a extremo: directo vs gateway passthrough; tunel TCP plano)" | tee $OUT/gw-bench.txt
echo -n "directo TLS echo      : " | tee -a $OUT/gw-bench.txt; ./bench -mode lat -addr 127.0.0.1:9301 -sni echo.test -n 5000 | tee -a $OUT/gw-bench.txt
echo -n "gateway passthrough   : " | tee -a $OUT/gw-bench.txt; ./bench -mode lat -addr 127.0.0.1:8443 -sni echo.test -n 5000 | tee -a $OUT/gw-bench.txt
echo -n "directo TCP echo      : " | tee -a $OUT/gw-bench.txt; ./bench -mode lat -addr 127.0.0.1:9302 -n 5000 | tee -a $OUT/gw-bench.txt
./ct -gw 127.0.0.1:8443 -token tok1 -target 127.0.0.1:9302 -listen 127.0.0.1:9401 2>/dev/null &
./ct -gw 127.0.0.1:8443 -token tok1 -target 127.0.0.1:9303 -listen 127.0.0.1:9402 2>/dev/null &
sleep 1
echo -n "tunel (ct) TCP echo   : " | tee -a $OUT/gw-bench.txt; ./bench -mode lat -addr 127.0.0.1:9401 -n 5000 | tee -a $OUT/gw-bench.txt
echo -n "directo TCP sink      : " | tee -a $OUT/gw-bench.txt; ./bench -mode thr -addr 127.0.0.1:9303 -mb 1024 | tee -a $OUT/gw-bench.txt
echo -n "tunel (ct) TCP sink   : " | tee -a $OUT/gw-bench.txt; timeout 60 ./bench -mode thr -addr 127.0.0.1:9402 -mb 1024 | tee -a $OUT/gw-bench.txt
pkill -f "ct -gw"

echo "== IPv6: gateway en [::] (doble pila); clientes por ::1 y 127.0.0.1" | tee $OUT/gw-ipv6.txt
ip -6 addr show lo 2>&1 | head -3 | tee -a $OUT/gw-ipv6.txt
ss -ltn | grep 8443 | tee -a $OUT/gw-ipv6.txt
for h in '[::1]' 127.0.0.1; do
  echo -n "openssl a.test via $h -> " | tee -a $OUT/gw-ipv6.txt
  echo | openssl s_client -connect $h:8443 -servername a.test 2>/dev/null | grep -E "subject=" | tee -a $OUT/gw-ipv6.txt
done
echo -n "pgx via ::1 -> " | tee -a $OUT/gw-ipv6.txt; ./pgclient pg-a.db.test 8443 require ::1 | tee -a $OUT/gw-ipv6.txt
echo -n "ssh ProxyCommand via ::1 -> " | tee -a $OUT/gw-ipv6.txt
ssh $SSHO -o "ProxyCommand=openssl s_client -quiet -connect [::1]:8443 -servername ssh-b.git.test 2>/dev/null" u@x whoami 2>&1 | head -1 | tee -a $OUT/gw-ipv6.txt
echo -n "ct via [::1] -> " | tee -a $OUT/gw-ipv6.txt
ssh $SSHO -o "ProxyCommand=./ct -gw [::1]:8443 -token tok1 -target 127.0.0.1:9201" u@x whoami 2>&1 | head -1 | tee -a $OUT/gw-ipv6.txt

echo "== recarga de rutas sin reiniciar (plano de control): se anade c.test y se prueba antes/despues" | tee $OUT/gw-reload.txt
./backends tls:C:127.0.0.1:9003 >/dev/null 2>&1 &
echo -n "antes: " | tee -a $OUT/gw-reload.txt; (echo | timeout 3 openssl s_client -connect 127.0.0.1:8443 -servername c.test 2>/dev/null | grep -c "subject=CN=C") | tee -a $OUT/gw-reload.txt
python3 - <<'EOF'
import json; t = json.load(open("routes.json")); t["routes"].append({"sni":"c.test","mode":"passthrough","backend":"127.0.0.1:9003"}); json.dump(t, open("routes.json","w"))
EOF
sleep 2.5
echo -n "despues (<=1s de refresco): " | tee -a $OUT/gw-reload.txt; echo | openssl s_client -connect 127.0.0.1:8443 -servername c.test 2>/dev/null | grep "subject=" | tee -a $OUT/gw-reload.txt

