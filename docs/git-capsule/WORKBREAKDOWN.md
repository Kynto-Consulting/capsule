# Git Capsule: plan de construcción (paquetes para agentes en paralelo)

Referencias: `SPEC.md` (qué y por qué), `API.openapi.yaml` (contratos; cada paquete cita `operationId`), `UX.md`, `CLI.md`, `DR-BACKUP.md`. 18 paquetes en 3 oleadas. Cada paquete lo ejecuta un agente en una sesión.

## 0. Reglas comunes (aplican a todos los paquetes)

1. **Propiedad exclusiva de archivos.** Un paquete solo crea/edita lo que figura en "Posee". Nada fuera, salvo el cableado mínimo descrito en 0.2.
2. **Cableado mínimo en archivos compartidos** (`backend/internal/server/router.go`, `backend/cmd/*/main.go`, `backend/internal/config/config.go`, `docker-compose.prod.yml`):
   - **A1 crea** en `router.go` un bloque delimitado `// git-capsule:mounts begin/end` y en `main.go` un bloque `// git-capsule:wiring begin/end`. Cada paquete añade como máximo **una línea** (una llamada `Mount<Paquete>(r, deps)` y una `Wire<Paquete>(...)`) dentro de su bloque, en orden alfabético por id, y su configuración vive en **su propio paquete** (`<pkg>.ConfigFromEnv()`), no en `config.go`.
   - Si dos paquetes se integran a la vez y chocan en el bloque, el conflicto es solo de líneas y lo resuelve quien integra último (no se reescribe lo del otro).
3. **Migraciones**: numeración global fija, solo `IF NOT EXISTS`, con `.down.sql`, sin tocar tablas existentes salvo `ADD COLUMN IF NOT EXISTS` documentado. Rangos asignados en 0.1; si un paquete necesita más, usa el rango de reserva y lo anota.
4. **Contrato primero**: si una ruta de `API.openapi.yaml` debe cambiar, el agente edita el YAML en el mismo PR y lo declara; ningún cambio de forma sin tocar el contrato. `x-status` pasa a `implemented` solo cuando hay prueba de integración.
5. **Pruebas**: Go con `go test ./...` y pruebas contra **Postgres real** (docker, como las existentes en `backend`); frontend con tipos TypeScript, `eslint` y pruebas de navegador (Playwright o el MCP de navegador) contra un backend de prueba o mock del OpenAPI; CLI con `httptest`. Sin dependencias nuevas sin justificarlas en el PR.
6. **Seguridad**: ningún secreto en logs ni respuestas; todo acceso a Forgejo pasa por `gitcore`; toda ruta nueva declara `x-permission` y lo hace cumplir con `authz` (nunca solo el rol de org).
7. **Texto visible**: sin las palabras demo/simulado/ficticio; marca "Git Capsule".
8. **Qué NO se puede verificar sin servicios externos** se declara por paquete; no se marca "hecho" algo que solo se probó con dobles.
9. Prohibido en todos: commit/push, despliegues, SSH/AWS reales, `terraform apply` (los paquetes solo producen cambios de repo y planes).

### 0.1 Rangos de migración (empiezan en 000034; 000029-000033 ya están en uso)

| Paquete | Rango | Tablas previstas |
|---|---|---|
| A2 | 000034-000035 | `git_identities`, `git_team_state` |
| A4 | 000036-000037 | `branch_protection_rules`, `branch_protection_sync` |
| A5 | 000038-000040 | `git_events`, `outbound_webhooks`, `webhook_deliveries`, `notifications`, `notification_settings` |
| A6 | 000041-000043 | `environments`, `promotions`, `promotion_approvals`, `environment_deployments` |
| A7 | 000044-000045 | `git_access_tokens`, `git_ssh_keys` |
| B7 | 000046-000049 | `security_alerts`, `sarif_uploads`, `security_suppressions`, `security_policies`, `renovate_state` |
| B8 | 000050-000051 | `pr_auto_merge`, `pr_draft_state`, `codeowners_cache` |
| B6 | 000052 | `ci_variables_org_index`, `workflow_policy` |
| C1 | 000053-000054 | `git_imports`, `git_mirrors` |
| C2 | 000055-000056 | `audit_logs` (columnas/índices), `git_activity` |
| C3 | 000057 | `recovery_runs` |
| Reserva integrador | 000058-000069 | cualquier ajuste |

### 0.2 Entregas de producto (qué pantallas son de primera entrega)

