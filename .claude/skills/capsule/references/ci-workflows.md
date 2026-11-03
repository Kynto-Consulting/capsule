# CI/CD, workflows, runs y logs

Hay dos mundos de CI; no los mezcles:

| | GitHub Actions | Forgejo Actions (Git Capsule) |
|---|---|---|
| Archivo | `.github/workflows/capsule.yml` | `.forgejo/workflows/*.yml` |
| Generador | `capsule ci init` | `capsule ci init --provider forgejo` y `capsule workflow new --template …` |
| Secretos | `capsule ci init --set-secrets` (usa `gh`) | `capsule ci secrets set …` (a mano) |
| Seguridad | CodeQL/Dependabot propios de GitHub | Semgrep + gitleaks + osv-scanner + trivy + Renovate (CodeQL y Dependabot **no existen** en Forgejo) |

Mantener las versiones de esas herramientas: skill `capsule-ci-maintenance`.

## Generar el pipeline de despliegue

```bash
capsule ci init --print                                   # solo ver; detecta el stack (node, node-pnpm, node-yarn, node-bun, go, python, other)
capsule ci init --stack node --working-directory apps/web # monorepo
capsule ci init --provider forgejo                        # ci.yml (compuertas) + deploy.yml
capsule ci init --set-secrets --org ORG --project PROJ    # GitHub: crea token deploy y sube secretos con gh
```

GitHub: tres jobs: `ci` (instala, lint, test y build solo lo que exista), `preview` (en PR; despliega a un proyecto
de preview si existe la variable `CAPSULE_PREVIEW_PROJECT_ID`, si no se omite) y `deploy` (push a la rama de
producción, tras `ci`). `--branch` cambia la rama; `--action-ref` fija la versión de la acción; `--force`
sobrescribe.

Forgejo: `ci.yml` trae las compuertas (gitleaks, lint/tipos/pruebas, semgrep, osv-scanner, trivy) con versiones
fijadas en `env:`. `deploy.yml` instala `@kyntocg/capsule-cli` (versión fijada) y ejecuta `capsule deploy`. No espera
a `ci`: protege la rama exigiendo los checks (ver `git-capsule.md`).

## Credenciales del pipeline (menor privilegio)

```bash
capsule tokens create --name ci-web --scope deploy --project <project-id>   # se muestra UNA vez; ir directo a un secreto
printf %s "$TOKEN" | capsule ci secrets set CAPSULE_TOKEN
printf %s "$ORG"   | capsule ci secrets set CAPSULE_ORG_ID
printf %s "$PROJ"  | capsule ci secrets set CAPSULE_PROJECT_ID
capsule ci variables set CAPSULE_API_URL --value https://api.tumi-ai.com    # no es secreto
```

Un token `deploy` solo puede: subir fuente, crear/leer/cancelar deployments, logs, hacer rollback, **leer** env
de su proyecto, crear/borrar previews, **leer** entornos y **pedir y consultar promociones** (no aprobarlas). Todo lo
demás da 403. Detalle: `permisos-tokens.md`.

## La acción de deploy (`kynto-consulting/capsule/actions/deploy`)

Entradas: `token`, `org-id`, `project-id`, `api-url`, `env` (K=V por línea, solo deploy), `secret-env` (igual pero
enmascarado en el log), `wait-healthy` (ruta p. ej. `/health`; falla si no responde 2xx), `timeout`,
`working-directory`, `version`, `cli-package` (p. ej. `./vendor/capsule-cli.tgz` si el CLI no está en npm),
`apps-domain`; con entornos: `environment`, `sha`, `from-environment`, `fail-on-pending`. Salidas: `url`,
`deployment-id`, `status`, `health`.

Con `environment:` la acción **no despliega directo**: ejecuta `capsule promote --to <entorno> --wait` y el servidor
aplica aprobaciones, ventanas y checks; es error combinarlo con `env`/`secret-env`. Si queda esperando
aprobación humana termina OK con `status=pending_approval` (o falla con `fail-on-pending: true`).
Otras acciones del repo: `actions/preview`, `actions/rollback`, `actions/vars`, `actions/wait-healthy`.

Plantillas listas en `deploy/forgejo/workflows/`: `ci-node|go|python`, `sast`, `gitleaks`, `trivy`, `deps`,
`security-audit`, `capsule-deploy` (con `vars.CAPSULE_ENVIRONMENT` usa promoción), `capsule-promote` (manual),
`workflow-policy` (lint obligatorio de `.forgejo/workflows/**`: prohíbe `pull_request_target`, `write-all`,
`curl | sh`, acciones sin fijar por SHA, `runs-on` no registrado).

## Workflows de calidad

```bash
capsule workflow new --template ci-node       # ci-node | sast | gitleaks | deploy | trivy ; --print para ver ; --force para sobrescribir
capsule workflow list
capsule workflow run ci.yml --ref main -f clave=valor --wait      # workflow_dispatch; el workflow debe declararlo
```

Escribe en `.forgejo/workflows/`. Reglas para lo que escribas: `permissions: contents: read`, acciones fijadas por
SHA de 40 hex, etiquetas de runner registradas (`ci`, `node22`, `ci-untrusted`), secretos solo vía `secrets.*`,
jamás `pull_request_target`, jamás montar `~/.capsule` ni credenciales de personas. Los jobs con secretos corren
solo en ramas protegidas.

## Runs y logs

```bash
capsule runs list --workflow ci.yml --branch main --status failure --event push
capsule runs view 123 [--job build]
capsule runs logs 123 --job build --follow       # los secretos salen enmascarados por el servidor
capsule runs watch 123 --exit-status [--wait 30m]  # exit 6 si no termina en éxito o se agota
capsule runs rerun 123 [--failed]
capsule runs cancel 123 -y
capsule runs artifacts 123
capsule ci runners                                # runners de la organización (solo lectura)
```

Estados de `--status`: `queued, running, success, failure, cancelled, waiting_approval`.
Límite conocido: jobs, logs, cancelar, re-ejecutar y artefactos dependen de una sesión web interna de Forgejo
(`CAPSULE_GIT_BOT_PASSWORD`, solo versiones listadas en `CAPSULE_GIT_WEB_VERSIONS`); si no está configurada
responden 501 `NOT_SUPPORTED` con el motivo. Díselo al usuario.

## Secretos y variables de Actions

`capsule ci secrets|variables list|set|delete [--org-wide]`. El valor de un secreto entra por stdin o `--from-env`,
nunca por argv. Forgejo no tiene secretos "de entorno": Capsule inyecta los del entorno solo en el paso de
despliegue (promoción), nunca en CI.

## Checks que publica Capsule

`capsule/preview`, `capsule/security`, `capsule/policy`, `capsule/env:<nombre>`, más los contextos de tus
workflows. Úsalos en `--checks` de la protección de rama.
