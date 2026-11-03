cd ~/gw; mkdir -p results; O=results/gw-mem.txt; : > $O
pkill -x gw; sleep 1
./gw -listen '[::]:8443' -routes routes.json -quiet 2>/dev/null &
sleep 2; P=$(pgrep -x gw)
rss(){ grep -E "VmRSS|Threads" /proc/$P/status | tr '\n' ' '; }
echo "gw base: $(rss) fds=$(ls /proc/$P/fd | wc -l)" | tee -a $O
for mode in "echo.test passthrough" "ssh-a.git.test terminate"; do set -- $mode
 for N in 500 2000; do
  ./bench -mode hold -addr 127.0.0.1:8443 -sni $1 -n $N -hold 8s > results/hold.tmp &
  sleep 6
  echo "$2 N=$N sni=$1: $(rss) fds=$(ls /proc/$P/fd | wc -l) cpu_ticks=$(awk '{print $14+$15}' /proc/$P/stat)" | tee -a $O
  wait %2 2>/dev/null; cat results/hold.tmp | tee -a $O; sleep 1
 done
done
echo "gw tras cerrar: $(rss) fds=$(ls /proc/$P/fd | wc -l)" | tee -a $O
