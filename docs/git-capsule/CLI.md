# Git Capsule: CLI

Cada comando referencia un `operationId` de `API.openapi.yaml`. Convenciones heredadas del CLI actual (V, `cli/README.md`, `docs/AGENT_PROMPT.md`, `cli/cmd/capsule/gitcmd.go`): contexto por `.capsule.json` (`org_id`, `project_id`) o flags `--org/--project`; variables `CAPSULE_TOKEN`, `CAPSULE_API_URL`, `CAPSULE_ORG_ID`, `CAPSULE_PROJECT_ID`; IDs cortos de 8 caracteres aceptados en subrecursos; `-y` omite confirmaciones; 404/501 de una función = el servidor aún no la soporta (el CLI lo dice y no improvisa).

## 1. Convivencia con lo que ya se está construyendo

Ya existentes o en construcción por el agente del CLI (V al leer `gitcmd.go`, `portsbackups.go`, `oauthmembers.go`): `git link|show|remote|unlink|test|repo|branches|commits|pulls|previews list|create|delete`, `members list|set|remove`, `org access-mode`, `ports list|add|remove|access`, `backups show|set|run|list|restore`, `oauth clients`, `ci init`. Reglas:

1. **No se renombra ni se rompe nada.** Los comandos actuales siguen igual (mismos flags: `git commits --branch --page`, `git pulls --state`, `git repo --import-url`, `git remote --ssh`, `previews create --pr --ref --sha`).
2. Lo nuevo se añade como subcomandos o grupos nuevos. Donde ya hay un comando de lectura, el grupo nuevo lo expone como **alias** (`capsule pr list` = `capsule git pulls`; `capsule branch list` = `capsule git branches`).
3. `capsule env` ya significa variables de entorno del proyecto: **no se reutiliza**. Entornos de despliegue = `capsule environments` (alias `envs`), promociones = `capsule promote`, aprobaciones = `capsule approvals`. (La propuesta inicial `env-approvals` se descarta por ese choque y por ser larga.)
4. Los permisos y errores vienen del servidor; el CLI no decide, solo traduce a códigos de salida.

## 2. Convenciones globales

- Salida: tabla legible por defecto; `--json` (objeto de la API tal cual), `--jq EXPR` (si hay `jq` embebido (?) decisión de dependencia: usar `github.com/itchyny/gojq`), `--no-header`, `-q` (solo IDs). Sin color si no hay TTY o `NO_COLOR`.
- Referencias: PR por número (`12` o `#12`), rama por nombre, commit por SHA corto, run por ID, alerta por ID corto.
- Esperas: `--wait[=duración]` en operaciones asíncronas (`202`) con polling y progreso por stderr.
- Idempotencia: operaciones marcadas `x-idempotent` envían `Idempotency-Key` automática (hash estable del comando + argumentos + fecha) y `--idempotency-key` para fijarla.
- `--web`: abre la URL equivalente en el navegador (dashboard; para diff, Forgejo).
- Navegación sin proyecto enlazado: error 2 con "ejecuta `capsule link` o usa `--project`".
- Códigos de salida (se documentan en `capsule help exit-codes`):

| Código | Significado |
|---|---|
| 0 | OK |
| 1 | Error no clasificado |
| 2 | Uso incorrecto (flags, argumentos, sin proyecto) |
| 3 | No autenticado / token inválido |
| 4 | Sin permiso o no encontrado (el servidor oculta existencia) |
| 5 | Bloqueado por regla: protección de rama, checks, revisiones, política de seguridad (`PROTECTED_BRANCH`, `CHECKS_REQUIRED`, `REVIEWS_REQUIRED`, `POLICY_BLOCKED`) |
| 6 | Espera agotada (`--wait`) o ejecución terminó en fallo cuando se usa `--exit-status` |
| 7 | Git no listo o error del motor (`GIT_NOT_READY`, `UPSTREAM_GIT_ERROR`) |
| 8 | Pendiente de aprobación (`APPROVAL_REQUIRED`) |
| 9 | Conflicto de concurrencia (409: cabezal cambió, idempotencia) |

## 3. Árbol de comandos

### 3.1 `capsule git` (existente + extensión)