| Entrega | Pantallas/capacidades | Paquetes necesarios |
|---|---|---|
| **E1 (primera usable)** | Código con explorador y visor resaltado, Ramas, Commits + diff de commit, PR (lista, conversación, caja de merge, aprobar/pedir cambios/comentar) con **enlace "Abrir en Forgejo" para revisión línea a línea y editor**, Actions (runs y logs), Seguridad, Entornos y aprobaciones, Ajustes (protecciones, webhooks, miembros, secretos), clonar con Capsule / Git / SSH, Tokens de acceso | A1-A7, B1-B5 (parte E1), B6, B7, B8 |
| **E2** | Revisión línea a línea y sugerencias en el dashboard, blame, diff dividido, grafo de jobs | B4 (extensión), B3 (extensión) |
| **E3** | Editor de archivos propio, aplicar sugerencias | B3 (extensión) |
| **Oleada C** | Importación GitHub, espejo, notificaciones completas, auditoría, recuperación | C1-C3 |

### 0.3 Estrategia de paralelismo

- Oleada A es la base; **A1, A2, A3, A4 pueden empezar a la vez** contra el contrato; A5, A6, A7 dependen de interfaces de A1/A2 (se acuerdan al principio en `backend/internal/gitcore/types.go`, entregado por A1 en las primeras horas y fijado).
- Oleada B arranca cuando A1 publica sus interfaces y el OpenAPI está estable; **la web (B3-B5) y el CLI (B2) se construyen contra un servidor mock generado desde `API.openapi.yaml`** (por ejemplo `prism`/`openapi-mock` en un directorio de herramientas del paquete) y se integran con B1 al final.
- Separación explícita **API/proxy vs UI nativa**: B1 y A1 (API y proxy a Forgejo con paginación, caché, límites y permisos Capsule->equipos) no contienen UI; B3-B5 no hablan nunca con Forgejo, solo con `/api/v1`.

## 1. Oleada A (núcleo)

### A1. Cliente Forgejo, proxy y esqueleto de montaje
- **Objetivo**: único punto de acceso a Forgejo desde el backend, con paginación, caché, límites y mapeo de errores; define los bloques de cableado.
- **Alcance**: cliente tipado de la API v1 de Forgejo (repos, ramas, etiquetas, commits, tree/blob/compare, PR, revisiones, comentarios, checks/status, protecciones, equipos, hooks, Actions runs/jobs/logs, secretos/variables de org y repo, push mirrors, migración, claves SSH de usuario) con `Sudo`; reintentos con backoff y jitter; timeouts; **circuit breaker**; límite de concurrencia por instancia; caché en Redis (existente) de lecturas inmutables por SHA (árbol, blob, commit, diff) con TTL largo y de listas (ramas, PR) con TTL corto e invalidación por webhook; paginación por cursor traducida a `page/limit` de Forgejo; límites de tamaño (blob 1 MiB, diff 2 MiB por PR con `truncated`); errores normalizados a `UPSTREAM_GIT_ERROR`/`GIT_NOT_READY`/404/403.
- **Posee**: `backend/internal/gitcore/**` (incluye `types.go`, `fake/` servidor Forgejo falso para pruebas), bloques `git-capsule:mounts`/`wiring` en `router.go` y `main.go`, `backend/internal/gitcore/config.go`.
- **Contratos**: ninguna ruta pública; consumido por B1, A2, A4, A5, A6, A7, B6-B8, C1, C3.
- **Migraciones**: ninguna.
- **Depende de**: nada.
- **Aceptación**: pruebas unitarias con `httptest` para cada método (éxito, 404, 403, 5xx, timeout, reintento, cuerpo malformado); prueba de caché (hit/miss/invalidación); prueba de circuit breaker; prueba de que ninguna respuesta de error filtra el token de servicio ni cabeceras; prueba de paginación con cursores; `go vet` y cobertura >= 80 % del paquete; fake de Forgejo usable por los demás paquetes. Verificación **contra Forgejo real** en un contenedor local con SQLite (script `gitcore/itest`, marcado `-tags=forgejo`) para los métodos de lectura y de protecciones.
- **Riesgos / no verificable**: nombres exactos de campos de `CreateBranchProtectionOption`, `MergePullRequestOption`, soporte de `Sudo` con el alcance del token y push mirrors son **(?)** hasta probarlos contra v15.0.11; no se puede validar sin un Forgejo real accesible desde la sesión del agente.

