#!/bin/bash
# Mueve el SSH de ADMINISTRACION del servidor del puerto 22 al 2200 sin riesgo de quedarte fuera.
# El 22 pasa a ser el SSH publico de Forgejo (docker-compose.prod.yml). NO se ejecuta solo: corre cada fase a mano.
#
# Uso (en el servidor, como root/sudo, con la sesion SSH actual ABIERTA todo el tiempo):
#   sudo ./move-admin-ssh.sh add       fase 2: sshd escucha en 22 Y 2200 (valida con sshd -t)
#   (desde OTRA terminal tuya)         fase 3: ssh -p 2200 -i <llave> ec2-user@<IP>   -> debe entrar
#   sudo ./move-admin-ssh.sh finish    fase 4: quita Port 22 y recarga (pide confirmar)
#   sudo ./move-admin-ssh.sh rollback  reversa: restaura el sshd_config guardado
# Fase 1 (antes): abrir 2200 en el SG:  terraform apply -var git_enabled=true -target=aws_security_group_rule.git_admin_ssh
set -euo pipefail
CFG=/etc/ssh/sshd_config
BAK=/etc/ssh/sshd_config.pre-2200
NEWPORT=2200

need_root() { [ "$(id -u)" -eq 0 ] || { echo "ejecutar con sudo" >&2; exit 1; }; }
reload() { sshd -t && systemctl reload sshd; }

selinux_port() {
  # AL2023 suele ir sin SELinux enforcing; si lo esta, sshd no podra enlazar 2200 sin esto.
  if command -v getenforce >/dev/null && [ "$(getenforce)" = "Enforcing" ]; then
    command -v semanage >/dev/null || dnf install -y policycoreutils-python-utils
    semanage port -l | grep -q "ssh_port_t.*\b$NEWPORT\b" || semanage port -a -t ssh_port_t -p tcp "$NEWPORT"
  fi
}

case "${1:-}" in
  add)
    need_root
    [ -f "$BAK" ] || cp -p "$CFG" "$BAK"
    selinux_port
    # Quita lineas Port previas y declara explicitamente ambos puertos.
    sed -i -E '/^[[:space:]]*Port[[:space:]]+[0-9]+/d' "$CFG"
    printf 'Port 22\nPort %s\n' "$NEWPORT" >> "$CFG"
    # Autenticacion solo por llave en el puerto expuesto.
    grep -qE '^[[:space:]]*PasswordAuthentication[[:space:]]+no' "$CFG" || echo "AVISO: PasswordAuthentication no esta en 'no'; ponlo antes de abrir 2200 al mundo."
    sshd -t
    reload
    ss -ltnp | grep -E ":(22|$NEWPORT)\b" || true
    echo "Ahora prueba desde OTRA terminal: ssh -p $NEWPORT ... . No cierres esta sesion."
    ;;
  finish)
    need_root
    read -r -p "Confirmaste que 'ssh -p $NEWPORT' entra desde otra sesion? (escribe si) " ans
    [ "$ans" = "si" ] || { echo "cancelado"; exit 1; }
    sed -i -E '/^[[:space:]]*Port[[:space:]]+22[[:space:]]*$/d' "$CFG"
    sshd -t
    reload
    echo "Listo: sshd solo en $NEWPORT. El 22 queda libre para Forgejo: docker compose -f docker-compose.prod.yml up -d git"
    ;;
  rollback)
    need_root
    [ -f "$BAK" ] || { echo "no hay copia $BAK" >&2; exit 1; }
    cp -p "$BAK" "$CFG"
    sshd -t
    reload
    echo "sshd restaurado (solo el puerto original)."
    ;;
  *) echo "uso: $0 add|finish|rollback" >&2; exit 2 ;;
esac