```
capsule git link|show|remote|unlink|test       existentes (gitLink*)
capsule git repo [view|create|import|settings] repo (existente) + subcomandos: repoGet/repoProvision/repoUpdate
capsule git tree [PATH] [--ref R]              repoTree        (alias: capsule repo ls)
capsule git cat PATH [--ref R]                 repoBlob        (alias: capsule repo cat)
capsule git compare BASE HEAD                  repoCompare
capsule git branches [list|create|delete]      existente (lista) + branchCreate/branchDelete
capsule git tags [list|create|delete]          tagsList/tagCreate/tagDelete
capsule git commits [--branch B] [--page N]    existente; commits show SHA (commitGet), commits checks SHA (commitChecks)
capsule git protect list|set|remove|evaluate   protectionsList/Create/Put/Delete/Evaluate
capsule git codeowners [--ref R]               codeownersGet
capsule git pulls ...                          existente = alias de capsule pr list
capsule git previews list|create|delete        existente (previewsList/Create/Delete)
capsule git mirror show|set|remove|sync        mirrorGet/Put/Delete/Sync
capsule git import github --repos R1,R2 ...    importCreate/importGet (--token-stdin; nunca por argv)
capsule git status                             gitStatus (capacidades del servidor)
capsule git clone ORG/REPO [DIR] [-- git-args] clona con la sesión activa (ver 3.1.1)
capsule git login [--host H]                   comprueba sesión y configura el credential helper (idempotente)
capsule git credential get|store|erase         protocolo git-credential (lo invoca Git, no el usuario)   gitCredentialIssue
capsule git setup-gcm                          escribe en git config las claves OAuth de Git Credential Manager para Forgejo (SPEC 6.5.2)
capsule git tokens list|create|revoke          gitTokensList/Create/Revoke  (create: --name --scope read|write --repo ORG/REPO... --expires 30d)
capsule git ssh-keys list|add|remove           gitSshKeys*  (add --title T --key-file ~/.ssh/id_ed25519.pub)
capsule git service-tokens list|create|revoke  serviceTokens*  (CI; --repo implícito del proyecto enlazado; valor por stdout una sola vez)
```

#### 3.1.1 `capsule git clone` y el credential helper

```
$ capsule git clone evvg/web
✓ Sesión activa (piero@…, rol deployer en evvg/web)
✓ Credential helper configurado para https://git.tumi-ai.com (alcance por repo)
Cloning into 'web'...
```

Comportamiento: (1) exige `capsule login` (exit 3 si falta); (2) ejecuta `git config --global credential.https://git.tumi-ai.com.helper "!capsule git credential"` y `credential.https://git.tumi-ai.com.useHttpPath true`; (3) `git clone https://git.tumi-ai.com/ORG/REPO.git` sin credenciales en la URL (nunca se escribe un token en `.git/config`). Con `--ssh` clona por SSH. Opción `--local` configura el helper solo en el repo clonado en vez de global.

`capsule git credential get` (lee `protocol`, `host`, `path` por stdin; escribe `username=`, `password=`, y opcionalmente `password_expiry_utc=` para que Git/GCM cachen correctamente): llama a `POST /user/git-credentials`; si el token vigente en memoria aún dura > 10 min lo reutiliza; si no, emite otro. `store` y `erase` son no-op (el token no se persiste). Errores: sin sesión -> exit 3 y mensaje por stderr "ejecuta capsule login"; sin permiso -> exit 4 (Git muestra fallo de autenticación en lugar de pedir contraseña: el helper responde vacío y Git cae al siguiente helper). No lee nunca sesiones de navegador. En CI **no se usa**: CI emplea el token por ejecución de Forgejo o un token de servicio (SPEC 6.5.5); `capsule git credential` rechaza `CAPSULE_TOKEN` de tipo servicio con exit 2 para evitar mezclar.

Renovación: cada `get` evalúa expiración; la sesión del CLI se refresca como hoy (refresh token). Al `capsule logout` o revocación de sesión, los tokens efímeros se revocan en el servidor. `capsule git login --status` muestra repos con token vigente.

Ejemplos:

```
$ capsule git branches
NAME            PROTEGIDA  AHEAD  BEHIND  ÚLTIMO COMMIT
main            sí (main)  0      0       a1b2c3d  hace 2 h
fix/plazos      no         3      1       7e6d5c4  hoy

$ capsule git protect set main --require-pr --approvals 1 --checks "ci / test" --codeowners --no-force-push --block-on-security
✓ Regla "main" guardada y sincronizada con Forgejo (forgejo_synced=true)

$ capsule git protect evaluate --branch release/1.2
release/1.2 -> regla "release/**" (sin glob gana main; aquí aplica la de glob)

$ capsule git branches delete main ; echo $?
error PROTECTED_BRANCH: la rama "main" está protegida por la regla "main".  
5
```