### A2. Identidad, sincronización de equipos y autorización `git.*`
- **Objetivo**: usuarios Capsule <-> usuarios Forgejo y equipos reflejando roles de proyecto; acciones `git.*` en `authz`.
- **Alcance**: tabla `git_identities`; llenado en primer login OIDC (nickname) y por reconciliación; reconciliación periódica y por evento (alta/cambio/baja de rol, modo `restricted`, usuarios ocultos) usando la cola `git_team_sync` de 000030; equipos `-viewer/-deployer/-admin` con unidades sin `repo.settings`/`repo.issues`/`repo.wiki`/`repo.projects`; extensión de la matriz de `authz` con `git.read/write/review/merge/admin`, `security.*`, `env.*`, `webhooks.manage`; sustituir `OrgRoleAuthorizer` del `GitHandler` por `authz`; tests de deriva.
- **Posee**: `backend/internal/gitsync/**`, `backend/internal/authz/git_actions.go` (+ test), cambio acotado en `handlers/git.go` (solo el autorizador) y hook de sincronización en `project_members.go` limitado a una llamada.
- **Contratos**: `memberList/Put/Delete` (existentes), `gitReconcile`.
- **Migraciones**: 000034-000035.
- **Depende de**: A1 (interfaces).
- **Aceptación**: matriz de permisos exhaustiva (rol x acción x modo de org) en tabla de pruebas; prueba contra Postgres real de reconciliación idempotente y de usuarios que aún no existen en Forgejo; prueba de que quitar un rol quita del equipo y descarta revisiones pendientes; prueba de que org `readonly` en modo restringido sin fila no está en ningún equipo; sin regresión en `authz_test.go` y `project_members_test.go`.
- **Riesgos / no verificable**: comportamiento real de `units_map` y del claim `groups` en Forgejo; no verificable el primer login real sin Forgejo+OIDC reales.

### A3. Tema Git Capsule, endurecimiento de Forgejo y borde de acceso
- **Objetivo**: Forgejo como respaldo con marca, y Caddy preparado para tokens `cgt_`.
- **Alcance**: `deploy/forgejo/custom/**` (logo/favicon textual SVG, `templates/custom/header.tmpl` con variables CSS, `extra_links*.tmpl`, plantilla de login), `APP_NAME/APP_SLOGAN/[ui]` en el compose, ocultar unidades y explorar/forks (claves **(?)** verificadas con `forgejo doctor`/cheat-sheet), `Caddyfile` con `forward_auth` a `/internal/git-auth`, eliminación de `X-WEBAUTH-USER` entrante y límite de tasa; test de humo visual (Playwright contra Forgejo efímero) que se ejecuta en cada subida de `GIT_VERSION`; actualización de `CHECKLIST.md` con las nuevas comprobaciones.
- **Posee**: `deploy/forgejo/custom/**`, `deploy/forgejo/Caddyfile`, `deploy/forgejo/tests/visual/**`; en `docker-compose.prod.yml` solo variables `FORGEJO__*` y el montaje de `custom/` (cambios acotados y listados en el PR).
- **Contratos**: `/internal/git-auth` (interno, lo implementa A7).
- **Migraciones**: ninguna.
- **Depende de**: ninguna para tema; A7 para forward_auth (se prueba con un stub).
- **Aceptación**: `caddy validate` del Caddyfile; prueba con `curl` contra un Caddy+stub: cabecera entrante `X-WEBAUTH-USER` descartada, credencial no `cgt_` pasa sin cabecera, `cgt_` válido inyecta cabecera; capturas del tema (login, repo, PR) comparadas con paleta; `docker compose config -q`.
- **Riesgos / no verificable**: el mecanismo de tema propio y nombres de variables CSS son **(?)** hasta mirar el repo de Forgejo; autenticación por proxy inverso en git-over-HTTP **(?)**; certificados reales y el 22 público no se verifican fuera del servidor.

### A4. Proveedor de protección de ramas
- **Objetivo**: reglas de protección con modelo propio proyectado a Forgejo y evaluación explicable.
- **Alcance**: `branch_protection_rules` y estado de sincronización; CRUD, `evaluate` (glob con la semántica de Forgejo y precedencia sin glob), proyección a Forgejo con reconciliación, publicación de contextos `capsule/*`, estrategias permitidas para "historial lineal", protección de etiquetas, valores por defecto seguros; auditoría de cambios.
- **Posee**: `backend/internal/gitprotect/**`, `backend/internal/server/handlers/git_protect.go`.
- **Contratos**: `protectionsList/Create/Put/Delete/Evaluate`, `repoUpdate` (parte de ajustes de merge), `tagCreate/tagDelete` (protección de etiquetas).
- **Migraciones**: 000036-000037.
- **Depende de**: A1, A2 (permisos).
- **Aceptación**: tabla de pruebas de glob/precedencia (incluye `**`, `/`, sin glob vs glob); prueba contra Postgres de CRUD y de idempotencia de la proyección; prueba con el fake de A1 de que cada campo se traduce al DTO de Forgejo; prueba de deriva (alguien edita en Forgejo -> reconciliación lo corrige y audita); test de `enforce_for_admins`.
- **Riesgos / no verificable**: opciones nativas (aprobaciones, checks, firmas, listas) **(?)** hasta contrastar con `/api/swagger`; push de merge commits no se puede impedir de forma nativa; efecto real de la protección se verifica solo con push/PR reales contra Forgejo.

