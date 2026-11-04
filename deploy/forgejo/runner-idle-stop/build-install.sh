#!/bin/bash
# Regenera install.sh (autocontenido, para SSM) a partir de idle-stop.sh y las unidades.
set -euo pipefail
cd "$(dirname "$0")"
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    @@IDLE_STOP_SH@@) cat idle-stop.sh ;;
    @@SERVICE@@) cat forgejo-runner-idle-stop.service ;;
    @@TIMER@@) cat forgejo-runner-idle-stop.timer ;;
    *) printf '%s\n' "$line" ;;
  esac
done < install.sh.in > install.sh
chmod +x install.sh