### 3.2 `capsule pr` (alias `pulls`)

```
capsule pr list [--state open|closed|merged|all] [--author A] [--base B]      pullsList
capsule pr view N [--comments] [--web]                                       pullGet + reviewsList + commentsList
capsule pr create [--title T] [--body B|--body-file F] [--base B] [--head H] [--draft] [--reviewer U,...]   pullCreate
capsule pr edit N [--title] [--body] [--base]                                 pullUpdate
capsule pr close N | reopen N                                                 pullUpdate(state)
capsule pr ready N                                                            pullReady
capsule pr diff N [--web]                                                     pullFiles (texto) | --web abre Forgejo
capsule pr files N | commits N                                               pullFiles / pullCommits
capsule pr checks N [--watch] [--required]                                    pullChecks
capsule pr review N (--approve|--request-changes|--comment) [-b TEXT] [--file F:L:TEXTO]...   reviewCreate
capsule pr request-review N --user U,... [--team T,...]                       reviewersRequest
capsule pr comment N -b TEXT                                                  commentCreate
capsule pr update-branch N [--wait]                                           pullUpdateBranch
capsule pr merge N [--squash|--rebase|--merge|--ff] [--delete-branch] [--auto] [--head-sha SHA]   pullMerge | autoMergeEnable
capsule pr merge N --disable-auto                                             autoMergeDisable
capsule pr status                                                             PR propios y que esperan tu revisión (pullsList filtrado)
```

```
$ capsule pr view 12
#12 fix: valida el plazo procesal   [abierto]  fix/plazos -> main
Checks: ci / test ✓   capsule/preview ✓   capsule/security ✗
Revisiones: 1/1 aprobadas · CODEOWNERS pendiente: @evvg/legal
Bloqueos: POLICY_BLOCKED (1 alerta alta nueva en src/db.ts:41), CODEOWNER_REQUIRED
Preview: https://web-pr-12.apps.tumi-ai.com

$ capsule pr merge 12 --squash ; echo $?
error POLICY_BLOCKED: 1 alerta alta nueva (capsule security alerts show 9c1d2e3f)
5
$ capsule pr merge 12 --auto
✓ Auto-merge programado: se fusionará (squash) cuando pasen los checks y se cumplan las reglas.
```

Alias estilo `gh`: `capsule pr ls` = `list`, `capsule pr co N` (checkout local: `git fetch origin pull/N/head`, (?) la ref `pull/N/head` existe en Forgejo; verificar) y `capsule repo view|clone|create` = `capsule git repo ...`/`git remote` (clone ejecuta `git clone` con la URL de `git remote`).

### 3.3 `capsule branch`

Alias de comodidad: `capsule branch list|create NAME [--from REF]|delete NAME|protect NAME [flags de git protect set]|unprotect NAME`.

### 3.4 `capsule workflow` y `capsule runs` (alias `run`)

```
capsule workflow list                                  workflowsList
capsule workflow run WORKFLOW [--ref R] [-f k=v]...    workflowDispatch (+ --wait)
capsule workflow new [--template ci-node|sast|gitleaks|deploy|trivy]   escribe en .forgejo/workflows (reutiliza `capsule ci init` para despliegue)
capsule runs list [--workflow W] [--branch B] [--status S] [--event E]    runsList
capsule runs view ID [--job J]                         runGet
capsule runs logs ID --job J [--follow]                jobLogs
capsule runs rerun ID [--failed]                       runRerun
capsule runs cancel ID                                 runCancel
capsule runs watch ID [--exit-status]                  polling; exit 6 si falla
capsule runs artifacts ID                              artifactsList  ((?) según soporte)
capsule ci secrets|vars list|set|delete [--org]        ciSecrets*/ciVars*/orgCi*  (valor por stdin o --from-env; nunca argv)
capsule ci runners                                     runnersList
```

`capsule ci init` (existente) sigue generando el pipeline GitHub/Forgejo hacia Capsule; `capsule workflow new` genera workflows de calidad.

### 3.5 `capsule security`

