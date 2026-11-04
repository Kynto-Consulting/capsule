#!/bin/bash
# Instala el apagado por inactividad en el runner. Idempotente; NO reinicia forgejo-runner
# ni docker ni toca .runner. Pensado para AWS Systems Manager Run Command:
#
#   aws ssm send-command --instance-ids i-03e3e8ad27d3d8d85 \
#     --document-name AWS-RunShellScript --parameters file://ssm-params.json
#
# donde ssm-params.json lleva en "commands" el contenido de este directorio (ver README.md
# de este directorio: lo genera `make-ssm-params.sh`). Tambien lo usa el user_data de runner.tf.
#
# Variables opcionales: IDLE_MINUTES (15), GRACE_MINUTES (10). Reversa:
#   touch /etc/forgejo-runner/idle-stop.disabled      (o: systemctl disable --now forgejo-runner-idle-stop.timer)
set -euo pipefail
# forgejo-runner ejecuta git en el host (actions/checkout); sin git todo job falla. Idempotente.
command -v git >/dev/null 2>&1 || dnf install -y git
IDLE_MINUTES="${IDLE_MINUTES:-15}"
GRACE_MINUTES="${GRACE_MINUTES:-10}"
mkdir -p /etc/forgejo-runner
cat > /etc/forgejo-runner/idle-stop.env <<ENV
IDLE_MINUTES=$IDLE_MINUTES
GRACE_MINUTES=$GRACE_MINUTES
ENV
cat > /usr/local/sbin/forgejo-runner-idle-stop.sh <<'SCRIPT_EOF'
#!/bin/bash
# Apaga el runner de CI cuando lleva N minutos seguidos sin jobs. Lo ejecuta
# forgejo-runner-idle-stop.timer cada minuto. Un apagado iniciado por la instancia
# la deja en estado `stopped` (EBS-backed): no hace falta ningun permiso IAM.
#
# Variables (de /etc/forgejo-runner/idle-stop.env; los nombres de abajo en
# *_CMD/*_FILE/STATE_DIR existen para las pruebas):
#   IDLE_MINUTES   minutos consecutivos sin jobs antes de apagar (15)
#   GRACE_MINUTES  minutos desde el boot en los que nunca se apaga (10)
#   DOCKER_CMD     comando docker (docker)
#   POWEROFF_CMD   comando de apagado (systemctl poweroff)
# Desactivar sin reinstalar: touch /etc/forgejo-runner/idle-stop.disabled
set -u

IDLE_MINUTES="${IDLE_MINUTES:-15}"
GRACE_MINUTES="${GRACE_MINUTES:-10}"
DOCKER_CMD="${DOCKER_CMD:-docker}"
POWEROFF_CMD="${POWEROFF_CMD:-systemctl poweroff}"
UPTIME_FILE="${UPTIME_FILE:-/proc/uptime}"
STATE_DIR="${STATE_DIR:-/run/forgejo-runner-idle-stop}"
DISABLED_FILE="${DISABLED_FILE:-/etc/forgejo-runner/idle-stop.disabled}"
COUNTER="$STATE_DIR/idle_minutes"

log() { echo "idle-stop: $*"; }

mkdir -p "$STATE_DIR"

if [ -e "$DISABLED_FILE" ]; then
  echo 0 > "$COUNTER"
  log "desactivado por $DISABLED_FILE"
  exit 0
fi

case "$IDLE_MINUTES$GRACE_MINUTES" in
  *[!0-9]*|"") log "IDLE_MINUTES/GRACE_MINUTES invalidos; no se apaga"; exit 0 ;;
esac

up=$(cut -d' ' -f1 "$UPTIME_FILE" 2>/dev/null | cut -d. -f1)
up="${up:-0}"
if [ "$up" -lt $((GRACE_MINUTES * 60)) ]; then
  echo 0 > "$COUNTER"
  log "periodo de gracia (uptime ${up}s < ${GRACE_MINUTES}m)"
  exit 0
fi

# Un job de Forgejo corre en contenedores GITEA-ACTIONS-TASK-* / FORGEJO-ACTIONS-TASK-*
# (y sus servicios). El runner es el unico usuario de docker en esta maquina, asi que
# CUALQUIER contenedor en ejecucion cuenta como actividad. Si docker no responde no se
# puede saber: se asume ocupado y nunca se apaga.
if ! running=$($DOCKER_CMD ps -q 2>/dev/null); then
  echo 0 > "$COUNTER"
  log "docker no responde; se asume ocupado"
  exit 0
fi
if [ -n "$running" ]; then
  echo 0 > "$COUNTER"
  log "ocupado ($(echo "$running" | wc -l | tr -d ' ') contenedores)"
  exit 0
fi

n=$(cat "$COUNTER" 2>/dev/null || echo 0)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))
echo "$n" > "$COUNTER"
log "inactivo ${n}/${IDLE_MINUTES} min"
if [ "$n" -ge "$IDLE_MINUTES" ]; then
  log "apagando"
  $POWEROFF_CMD
fi
exit 0
SCRIPT_EOF
chmod 755 /usr/local/sbin/forgejo-runner-idle-stop.sh
cat > /etc/systemd/system/forgejo-runner-idle-stop.service <<'UNIT_EOF'
[Unit]
Description=Apaga el runner de CI si lleva N minutos sin jobs
After=docker.service

[Service]
Type=oneshot
EnvironmentFile=-/etc/forgejo-runner/idle-stop.env
ExecStart=/usr/local/sbin/forgejo-runner-idle-stop.sh
UNIT_EOF
cat > /etc/systemd/system/forgejo-runner-idle-stop.timer <<'UNIT_EOF'
[Unit]
Description=Revisa cada minuto si el runner de CI esta inactivo

[Timer]
OnBootSec=60
OnUnitActiveSec=60
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT_EOF
systemctl daemon-reload
systemctl enable --now forgejo-runner-idle-stop.timer
systemctl list-timers forgejo-runner-idle-stop.timer --no-pager
