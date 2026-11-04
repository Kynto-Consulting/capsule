# Plantillas de workflows de Git Capsule (paquete B6)

Todas llevan `permissions: contents: read`, imagen de contenedor con version exacta y acciones fijadas por SHA de 40 hex
(`https://data.forgejo.org/actions/checkout@<sha>  # v4.2.2`). Etiquetas de runner registradas: `ci`, `node22` (confiables) y
`ci-untrusted` (`deploy/terraform/ci_untrusted.tf`).

| Plantilla | Que hace |
|---|---|
| `ci-node.yml`, `ci-go.yml`, `ci-python.yml` | Compuertas de tipos/lint/pruebas |
| `sast.yml` (copia en `../sast/sast.yml`), `gitleaks.yml`, `trivy.yml`, `deps.yml`, `terraform.yml`, `security-audit.yml`, `dependency-updates.yml` | Seguridad |
| `capsule-deploy.yml` | Despliegue en push a `main`; con `vars.CAPSULE_ENVIRONMENT` usa promocion |
| `capsule-promote.yml` | Promocion manual de un SHA a un entorno (`workflow_dispatch`) |
| `workflow-policy.yml` + `policy/lint-workflows.py` | Politica de workflows (SPEC 6.3), check requerido de `.forgejo/workflows/**` |

## Politica de workflows

Reglas: `PR-TARGET`, `WRITE-ALL`, `CURL-PIPE`, `UNPINNED-USE` (accion sin SHA o `docker://` sin digest), `RUNS-ON` (etiqueta no
registrada), `CAPSULE-CREDS`. El job exige que `lint-workflows.py` tenga el sha256 de la variable de ORGANIZACION
`WORKFLOW_POLICY_SHA256`, para que un PR no pueda debilitar el lint. Excepciones: `.forgejo/workflow-policy.allow` (`ruta:REGLA`), bajo CODEOWNERS.
Limite conocido: el analisis es por lineas (sin YAML completo); no ve construcciones generadas dinamicamente. Las imagenes de `container:` se fijan por
tag exacto; fijarlas por digest se delega en Renovate (`pinDigests`).

Pruebas: `bash policy/tests/run-tests.sh` (fixtures `good/` y `bad/`), `bash policy/check-templates.sh` (actionlint + yamllint + pruebas),
`policy/tests/run-real-runner*.sh` (Forgejo y forgejo-runner reales en Linux/WSL, etiqueta `host`, sin Docker).

## Notas de validacion en el runner real (probado con un proyecto de QA)

- Las plantillas de seguridad corren con el runner `ci` (2 GB, 1 job a la vez). Todas arrancan, y fallan donde deben: gitleaks (secreto en el historial), semgrep (reglas propias, falla con `SAST_FAIL_ON=high`),
  osv-scanner/`npm audit`/trivy fs (dependencia vulnerable), trivy imagen (CVE critico en la base de la imagen) y workflow-policy (4 violaciones en un workflow malo).
- Los clones usan `git init` + `git fetch --depth=1 <url> $GITHUB_SHA` + `checkout FETCH_HEAD`: con `clone --depth=1` + `checkout $GITHUB_SHA` fallaba en cualquier rama que no fuera la predeterminada.
- Las imagenes `python` y `kaniko` no traen node: ahi no sirve `actions/checkout`. El `wget` de busybox (kaniko-debug) no negocia TLS con `git.tumi-ai.com` (alert 47): el contexto de kaniko se descarga con
  `--context git://<host>/<repo>.git#<ref>#<sha>` y `GIT_USERNAME`/`GIT_PASSWORD`.
- osv-scanner: `scan source` es sintaxis de la v2 (en v1.9.2 se interpreta `source` como una carpeta). El binario esta en `/osv-scanner` (no esta en el PATH de la imagen).
- trivy: los binarios y los releases de GitHub de v0.58.1 ya no existen (aquasecurity retiro versiones antiguas); se fija 0.76.1. Al cambiar de version recalcula `TRIVY_LINUX64_SHA256`
  (`sha256sum trivy_<v>_Linux-64bit.tar.gz`).
- Forgejo 15 no tiene resumen de jobs (`GITHUB_STEP_SUMMARY` se descarta con una advertencia); `summarize.py` tambien escribe en el log.
- Solo `security-audit.yml` publica en la pestana Seguridad de Capsule (osv-scanner via `POST .../security/sarif`); gitleaks, semgrep, trivy y deps solo bloquean con su codigo de salida.

## Secretos de entorno

Forgejo no tiene secretos de entorno. Capsule los guarda y los inyecta solo al desplegar. `actions/deploy` con `environment:` ejecuta
`capsule promote --to <entorno> --wait` (politica, aprobaciones y ventanas en el servidor) y rechaza combinarlo con `env`/`secret-env`.
Los jobs con secretos del repo (`capsule-deploy.yml`) corren solo en `push` a `main`.

## Acciones: DEFAULT_ACTIONS_URL y politica

Las acciones sin URL completa se resuelven contra `[actions] DEFAULT_ACTIONS_URL`. Fijalo a `https://data.forgejo.org` (o a un espejo propio)
en la configuracion de Forgejo (el compose lo posee el paquete A3, no se toco aqui). Verificado: Forgejo 15.0.11 acepta la clave y el
runner reporta `https://data.forgejo.org` como URL por defecto. Los SHA de `actions/checkout`, `setup-node`, `setup-go` y `setup-python`
coinciden entre data.forgejo.org y github.com (`git ls-remote`); Renovate los actualiza.

## Artefactos y cache

(?) No verificado de extremo a extremo: el servidor 15.0.11 inicializa el almacenamiento `actions_artifacts` (local), pero el WSL de pruebas no tiene
node, asi que no se pudo ejecutar `upload-artifact` ni `cache`. Mientras no se pruebe en el runner de produccion, rige SPEC 5.6: artefactos
14 dias en S3 y cache local del runner. Las plantillas no usan artefactos ni cache de acciones.