### A5. Eventos entrantes, webhooks salientes y notificaciones (núcleo de eventos)
- **Objetivo**: bus de eventos de producto y salida firmada.
- **Alcance**: extender `POST /hooks/git/{projectID}` (misma ruta) a `pull_request_review`, `status`, `workflow_run` con idempotencia por `X-Forgejo-Delivery`; tabla `git_events`; despachador interno; webhooks salientes (HTTP firmado `X-Capsule-*`, Slack, Discord, correo), reintentos, rotación con ventana de 24 h, SSRF, desactivación por 410; bandeja de notificaciones y preferencias.
- **Posee**: `backend/internal/gitevents/**`, `backend/internal/webhookout/**`, `backend/internal/server/handlers/webhooks.go`, `notifications.go`; extensión acotada de `gitsource/webhook.go` (nuevos eventos, con pruebas) y de `git_hooks.go`.
- **Contratos**: `gitInboundWebhook`, `webhooksList/Create/Update/Delete/Test/Rotate/deliveries/redeliver`, `orgWebhooksList/Create`, `notificationsList/Mark`, `notifSettingsGet/Put`, y `x-webhook-events`/`webhooks`.
- **Migraciones**: 000038-000040.
- **Depende de**: A1.
- **Aceptación**: pruebas de firma entrante (válida, inválida, replay con el mismo delivery id) y saliente (verificación con ejemplo en Go, Node y bash incluido en el PR); backoff con reloj falso; SSRF contra IP privadas/redirecciones; prueba contra Postgres de entregas y reintentos tras reinicio; los eventos existentes (push, PR de preview) siguen funcionando (`git_test.go`).
- **Riesgos / no verificable**: envío real a Slack/Discord y correo (SES) no verificable sin credenciales; formato de eventos de PR de Forgejo **(?)** (la doc de webhooks no lo detalla).

### A6. Entornos, promociones y aprobaciones
- **Objetivo**: SPEC 5.7 completo.
- **Alcance**: tablas y servicio de entornos; evaluador de condiciones (rama permitida, checks del SHA, política de seguridad, entorno origen, aprobaciones sin autoaprobación, espera, ventana con zona horaria, caducidad 72 h); integración con el flujo de despliegue existente (reutiliza el artefacto sin recompilar) y con salud/rollback (000033); estados `pending_approval|waiting|approved|deploying|success|failed|rejected|cancelled|expired`; cola por entorno; cron de caducidad; auditoría; publicación del check `capsule/env:<nombre>`.
- **Posee**: `backend/internal/environments/**`, `backend/internal/server/handlers/environments.go`, `promotions.go`.
- **Contratos**: `envsList/Create/Get/Put/Delete/Deployments`, `promotionCreate/Get/Approve/Reject/Cancel`, `approvalsPending`.
- **Migraciones**: 000041-000043.
- **Depende de**: A1, A2, A5 (eventos).
- **Aceptación**: pruebas de tabla de estados y de reloj (ventanas con zonas, DST de zonas que lo tengan); prueba contra Postgres de carreras (dos aprobaciones simultáneas, doble promoción con la misma `Idempotency-Key`); `SELF_APPROVAL_FORBIDDEN`; aprobador sin rol; promoción reutiliza `source` (verifica que no se invoca compilación); caducidad.
- **Riesgos / no verificable**: despliegue real en AWS/Docker (solo con dobles del worker, como `gitdeploy_test.go`); la integración con `worker.go` (1371 líneas) debe tocarse mínimamente (una función de extensión) y exige revisión.

### A7. Tokens de acceso Git, credential helper y SSH
- **Objetivo**: SPEC 6.5.
- **Alcance**: tokens `cgt_` (efímeros ligados a sesión de CLI, personales, de servicio) con hash, alcance por repo, rol re-evaluado en cada validación, revocación y auditoría; `POST /user/git-credentials`; endpoint interno `/internal/git-auth` para `forward_auth` (BASIC -> `X-WEBAUTH-USER`; credenciales no `cgt_` pasan sin cabecera); límite de tasa; caché de validación <= 30 s; llaves SSH sincronizadas con Forgejo; avisos de caducidad.
- **Posee**: `backend/internal/gittokens/**`, `backend/internal/server/handlers/git_tokens.go`, `git_ssh_keys.go`, `git_auth_internal.go`.
- **Contratos**: `gitCredentialIssue`, `gitTokensList/Create/Revoke`, `gitSshKeysList/Add/Delete`, `serviceTokensList/Create/Revoke`.
- **Migraciones**: 000044-000045.
- **Depende de**: A1, A2.
- **Aceptación**: pruebas de emisión/renovación (reutiliza si quedan > 10 min), caducidad, revocación por sesión y por token, rol removido corta en <= 30 s, alcance a otro repo rechazado, hash en BD (nunca el valor), comparación en tiempo constante, límite de tasa; el endpoint interno rechaza llamadas que no vengan de la red interna; pruebas contra Postgres real.
- **Riesgos / no verificable**: git-over-HTTP real con `forward_auth` y `X-WEBAUTH-USER` es **(?)** y solo se verifica con Caddy+Forgejo reales; si falla, se activa el plan B de SPEC 6.5 (decisión 1 del dueño).

