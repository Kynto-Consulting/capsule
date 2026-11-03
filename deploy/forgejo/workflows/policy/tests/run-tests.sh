#!/usr/bin/env bash
# Pruebas de lint-workflows.py: cada fixture de good/ debe pasar; cada de bad/ debe fallar con la regla
# que indica el prefijo de su nombre (REGLA o REGLA-variante). Ademas las plantillas reales deben pasar.
#   PYTHON=python3 bash run-tests.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINT="$HERE/../lint-workflows.py"
PY="${PYTHON:-python3}"
fail=0
for f in "$HERE"/good/*.yml; do
  if ! out=$("$PY" "$LINT" "$f" 2>&1); then echo "FALLA good: $f"; echo "$out"; fail=1; else echo "ok good $(basename "$f")"; fi
done
for f in "$HERE"/bad/*.yml; do
  b=$(basename "$f" .yml)
  case "$b" in
    PR-TARGET*) rule=PR-TARGET;; WRITE-ALL*) rule=WRITE-ALL;; CURL-PIPE*) rule=CURL-PIPE;;
    UNPINNED-USE*) rule=UNPINNED-USE;; RUNS-ON*) rule=RUNS-ON;; CAPSULE-CREDS*) rule=CAPSULE-CREDS;;
    *) echo "fixture sin regla: $b"; fail=1; continue;;
  esac
  out=$("$PY" "$LINT" "$f" 2>&1) && { echo "FALLA bad aceptado: $b"; fail=1; continue; }
  # debe contener SOLO la regla esperada
  others=$(echo "$out" | grep -o '\[[A-Z-]*\]' | grep -v "\[$rule\]" || true)
  if ! echo "$out" | grep -q "\[$rule\]"; then echo "FALLA $b: no reporta $rule"; echo "$out"; fail=1
  elif [ -n "$others" ]; then echo "FALLA $b: reglas inesperadas $others"; fail=1
  else echo "ok bad  $b -> $rule"; fi
done
# Las plantillas del propio paquete (solo el nivel superior) cumplen la politica.
ROOT="$HERE/../.."
if out=$("$PY" "$LINT" "$ROOT"/*.yml 2>&1); then echo "ok plantillas reales"; else echo "FALLA plantillas reales:"; echo "$out"; fail=1; fi
exit $fail
