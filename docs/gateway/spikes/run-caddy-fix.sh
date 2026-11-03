cd ~/gw; pkill -f "caddy-l4-linux run"; sleep 1
sed -i 's|"handle":\[{"handler":"tls"},{"handler":"proxy","upstreams":\[{"dial":\["127.0.0.1:911|"handle":[{"handler":"tls","connection_policies":[{"alpn":["postgresql"]}]},{"handler":"proxy","upstreams":[{"dial":["127.0.0.1:911|' caddy/l4.json
./caddy-l4-linux run --config caddy/l4.json > results/caddy.log 2>&1 & sleep 3
O=results/caddy-l4.txt; echo "== (b) reintento con connection_policies alpn postgresql en el handler tls (libpq 17+ manda ALPN postgresql tambien en modo clasico)" | tee -a $O
for n in pgt-a.db.test pgt-b.db.test; do timeout 15 ~/gwvenv/bin/python pgpy.py $n 18443; done | tee -a $O
echo "== memoria caddy-l4 con 2000 conexiones TLS ociosas (passthrough a.test)" | tee -a $O
P=$(pgrep -f "caddy-l4-linux run"); echo "base: $(grep VmRSS /proc/$P/status)" | tee -a $O
./bench -mode hold -addr 127.0.0.1:18443 -sni a.test -n 2000 -hold 8s > results/hold2.tmp & sleep 6
echo "N=2000: $(grep -E 'VmRSS' /proc/$P/status) fds=$(ls /proc/$P/fd | wc -l)" | tee -a $O; wait %2; cat results/hold2.tmp | tee -a $O
pkill -f "caddy-l4-linux run"; pkill backends; pkill -x gw
mkdir -p /mnt/d/Github/Kynto/capsule/docs/gateway/spikes/results; cp results/*.txt results/*.log results/run.out /mnt/d/Github/Kynto/capsule/docs/gateway/spikes/results/ 2>&1; cp caddy/l4.json /mnt/d/Github/Kynto/capsule/docs/gateway/spikes/caddy-l4.json; cp pgpy.py routes.json /mnt/d/Github/Kynto/capsule/docs/gateway/spikes/
ls results