## 2. Oleada B (en paralelo, tras publicar A1 y el contrato)

### B1. API de Git completa (API/proxy, sin UI)
- **Objetivo**: implementar las rutas de repo, ramas, commits, PR, Actions y ajustes del contrato.
- **Alcance**: handlers para `repo*`, `tree/blob/compare`, `branches*`, `tags*`, `commits*`, `pulls*` (lista, crear, editar, archivos, commits, revisiones, comentarios, merge, update-branch, checks, mergeabilidad calculada), `workflows`, `runs*`, `jobLogs` (re-enmascarado), `dispatch`, secretos/variables (repo y org), `runnersList`, `activityList`, `insights`; montaje en el bloque de A1; adaptar a lo que 000030 y el agente del CLI ya publicaron (ver sección 3, huecos).
- **Posee**: `backend/internal/server/handlers/gitapi_*.go`, `backend/internal/gitapi/**` (mergeabilidad, mapeo de DTO).
- **Contratos**: todos los `x-status: new|in-progress` de Código, Ramas, Commits, Pull requests, Actions, Actividad.
- **Migraciones**: ninguna (usa las de A).
- **Depende de**: A1, A2, A4 (y A5 para actividad).
- **Aceptación**: prueba de contrato automática (recorre el YAML y verifica que cada ruta existe, el esquema de respuesta valida y `x-permission` se hace cumplir con 403 para roles inferiores); pruebas contra Postgres y fake de Forgejo; paginación por cursor, límites de tamaño y `truncated`; `Idempotency-Key` en merge/rerun/dispatch; mergeabilidad con tabla de casos (todos los `blockers`).
- **Riesgos / no verificable**: comportamiento real de merge/auto-merge/borrador en Forgejo **(?)**.

### B2. CLI
- **Objetivo**: CLI.md completo, incluyendo `git clone` y el credential helper.
- **Alcance**: grupos `git` (extensión), `pr`, `branch`, `workflow`, `runs`, `ci secrets/vars/runners`, `security`, `environments`, `promote`, `approvals`, `webhooks`, `notifications`, `audit`, `recover`, `api`, `alias`; códigos de salida; `capsule git clone/login/credential/setup-gcm/tokens/ssh-keys/service-tokens`.
- **Posee**: `cli/cmd/capsule/git_*.go`, `pr.go`, `branch.go`, `workflow.go`, `runs.go`, `security.go`, `environments.go`, `promote.go`, `approvals.go`, `webhooks.go`, `notifications.go`, `audit.go`, `recover.go`, `apicmd.go`, `alias.go`, `exitcodes.go`, `cli/internal/gitcred/**`; no toca `gitcmd.go` existente salvo registrar subcomandos nuevos (una línea cada uno).
- **Contratos**: los `operationId` del CLI.md.
- **Migraciones**: ninguna.
- **Depende de**: contrato (mock); integra con B1/A7 al final.
- **Aceptación**: test que recorre `API.openapi.yaml` y falla si un `operationId` del CLI no tiene comando; pruebas con `httptest` de salida y de códigos 2-9; prueba del protocolo `git credential` con `git` real en un repositorio temporal contra un servidor HTTP falso (get/store/erase, renovación a < 10 min); sin regresión en `cienv_test.go`, `ciinit_test.go`, `netaccess_test.go`, `platform_test.go`.
- **Riesgos / no verificable**: clonado real contra `git.tumi-ai.com` (requiere A3/A7 desplegados); instalación npm del wrapper.

### B3. Web: shell del repo, Código, Ramas, Commits, clonar y tokens
- **Objetivo**: UX §3-4.1, 4.2, commits/diff, 4.1.1 y 4.8.1 (entrega 1; extensiones E2/E3 en el mismo paquete).
- **Alcance**: `RepoShell` (cabecera, pestañas, insignias), explorador de archivos y visor con resaltado, ramas y etiquetas, commits y diff unificado de commit, diálogo de clonado (3 pestañas, detección de SO), pantallas de Tokens de acceso y Llaves SSH, `/git` lista de repos; estados vacío/carga/error; accesibilidad y responsive.
- **Posee**: `frontend/app/(dashboard)/git/[org]/[repo]/layout.tsx`, `page.tsx`, `tree/**`, `blob/**`, `commits/**`, `commit/**`, `branches/**`; `frontend/app/(dashboard)/settings/git/**`; `frontend/components/git/{shell,code,branches,commits,clone,tokens}/**`; `frontend/lib/git/api.ts` (cliente tipado generado del OpenAPI).
- **Contratos**: `repoGet/Tree/Blob/Compare`, `branchesList`, `tagsList`, `commitsList/Get/Checks`, `gitTokens*`, `gitSshKeys*`.
- **Migraciones**: ninguna.
- **Depende de**: contrato; integra con B1/A7.
- **Aceptación**: `tsc`, `eslint`; prueba de navegador por pantalla (carga, vacío, error 502 con banner, rol viewer sin botones de escritura); verificación visual contra `mockups/*.html`; Lighthouse accesibilidad >= 90 y revisión manual de foco/teclado; viewport 375, 768 y 1280; un archivo de 1 MiB y uno binario; el visor no ejecuta HTML/SVG del repo.
- **Riesgos / no verificable**: datos reales de Forgejo; el resaltado depende de una librería nueva (justificar peso y carga diferida).

