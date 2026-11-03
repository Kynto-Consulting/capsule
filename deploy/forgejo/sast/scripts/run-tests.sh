#!/bin/bash
# Ejecuta las pruebas de las reglas propias (# ruleid: / # ok:). Requiere semgrep instalado (pip install semgrep==1.183.0).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v semgrep >/dev/null || { echo "semgrep no esta instalado" >&2; exit 1; }
# 1) Las reglas son YAML valido y semgrep las acepta
semgrep --validate --config rules/ --metrics=off
# 2) Pruebas ruleid/ok
semgrep --test --config rules/ tests/ --metrics=off
