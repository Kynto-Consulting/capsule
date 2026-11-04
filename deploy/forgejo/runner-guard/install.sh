set -euo pipefail
CFG=/etc/forgejo-runner/config.yml
# 1) leave the host ~650 MB: the docker cgroup (all job containers) is capped well below the 1913 MB of the machine
sed -i 's|^\(\s*options:\s*\).*|\1"--memory=1200m --memory-swap=1700m --cpus=1.5 --pids-limit=1024 --security-opt=no-new-privileges"|' "$CFG"
grep -n "options:" "$CFG"
systemctl set-property docker.service MemoryHigh=1000M MemoryMax=1250M MemorySwapMax=700M
systemctl show docker.service -p MemoryHigh -p MemoryMax -p MemorySwapMax | tr '\n' ' '; echo
# protect the daemons that keep the machine reachable from the OOM killer and from page-cache starvation
for u in amazon-ssm-agent forgejo-runner sshd; do mkdir -p /etc/systemd/system/$u.service.d; printf '[Service]\nOOMScoreAdjust=-900\nMemoryLow=64M\n' > /etc/systemd/system/$u.service.d/protect.conf; done
# 2) watchdog: if the instance metadata service or DNS stays unreachable for 4 checks in a row (about 8 minutes) the machine is rebooted
cat > /usr/local/sbin/runner-watchdog.sh <<'EOS'
#!/bin/bash
STATE=/run/runner-watchdog.fails
ok=0
T=$(curl -s -m 5 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') && [ -n "$T" ] && \
  timeout 8 systemctl is-system-running >/dev/null 2>&1; rc=$?
# rc 0 = running, 1 = degraded (still alive); anything else (124 = timeout) = systemd unresponsive
if [ -n "${T:-}" ] && { [ $rc -eq 0 ] || [ $rc -eq 1 ]; }; then echo 0 > $STATE; exit 0; fi
n=$(( $(cat $STATE 2>/dev/null || echo 0) + 1 )); echo $n > $STATE
logger -t runner-watchdog "unreachable check $n/4 (imds token empty=$([ -z "${T:-}" ] && echo yes || echo no), systemd rc=$rc)"
if [ $n -ge 4 ]; then logger -t runner-watchdog "rebooting"; sync; echo b > /proc/sysrq-trigger; fi
EOS
chmod +x /usr/local/sbin/runner-watchdog.sh
printf '[Unit]\nDescription=Reboot the CI runner when it stops answering\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/runner-watchdog.sh\n' > /etc/systemd/system/runner-watchdog.service
printf '[Unit]\nDescription=Runner reachability watchdog\n[Timer]\nOnBootSec=10min\nOnUnitActiveSec=2min\nAccuracySec=10s\n[Install]\nWantedBy=timers.target\n' > /etc/systemd/system/runner-watchdog.timer
echo 1 > /proc/sys/kernel/sysrq
echo 'kernel.sysrq=1' > /etc/sysctl.d/90-runner-sysrq.conf
systemctl daemon-reload
systemctl enable --now runner-watchdog.timer >/dev/null 2>&1
systemctl restart forgejo-runner
sleep 3
echo "runner=$(systemctl is-active forgejo-runner) watchdog=$(systemctl is-active runner-watchdog.timer)"; free -m | sed -n 2,3p