### B4. Web: Pull requests y Actions
- **Objetivo**: UX 4.3 y 4.4.
- **Alcance**: lista y detalle de PR (conversación, caja de merge con bloqueos, checks, aprobar/pedir cambios/comentar, revisores, preview), diff unificado de solo lectura con **enlace "Revisar línea a línea en Forgejo"** (E1); en E2: comentarios en línea y sugerencias nativos; Actions: runs, logs con búsqueda y autoscroll, rerun/cancel/dispatch, plantillas de workflow.
- **Posee**: `frontend/app/(dashboard)/git/[org]/[repo]/pulls/**`, `actions/**`; `frontend/components/git/{pulls,actions}/**`.
- **Contratos**: `pull*`, `review*`, `comment*`, `pullChecks`, `autoMerge*`, `workflowsList`, `runs*`, `jobLogs`, `workflowDispatch`.
- **Migraciones**: ninguna.
- **Depende de**: contrato; B3 (el shell, solo la interfaz de `RepoShell`).
- **Aceptación**: pruebas de navegador de la caja de merge con cada `blocker` (el botón Fusionar deshabilitado con motivo), conflicto 409 por `head_sha`, log de 50 000 líneas sin congelar la UI (virtualización), reintento de logs con `cursor`, foco y `aria-live`; en E2, comentario en línea + sugerencia ida y vuelta contra el mock.
- **Riesgos / no verificable**: comentarios en línea reales y sugerencias requieren Forgejo real; E2 puede ser más caro de lo estimado (por eso va después).

### B5. Web: Seguridad, Entornos, Aprobaciones, Ajustes
- **Objetivo**: UX 4.5-4.8, 4.9.
- **Alcance**: Seguridad (resumen, alertas, detalle, supresión, política, Renovate), Entornos y promociones, Aprobaciones, Ajustes (General, Protección de ramas con vista previa de coincidencias, Webhooks, Secretos/variables, Espejo, Miembros reutilizando `members-tab`, tokens de servicio), Notificaciones, Auditoría, Importar.
- **Posee**: `frontend/app/(dashboard)/git/[org]/[repo]/{security,environments,insights,settings}/**`, `frontend/app/(dashboard)/{approvals,notifications}/**`, `frontend/app/(dashboard)/settings/audit/**`, `frontend/app/(dashboard)/git/import/**`; `frontend/components/git/{security,environments,settings,approvals}/**`.
- **Contratos**: `security*`, `alert*`, `suppression*`, `renovate*`, `env*`, `promotion*`, `approvalsPending`, `protection*`, `codeownersGet`, `webhooks*`, `ciSecrets*`, `ciVars*`, `mirror*`, `import*`, `notifications*`, `auditLog`, `serviceTokens*`.
- **Migraciones**: ninguna.
- **Depende de**: contrato; B3 (shell).
- **Aceptación**: pruebas de navegador de cada formulario con validación (supresión sin justificación/caducidad rechazada, caducidad fuera de rango), la alerta de secretos nunca muestra valor, solo admin ve Ajustes, viewer no ve botones, estados vacío/error; contraste y teclado.
- **Riesgos / no verificable**: datos reales de seguridad/SARIF hasta que B7 y los runners existan.