```
capsule security overview                              securityOverview
capsule security alerts list [--kind K] [--severity S] [--state open] [--branch B] [--tool T]   alertsList
capsule security alerts show ID                        alertGet
capsule security alerts dismiss ID --reason false_positive|wont_fix|used_in_tests|risk_accepted --why TEXT --expires 90d   alertDismiss
capsule security alerts reopen ID                      alertReopen
capsule security suppressions list|add|remove          suppressions*
capsule security policy show|set [--block-merge-on dependency=high,code=high,secret=any] [--block-deploy-on high] [--require-tools semgrep,gitleaks]   securityPolicy*
capsule security scan [--tools osv-scanner,semgrep] [--ref R] [--wait]   scanTrigger
capsule security sarif upload FILE --sha SHA --ref REF [--tool NAME] [--pr N]   sarifUpload (gzip+base64 automático; token con scope security:write; usado desde CI)
capsule security renovate show|enable|disable|run      renovate*
```

Ejemplo en un workflow de Forgejo (el token `CAPSULE_TOKEN` es de alcance `security:write` a un proyecto, creado con `capsule tokens create --scope security:write --project ID`):

```
- run: semgrep --sarif -o semgrep.sarif ...
- run: capsule security sarif upload semgrep.sarif --sha "$GITHUB_SHA" --ref "$GITHUB_REF_NAME" --tool semgrep
```

Salida de `dismiss` sin `--expires` o sin `--why`: error 2 ("la caducidad y la justificación son obligatorias").

### 3.6 `capsule environments`, `promote`, `approvals`

```
capsule environments list|show NAME                    envsList/envGet
capsule environments create NAME --kind production --target PROJECT [--branches main,release/**] [--reviewers user:ana,role:admin] [--approvals 1] [--wait-minutes 0] [--window "mon-fri 09:00-18:00 America/Lima"]   envCreate
capsule environments set NAME [mismos flags]           envPut
capsule environments delete NAME                       envDelete
capsule environments history NAME                      envDeployments
capsule promote --to production --sha SHA [--from staging] [--comment C] [--wait]   promotionCreate
capsule promote show ID | cancel ID                    promotionGet / promotionCancel
capsule approvals list                                 approvalsPending
capsule approvals approve ID -m TEXTO | reject ID -m TEXTO   promotionApprove / promotionReject
```

```
$ capsule promote --to production --sha a1b2c3d --wait ; echo $?
Promoción 3f2a… a production: pendiente de aprobación (1 requerida: ana, luis)
8
$ capsule approvals approve 3f2a -m "Probado en staging"
✓ Aprobada. Despliegue en curso…
```

La acción de CI `actions/deploy` gana la entrada opcional `environment:` que llama a `promote` en vez de desplegar directo cuando el entorno tiene política (paquete B2).

### 3.7 Webhooks, notificaciones, auditoría, miembros, recuperación

```
capsule webhooks list|create|update|delete|test|rotate-secret|deliveries|redeliver   webhooks*
capsule notifications list [--unread] | read [ID|--all] | settings show|set
capsule audit [--action A] [--actor U] [--project P] [--since 7d] [--csv]            auditLog
capsule members list|set|remove                        existentes (membersList/memberPut/memberDelete)
capsule org access-mode open|restricted                existente
capsule recover plan|apply|verify [--project P|--all] [--target ephemeral] [--snapshot ID]   recoverProject / gitRecoverPlatform (ver DR-BACKUP.md)
```

## 4. Alias de usuario y compatibilidad con `gh`

- `capsule alias set NAME 'COMANDO...'` guarda en `~/.capsule/config.yaml` (sección `aliases`), como `gh alias`. Ejemplo: `capsule alias set mine 'pr list --author @me'`.
- Equivalencias directas `gh` → `capsule`: `gh pr create/list/view/checkout/merge/review/checks/diff/ready` → `capsule pr ...`; `gh run list/view/watch/rerun` → `capsule runs ...`; `gh workflow run/list` → `capsule workflow ...`; `gh repo view/clone/create` → `capsule repo ...`; `gh api` → `capsule api METHOD PATH [-f k=v]` (llamada autenticada a `/api/v1`; útil para scripts y para rutas aún sin comando); `gh secret/variable set` → `capsule ci secrets|vars set`; `gh browse` → `--web`.
- `@me` se resuelve con `whoami`.
- No se implementa: `gh issue`, `gh project`, `gh gist`, `gh codespace`, `gh release` (releases de Forgejo quedan ocultos en v1).

## 5. Pruebas y criterios del paquete CLI (B2)

Tabla de comandos con su operationId como prueba de contrato: un test recorre `API.openapi.yaml` y falla si un `operationId` marcado para CLI no tiene comando; pruebas con servidor HTTP falso (httptest) para códigos de salida 2-9; pruebas con servidor real solo cuando existan las rutas (`x-status` cambiado a `implemented`).
