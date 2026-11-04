#!/bin/bash
# Imprime el JSON de parametros de AWS-RunShellScript con install.sh como unico comando.
# Uso: bash make-ssm-params.sh > ssm-params.json
set -euo pipefail
cd "$(dirname "$0")"
bs=$(printf '\')
printf '{"commands":["'
tr -d '\r' < install.sh | sed -e "s/[$bs]/$bs$bs$bs$bs/g" -e 's/"/'"$bs$bs"'"/g' -e "s/	/${bs}t/g" | awk -v nl="${bs}${bs}n" 'NR>1{printf "%s", nl} {printf "%s",$0}'
printf '"]}\n'