### B6. Workflows y runners
- **Objetivo**: SPEC 5.6, 6.3, runner confiable/no confiable.
- **Alcance**: plantillas de workflows (CI Node/Go/Python, SAST, gitleaks, trivy, deploy y promoción, policy lint) endurecidas y fijadas por SHA; job `workflow-policy`; acción `actions/deploy` con entrada `environment`; módulo Terraform del runner `ci-untrusted` (solo plan); secretos de entorno inyectados solo en el despliegue; re-enmascarado de logs; artefactos y caché (decisión tras verificar soporte, **(?)**); `DEFAULT_ACTIONS_URL` y política de acciones.
- **Posee**: `deploy/forgejo/workflows/**`, `deploy/forgejo/sast/**` (solo ajustes), `actions/deploy/**`, `actions/templates/forgejo-ci-cd.yml`, `deploy/terraform/ci_untrusted.tf` (nuevo), `backend/internal/gitapi/ci_masking.go` (acordado con B1).
- **Contratos**: `workflowsList`, `runsList`, `ciSecrets*`, `runnersList`, `artifactsList`.
- **Migraciones**: 000052.
- **Depende de**: A3; B7 (formato SARIF) y A6 (promociones) para sus plantillas.
- **Aceptación**: `actionlint` y `yamllint` sobre cada plantilla; el lint de workflows rechaza casos malos (tests con fixtures: `pull_request_target`, `write-all`, `curl|sh`, acción sin SHA); `terraform fmt -check`/`validate`/`plan` del módulo (sin aplicar); prueba de enmascarado con valores conocidos.
- **Riesgos / no verificable**: ejecutar un workflow real exige Forgejo + runner (EC2 aparte): **no verificable en esta fase**; artefactos/caché y aprobación de ejecución de forks son **(?)**.

### B7. Seguridad: SARIF, alertas, políticas, supresiones y Renovate
- **Objetivo**: SPEC 5.8 (backend).
- **Alcance**: ingesta SARIF 2.1.0 (gzip+base64, límites, esquema estricto, escape), huellas estables y ciclo `open->fixed`, mapeo de severidades, conversión de osv-scanner/gitleaks/trivy/Semgrep a alertas, supresiones con caducidad y notificación a 7 días, políticas (`block_merge_on`, `block_deploy_on`, herramientas requeridas), check `capsule/security` (solo alertas nuevas del PR frente a la base; falla cerrado a los 30 min), integración de Renovate (estado, onboarding, ejecución por cron), retirada del flujo "issue único" de `security-audit.yml` hacia SARIF.
- **Posee**: `backend/internal/security/**`, `backend/internal/server/handlers/security.go`, `renovate.go`; `deploy/forgejo/renovate/**` (ajustes), `deploy/forgejo/workflows/security-audit.yml` (solo la parte de publicación).
- **Contratos**: `securityOverview`, `alertsList/Get/Dismiss/Reopen`, `sarifUpload/Status`, `securityPolicyGet/Put`, `suppressions*`, `scanTrigger`, `renovate*`.
- **Migraciones**: 000046-000049.
- **Depende de**: A1, A2, A5.
- **Aceptación**: pruebas con SARIF reales de Semgrep, gosec, gitleaks, trivy y osv-scanner (fixtures versionadas), SARIF malicioso (tamaño, anidación, HTML, 10 000 resultados) rechazado o truncado con error claro; deduplicación entre subidas; supresión sin justificación/caducidad rechazada; critical/high exige `security.admin`; caducidad devuelve a `open`; contra Postgres real de concurrencia (dos subidas simultáneas de la misma herramienta); el valor de un secreto jamás se persiste (prueba que busca el valor en todas las tablas).
- **Riesgos / no verificable**: Semgrep/osv/trivy reales y Renovate real (red, tokens de Forgejo) no se ejecutan aquí; licencia de reglas del registro (decisión 3 del dueño); formato SARIF de osv-scanner **(?)**.

### B8. CODEOWNERS, revisiones requeridas, borrador y auto-merge
- **Objetivo**: SPEC 5.4 y 5.3 (parte Capsule).
- **Alcance**: lectura y resolución de CODEOWNERS (regex Go de Forgejo; aviso de sintaxis GitHub) a usuarios Capsule; cálculo de revisiones requeridas y pendientes; `pr_draft_state` si Forgejo no tiene borrador nativo; worker de auto-merge reintentando por eventos con `head_sha`; descarte de revisiones al perder rol; checks `capsule/policy`.
- **Posee**: `backend/internal/gitreview/**`, `backend/internal/server/handlers/git_review.go`.
- **Contratos**: `codeownersGet`, `autoMergeEnable/Disable`, `pullReady`, `reviewDismiss`, `reviewersRequest`, `pullUpdateBranch`.
- **Migraciones**: 000050-000051.
- **Depende de**: A1, A2, A4, A5.
- **Aceptación**: pruebas de tabla de CODEOWNERS (reglas negativas `!`, regex inválida, equipos, usuario desconocido); auto-merge con reloj y eventos desordenados, 409 por cabezal cambiado, doble disparo idempotente; contra Postgres real; casos límite del SPEC (rol perdido, commit nuevo tras aprobación).
- **Riesgos / no verificable**: soporte nativo de borrador/auto-merge **(?)**; efecto real con PR reales.

## 3. Oleada C

