#!/bin/bash
# Prueba del script de apagado con un docker simulado (sin docker real ni apagado real).
# Uso: bash test.sh   (bash + coreutils; sirve en WSL, Git Bash o un contenedor Alpine con bash)
set -u
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail=0
ok() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (esperado '$3', obtenido '$2')"; fail=1; fi; }

cat > "$t/docker" <<'D'
#!/bin/bash
[ -e "$FAKE_DIR/down" ] && exit 1
[ -e "$FAKE_DIR/busy" ] && echo "abc123"
exit 0
D
chmod +x "$t/docker"
cat > "$t/poweroff" <<'P'
#!/bin/bash
touch "$FAKE_DIR/powered_off"
P
chmod +x "$t/poweroff"

run() { # $1 = uptime secs
  echo "$1.00 0.00" > "$t/uptime"
  FAKE_DIR="$t" DOCKER_CMD="$t/docker" POWEROFF_CMD="$t/poweroff" UPTIME_FILE="$t/uptime" \
    STATE_DIR="$t/state" DISABLED_FILE="$t/disabled" IDLE_MINUTES=3 GRACE_MINUTES=10 \
    bash "$here/idle-stop.sh" >/dev/null
}
off() { [ -e "$t/powered_off" ] && echo yes || echo no; }
cnt() { cat "$t/state/idle_minutes" 2>/dev/null || echo none; }

# 1. gracia: no cuenta ni apaga aunque este inactivo
for i in 1 2 3 4; do run 120; done
ok "gracia no apaga" "$(off)" no
ok "gracia contador 0" "$(cnt)" 0
# 2. inactivo tras la gracia: apaga al 3er minuto
run 700; run 760; ok "2 min no apaga" "$(off)" no; ok "contador 2" "$(cnt)" 2
run 820; ok "3 min apaga" "$(off)" yes
rm -f "$t/powered_off"; rm -rf "$t/state"
# 3. un job reinicia el contador
run 880; run 940; touch "$t/busy"; run 1000; rm "$t/busy"
ok "ocupado reinicia" "$(cnt)" 0
run 1060; run 1120; ok "tras reinicio no apaga" "$(off)" no
# 4. docker caido: nunca apaga
touch "$t/down"; for i in 1 2 3 4 5; do run 2000; done
ok "docker caido no apaga" "$(off)" no; rm "$t/down"
# 5. desactivado por archivo
touch "$t/disabled"; for i in 1 2 3 4 5; do run 3000; done
ok "desactivado no apaga" "$(off)" no; rm "$t/disabled"; rm -rf "$t/state"
# 6. tras gracia y sin jobs vuelve a apagar
run 4000; run 4060; run 4120; ok "reanuda y apaga" "$(off)" yes
exit $fail
