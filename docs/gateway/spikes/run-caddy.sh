cd ~/gw; O=results/caddy-l4.txt; : > $O; mkdir -p caddy
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout caddy/k.pem -out caddy/c.pem -days 2 -subj "/CN=gw" -addext "subjectAltName=DNS:*.db.test,DNS:*.git.test" 2>/dev/null
cat > caddy/l4.json <<'J'
{"admin":{"disabled":true},
 "apps":{
  "tls":{"certificates":{"load_files":[{"certificate":"/home/arubik/gw/caddy/c.pem","key":"/home/arubik/gw/caddy/k.pem"}]}},
  "layer4":{"servers":{"s1":{"listen":[":18443"],"routes":[
   {"match":[{"tls":{"sni":["a.test"]}}],"handle":[{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9001"]}]}]},
   {"match":[{"tls":{"sni":["b.test"]}}],"handle":[{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9002"]}]}]},
   {"match":[{"tls":{"sni":["pgd.db.test"],"alpn":["postgresql"]}}],"handle":[{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9103"]}]}]},
   {"match":[{"tls":{"sni":["ssh-a.git.test"]}}],"handle":[{"handler":"tls"},{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9201"]}]}]},
   {"match":[{"tls":{"sni":["ssh-b.git.test"]}}],"handle":[{"handler":"tls"},{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9202"]}]}]},
   {"match":[{"postgres":{}}],"handle":[{"handler":"postgres_tls"},{"handler":"subroute","routes":[
      {"match":[{"tls":{"sni":["pgt-a.db.test"]}}],"handle":[{"handler":"tls"},{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9111"]}]}]},
      {"match":[{"tls":{"sni":["pgt-b.db.test"]}}],"handle":[{"handler":"tls"},{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9112"]}]}]},
      {"match":[{"tls":{"sni":["pg-a.db.test"]}}],"handle":[{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:9101"]}]}]}
   ]}]}
  ]}}}}}
J
./caddy-l4-linux run --config caddy/l4.json > results/caddy.log 2>&1 &
sleep 3; echo "caddy: $(./caddy-l4-linux version)" | tee -a $O
echo "== (a) SNI -> 2 backends TLS en el mismo puerto 18443 (passthrough)" | tee -a $O
for n in a.test b.test; do echo -n "$n -> "; echo | openssl s_client -connect 127.0.0.1:18443 -servername $n 2>/dev/null | grep subject=; done | tee -a $O
echo -n "IPv6 [::1]:18443 a.test -> " | tee -a $O; echo | openssl s_client -connect '[::1]:18443' -servername a.test 2>/dev/null | grep subject= | tee -a $O
echo "== (c) SSH sobre TLS+SNI via Caddy (tls handler termina; proxy a sshd plano)" | tee -a $O
SSHO="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o PreferredAuthentications=none"
for n in ssh-a.git.test ssh-b.git.test; do echo -n "$n -> "; ssh $SSHO -o "ProxyCommand=openssl s_client -quiet -connect 127.0.0.1:18443 -servername $n 2>/dev/null" u@x whoami 2>&1 | head -1; done | tee -a $O
echo "== (b) PostgreSQL via Caddy l4: libpq 18 real" | tee -a $O
for n in pgt-a.db.test pgt-b.db.test pg-a.db.test; do ~/gwvenv/bin/python pgpy.py $n 18443; done | tee -a $O
echo "libpq sslnegotiation=direct pgd.db.test:" | tee -a $O; ~/gwvenv/bin/python pgpy.py pgd.db.test 18443 sslnegotiation=direct | tee -a $O
echo "openssl -starttls postgres -servername pgt-a:" | tee -a $O; echo | openssl s_client -starttls postgres -connect 127.0.0.1:18443 -servername pgt-a.db.test 2>/dev/null | grep subject= | tee -a $O
echo "== memoria caddy-l4 con 2000 conexiones TLS ociosas (passthrough a.test)" | tee -a $O
P=$(pgrep -f "caddy-l4-linux run"); echo "base: $(grep VmRSS /proc/$P/status)" | tee -a $O
./bench -mode hold -addr 127.0.0.1:18443 -sni a.test -n 2000 -hold 8s > results/hold2.tmp & sleep 6
echo "N=2000: $(grep -E 'VmRSS' /proc/$P/status) fds=$(ls /proc/$P/fd | wc -l)" | tee -a $O; wait %2; cat results/hold2.tmp | tee -a $O
pkill -f "caddy-l4-linux run"