### C1. Importación desde GitHub y espejo
- **Alcance**: `importCreate/Get` (token efímero, nunca persistido ni en logs; conversión de CODEOWNERS; estado por repo; reanudable), `mirror*` (credencial cifrada, ramas, intervalo, SSRF), auditoría y avisos.
- **Posee**: `backend/internal/gitimport/**`, `backend/internal/server/handlers/git_import.go`, `git_mirror.go`.
- **Migraciones**: 000053-000054. **Depende de**: A1, A2, A5, B8 (conversión CODEOWNERS).
- **Aceptación**: pruebas con fake de Forgejo y de GitHub (`httptest`): importación parcial y reanudación, token no aparece en logs/BD (prueba de búsqueda), SSRF, espejo con credencial cifrada.
- **Riesgos / no verificable**: migración real desde GitHub y push mirror real; límites de la API de GitHub.

### C2. Notificaciones completas, auditoría e insights
- **Alcance**: lectura de `audit_logs` (`auditLog`, CSV, filtros) con nuevas acciones; `git_activity`, `activityList`, `insights`; digest diario; avisos de caducidad de tokens y supresiones; retención.
- **Posee**: `backend/internal/gitaudit/**`, `backend/internal/gitinsights/**`, `handlers/audit.go`, `insights.go`.
- **Migraciones**: 000055-000056. **Depende de**: A5, A6, A7, B7.
- **Aceptación**: contra Postgres real: paginación por cursor estable con 100 000 filas, filtros, permiso `org.admin`, inmutabilidad (no hay API de borrado), cálculo de medianas con casos conocidos.
- **Riesgos / no verificable**: correo real (SES) y volumen real de eventos.

### C3. Recuperación total
- **Alcance**: `DR-BACKUP.md` completo: comando/endpoint `recover` (`gitRecoverPlatform`, `recoverProject`), plan/aplicar/verificar, orden de operaciones, idempotencia, verificación de integridad, simulacro periódico con informe, respaldo de Forgejo con `forgejo dump` cada 6 h y de la plataforma (manifiestos 000032), scripts de restauración en instancia efímera.
- **Posee**: `backend/internal/recovery/**`, `backend/internal/server/handlers/recover.go`, `cli/cmd/capsule/recover.go` (acordado con B2: C3 lo escribe, B2 solo registra), `deploy/recovery/**` (scripts), `deploy/terraform/recovery_drill.tf` (solo plan).
- **Migraciones**: 000057. **Depende de**: A1, 000032 (existente), C2 (auditoría).
- **Aceptación**: `recover plan` determinista (misma entrada, mismo plan) con pruebas de tabla; paso idempotente repetido dos veces sin efectos dobles (Postgres real y directorios temporales); verificación de checksums y fallo ante manifiesto manipulado; simulacro en contenedores locales (Postgres + Forgejo + MinIO como S3) restaurando desde un respaldo generado en la propia prueba, con informe.
- **Riesgos / no verificable**: restauración real de RDS, S3, EC2 y DNS; RPO/RTO reales hasta ensayarlos en AWS (no se hace en esta fase).

## 4. Dependencias y orden

```
A1 ──┬─ A2 ──┬─ A4 ──┬─ B1 ── (integra B2, B3, B4, B5)
     │       │       └─ B8
     ├─ A5 ──┼─ A6 ──┐
     └─ A7 ──┘       ├─ B7 ── B6 (plantillas) ── C1 ── C2 ── C3
A3 (paralelo, sin dependencias) ───────────┘
```

Camino crítico a la primera entrega usable (E1): A1 -> A2/A4/A7 -> B1 -> integración B3/B4/B5. A3, A5, A6, B6, B7, B8 corren en paralelo a esa línea y alimentan los bloques de Seguridad, Entornos y Ajustes. Web y CLI no esperan a B1: trabajan contra el mock del OpenAPI.

## 5. Huecos entre contratos ya entregados y este plan (a resolver al integrar)

1. 000030 (`git_core_state`, `git_team_sync`): su cliente de Forgejo y las vistas de ramas/commits/PR deben **migrar a `gitcore` (A1)**; hasta que A1 exista conviven. No renombrar tablas.
2. Las rutas de `git/repo|branches|commits|pulls` y de `previews create/delete`, `ports`, `backups` que consume el CLI no estaban en `router.go`: B1 y los agentes respectivos deben cumplir la forma del OpenAPI o corregirlo en el mismo PR.
3. `GitHandler` usa `OrgRoleAuthorizer`: A2 lo sustituye.
4. El CLI ya trae `members`, `ports`, `backups`, `oauth`: no se reimplementan; B2 solo registra los grupos nuevos y respeta los nombres.
5. Las plantillas `security-audit.yml` (issue único) y Renovate con dashboard se ajustan (B7/B6).
6. Hay que decidir (A7) el scope de tokens `cap_` nuevos (`git:read`, `git:write`, `security:write`) respetando el modelo actual de `user/tokens`.
