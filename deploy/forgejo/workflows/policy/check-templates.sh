#!/usr/bin/env bash
# actionlint + yamllint + pruebas de la politica sobre cada plantilla (y sast/sast.yml, actions/deploy, actions/templates).
#   ACTIONLINT=/ruta/actionlint YAMLLINT=/ruta/yamllint PYTHON=python3 bash check-templates.sh
# La forma URL de 'uses: https://host/owner/repo@sha' es una extension de Forgejo que actionlint no conoce:
# ese unico mensaje se ignora; el resto de comprobaciones siguen activas.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
W="$HERE/.."; R="$W/../../.."
AL="${ACTIONLINT:-actionlint}"; YL="${YAMLLINT:-yamllint}"
files=("$W"/*.yml "$W/../sast/sast.yml" "$R/actions/deploy/action.yml" "$R/actions/templates/forgejo-ci-cd.yml")
rc=0
"$AL" -config-file "$W/actionlint.yaml" -ignore 'invalid format because owner and repo and ref should not be empty' "$W"/*.yml "$W/../sast/sast.yml" "$R/actions/templates/forgejo-ci-cd.yml" || rc=1
# action.yml no es un workflow: actionlint no lo analiza; se comprueba la sintaxis bash de cada run: y la politica.
"${PYTHON:-python3}" -I "$HERE/check-action-shell.py" "$R/actions/deploy/action.yml" || rc=1
"${PYTHON:-python3}" "$HERE/lint-workflows.py" "$R/actions/deploy/action.yml" || rc=1
"$YL" -c "$HERE/yamllint.yaml" "${files[@]}" || rc=1
PYTHON="${PYTHON:-python3}" bash "$HERE/tests/run-tests.sh" || rc=1
exit $rc
