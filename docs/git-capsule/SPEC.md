# Git Capsule: especificación

Estado: borrador 0.1 (2026-11-02). Autor: arquitectura/PM. Solo documentación: nada de lo aquí descrito como "nuevo" existe aún.
Convención de marcas: **(V)** verificado leyendo documentación oficial o código del repo en esta sesión; **(?)** por verificar, con la ruta exacta a mirar.

## 1. Visión y principios

Git Capsule es la capa de Git, revisión de código, CI/CD y seguridad de Capsule. Se ve y se siente como GitHub (rutas, pestañas, vocabulario), con marca propia y con una diferencia estructural: **Capsule es la autoridad** de identidad, permisos, despliegue, aprobaciones y seguridad; **Forgejo es el motor** de Git (repos, ramas, PR, Actions, webhooks) y nunca se expone como producto aparte.

Principios (orden de prioridad cuando chocan):

1. **Una sola fuente de permisos.** Roles viewer/deployer/admin de Capsule (`backend/internal/authz`) mandan; los equipos de Forgejo son una proyección sincronizada, nunca editada a mano.
2. **Forgejo hace lo que ya hace bien; Capsule añade solo lo que Forgejo no tiene** (entornos con aprobación, seguridad, SARIF, políticas que bloquean merge/deploy, auditoría unificada, DR). No se reimplementa Git ni un visor de diff completo en v1.
3. **Los repos viven en el dashboard (decisión del dueño, principio de producto).** La experiencia principal es nativa en `https://app.tumi-ai.com/git` (navegación, sesión y diseño de Capsule, marca Git Capsule), no una web aparte. Forgejo es el motor (almacenamiento, protocolos, merges, protecciones, equipos, Actions) y `git.tumi-ai.com` es el HOST de clonado (HTTPS/SSH) y respaldo de administración, igual que github.com sirve UI y protocolo. Una pantalla tiene un solo dueño (el dashboard); Forgejo solo cubre lo que el dashboard aún no tiene (sección 4.2, entregas).
4. **Fallar cerrado.** Si Capsule no puede evaluar una política (Forgejo caído, SARIF corrupto, aprobador no resuelto), el merge/despliegue protegido se bloquea y se explica por qué.
5. **Nada de secretos globales ni confianza en contenido de PR.** El CI corre código no confiable en runners aislados (sección 6).
6. **Todo por API primero.** UI y CLI consumen `API.openapi.yaml`; no hay lógica solo en la web.
7. **Idempotente y reanudable**: aprovisionamiento, sincronización de equipos, subidas SARIF y recuperación se pueden repetir sin efectos dobles.

Fuera de alcance v1 (decidido): Issues y Projects propios, Wiki, Packages/Container registry de Forgejo, Gists, Discussions, Pages, Codespaces, Copilot, marketplace de Actions propio, federación (ActivityPub), multi-instancia de Forgejo.

## 2. Qué existe hoy (no se rediseña)

Verificado en el repo (V):

| Pieza | Dónde | Notas para esta spec |
|---|---|---|
| Forgejo como servicio del núcleo, Caddy, SSH 22 público / 2200 admin, respaldo `forgejo dump` cifrado a S3 | `deploy/forgejo/README.md`, `docker-compose.prod.yml` | Forgejo con SQLite en un volumen del mismo host (t3.medium, 4 GB). 768 MB de memoria. |
| Login OIDC Capsule -> Forgejo, `ACCOUNT_LINKING=disabled`, claim `groups` (`org:<slug>`, `org:<slug>:<rol>`, `project:<org>/<project>:<rol>`) | `backend/internal/oidc`, `deploy/forgejo/README.md` §4-6 | Username Forgejo = claim `nickname`. Mapa de grupos a equipos es solo respaldo. |
| Roles por proyecto y modo de acceso de org (`open`/`restricted`) | migración 000028, `authz/authz.go`, `handlers/project_members.go` | Acciones actuales: `project.read/deploy/env_write/env_reveal/ops/databases/network/members/delete`. No hay acciones `git.*`. |
| Enlace Git por proyecto (auto-deploy, previews por PR), webhook entrante firmado, SSRF, clon limitado | 000029, `gitsource/*`, `service/gitdeploy.go`, `service/preview.go`, `handlers/git.go`, `git_hooks.go` | Webhook `POST /hooks/git/{projectID}`; `X-Forgejo-Signature`/`X-Hub-Signature-256`. Hoy `OrgRoleAuthorizer` (no usa roles de proyecto) es el autorizador por defecto de `GitHandler`: **hueco 1**. |
| Estado de aprovisionamiento Git del núcleo y cola de sincronización de equipos | 000030 (`git_core_state`, `git_team_sync`) | Otro agente lo está terminando; el cliente Forgejo y las vistas de ramas/commits/PR no estaban montadas en `router.go` al leer. |
| Puertos TCP extra con reglas por IP | 000031 (`project_ports`, `project_port_rules`), `netaccess/*` | Fuera de esta spec salvo DR. |
| Respaldos de datos con manifiestos | 000032 (`backup_settings`, `backup_runs`, `backup_snapshots`) | `kind IN ('backup','restore','verify')`; `project_id NULL` = plataforma. Base de `DR-BACKUP.md`. |
| Salud de deploys, rollback, límites de build | 000033 | Entra en entornos (estado de despliegue). |
| Plantillas de CI y seguridad (gitleaks, ci-node, deps, terraform, trivy, sast, security-audit, dependency-updates, capsule-deploy), Renovate, SAST con reglas propias | `deploy/forgejo/{workflows,renovate,sast}` | Base de la pestaña Seguridad. `security-audit.yml` publica **un issue** por repo: pasará a alertas (sección 5.8). |
| Acciones de CI de Capsule | `actions/{deploy,preview,rollback,vars,wait-healthy,templates}` | Plantilla `forgejo-ci-cd.yml` existe. |
| Runner aislado en EC2 aparte (Terraform, apagado por defecto) | `deploy/forgejo/README.md` §8 | Etiquetas `ci`, `node22`; sin docker.sock; kaniko para imágenes. |
| CLI | `cli/cmd/capsule/{gitcmd,oauthmembers,portsbackups,ciforgejo,ciinit}.go` | `git link/show/remote/unlink/test/repo/branches/commits/pulls/previews`, `members`, `ports`, `backups`. |
| Dashboard | `frontend/app/(dashboard)/{git,projects,...}`, `components/{git-tab,ci-tab,ci-badge,members-tab,backups-tab,ports-tab}.tsx` | Tokens de color en `app/globals.css` (sección UX). |

### 2.1 Conflictos y huecos entre contratos ya entregados y esta spec

1. **Autorización de Git.** `GitHandler` usa `OrgRoleAuthorizer` (owner/admin/member escriben; readonly no) y ignora `project_members`. Debe sustituirse por `authz` (CanManage = `project.ops`, CanDeploy = `project.deploy`) y añadir acciones `git.*` (API: `x-permissions`). Hasta entonces un `viewer` de proyecto con rol de org `member` ve y gestiona Git: incoherente con "viewer = solo lectura".
2. **Roles vs. permisos Forgejo.** `admin` y `deployer` mapean ambos a permiso `write` en Forgejo (`deploy/forgejo/INTEGRATION.md` §b). Forgejo no distingue entonces quién edita protecciones de rama, secretos o webhooks: eso lo decide **Capsule** (`git.admin`) y ejecuta con el token de servicio. Consecuencia: **nadie debe tener admin de repo en Forgejo salvo el bot**; un admin de proyecto que entra a la UI de Forgejo no verá "Ajustes" (permiso write, no admin). Esto es deliberado y debe escribirse en los equipos (unidades del equipo sin `repo.settings`; (?) confirmar con `units_map` en swagger v15).
3. **Roles de Capsule sin equivalente de Forgejo.** Org `readonly` en modo `restricted` sin fila explícita es "Hidden": no debe tener equipo ni verse el repo. La sincronización debe **quitar** al usuario del equipo y el repo debe ser privado (ya lo es).
4. **Identidad.** `capsule_user -> forgejo_username` no existe como tabla: 000030 solo guarda pendientes (`git_team_sync`). Hace falta `git_identities(user_id, forgejo_user_id, forgejo_username, linked_at)` poblada en el primer login OIDC y por reconciliación (paquete A2).
5. **Nombres en API.** El router usa `{orgID}`/`{projectID}` (UUID). El encargo hablaba de `{o}/{p}`: se mantiene `{orgID}/{projectID}` y los CLI aceptan slug/ID corto. Todo lo de repo vive bajo `/orgs/{orgID}/projects/{projectID}/git/...`; `/api/v1/git/...` queda para operaciones de plataforma (estado, reconciliación, recuperación). Un repo = un proyecto en v1.
6. **Repos sin despliegue.** Hoy no existe un proyecto "solo código". v1: un proyecto puede tener runtime `none` (el modelo de proyecto debe admitirlo (?) verificar `domain/project.go` y `projects` en migraciones) para repos de librerías o de plataforma (`platform/sast`, `platform/renovate-config`).
7. **Webhook entrante.** Solo reconoce push/pull_request. Se extiende el mismo endpoint (no se crea otro) a `pull_request_review`, `status`, `workflow_run` (paquete A5). Todo evento nuevo debe seguir validando firma antes de parsear y respondiendo 2xx rápido.
8. **Previews**: el contexto de commit-status que publica `service/gitdeploy.go` (`SetStatus`) debe poder marcarse como check requerido (`capsule/preview`) por las reglas de protección.
9. **Rutas de previews/ports/backups** consumidas por el CLI (`previewsCreate`, `ports`, `backups`) no estaban en `router.go` al leer; este plan las referencia con `x-status: in-progress`/`(?)` y no las define.
10. **Migraciones.** 000029 (git), 000030 (core), 000031 (ports), 000032 (backups), 000033 (health) están tomadas. Este plan empieza en **000034**.
11. **Audit.** `authz.AuditEntry` escribe `audit_logs`, pero no hay API de lectura ni eventos git/seguridad: se añade (paquete C2).

## 3. Arquitectura y reparto de responsabilidades

```
Usuario ─ navegador ─> Dashboard app.tumi-ai.com/git (Next.js) ──API v1──> Backend Capsule (Go) ──token servicio (+Sudo)──> Forgejo (API v1)
                 └──(respaldo: "Abrir en Forgejo", OIDC sin fricción)──> git.tumi-ai.com (Forgejo con tema Git Capsule)
Usuario ─ git/ssh ─────────────────────────────────────────> git.tumi-ai.com:443/22
Forgejo ─ webhooks firmados ─> /hooks/git/{projectID} ─> Capsule (cola) ─> despliegues, previews, checks, notificaciones
Runners aislados <── Forgejo Actions ── SARIF/artefactos ──> Capsule /security/sarif (token CI de alcance mínimo)
```

Reglas del reparto:

- **Capsule backend** posee: autorización, mapeo identidad, política de protección (fuente de verdad en su BD, proyectada a Forgejo), entornos/aprobaciones/promociones, seguridad (alertas, supresiones, políticas), notificaciones, webhooks salientes, auditoría, importación, espejo, DR. Habla con Forgejo solo desde un paquete (`backend/internal/gitcore`, paquete A1) con cliente tipado, reintentos con backoff, timeouts y mapeo de errores a `UPSTREAM_GIT_ERROR`.
- **Forgejo** posee: almacenamiento Git, ramas/etiquetas, PR (estado, commits, diff, revisiones, comentarios), CODEOWNERS (solicitud automática de revisiones), reglas de protección **aplicadas** en push/merge, Actions (workflows, runners, logs), webhooks de origen.
- **Para actuar en nombre del usuario** (comentarios, revisiones, aprobaciones) el backend usa token de servicio con cabecera `Sudo: <forgejo_username>` ((V) mencionada en `INTEGRATION.md` como técnica; (?) confirmar disponibilidad y alcance del token admin en `/api/swagger` v15.0.11: parámetro `sudo` y `Sudo` header). Así la autoría en Forgejo es la real y el permiso lo decide Capsule antes de llamar. Si Sudo no funciona con el alcance elegido, plan B: acción con el token del bot y firma "en nombre de @usuario" en el cuerpo (peor: pierde autoría y CODEOWNERS por revisor).
- **Reconciliación**: eventos (alta/cambio/baja de rol, creación de proyecto) más un job periódico que compara estado deseado vs. real en Forgejo (equipos, protecciones, webhooks del repo, variables) y corrige deriva. La deriva detectada se audita.

### 3.1 Qué hace Forgejo nativamente vs. qué construye Capsule (resumen)

| Área | Nativo en Forgejo | Capsule encima |
|---|---|---|
| Repos, ramas, etiquetas | Sí. Protección de etiquetas con glob/regex y usuarios/equipos permitidos (V: forgejo.org/docs/latest/user/protection/) | Orquestación, nombres, rama por defecto, API/CLI unificada |
| Protección de ramas | Reglas por patrón glob (`/` separa, `**` cruza; sin glob gana sobre con glob) (V). Opciones concretas (aprobaciones, checks, firmas, listas blancas) no figuran en esa página: **(?)** verificar en `/api/swagger` v15.0.11 (`CreateBranchProtectionOption`) y en `forgejo.org/docs/latest/user/` | Modelo propio `branch_protection_rules`, proyección a Forgejo, evaluación previa (`/protections/evaluate`), políticas de seguridad y de entorno como condiciones extra (solo Capsule puede bloquear por ellas: ver 5.3) |
| PR | Revisiones aprobar/pedir cambios, comentarios en línea y por rango, revisión de un commit, solicitud de revisores, CODEOWNERS en raíz, `docs` o `.forgejo` con regex Go y reglas negativas `!` (V: user/pull-requests-and-git-flow) | Vistas en dashboard, check agregado, auto-merge y mergeabilidad explicada, borrador, notificaciones |
| Estrategias de merge, borrador, auto-merge al pasar checks, sugerencias | **(?)** la página de PR no los documenta; mirar `forgejo.org/docs/latest/user/` (índice) y `/api/swagger` (`MergePullRequestOption`: `Do`, `merge_when_checks_succeed`) | Si falta alguno, Capsule lo implementa con cola propia (5.4) |
| Actions | Workflows en `.forgejo/workflows` con respaldo `.github/workflows`; runners por instancia/propietario/repo; reutilizables (`workflow_call`), matrix (incluida dinámica), concurrency, `workflow_dispatch`, `pull_request_target`, secretos y variables de repo, OIDC con `enable-openid-connect` (V: user/actions/overview, reference, security, github-actions) | Logs/estado en dashboard, secretos/variables de org y de entorno (5.6), enmascarado propio, políticas de fork |
| Entornos de despliegue y aprobaciones | **No documentado/no existe**: `jobs.<id>.environment` solo aparece en la tabla de contextos; la doc no describe aprobaciones (V: user/actions/reference) | 100 % Capsule (5.7) |
| Cache y artefactos de Actions | **(?)** no descritos en la referencia; mirar `forgejo.org/docs/latest/user/actions/` (páginas "Advanced features") y `admin/actions/` | Si faltan: caché por servidor propio del runner y artefactos vía S3 (5.6) |
| Alertas de seguridad, SARIF, Dependabot, escaneo de secretos | **No hay equivalente conocido** en Forgejo (**(?)** confirmar en notas de versión v15) | 100 % Capsule (5.8) |
| Webhooks | Destinos Forgejo/Gitea/Gogs, Packagist, SourceHut, Matrix, Slack, Discord, DingTalk, Telegram, Teams, Feishu, WeCom; firma `X-Forgejo-Signature` HMAC-SHA256 (V: user/webhooks); eventos de PR no documentados ahí (?) | Webhooks **salientes de Capsule** con eventos de producto (despliegue, aprobación, seguridad) y correo |
| Issues/Projects/Wiki/Packages | Sí | Se desactivan por unidades de repo/equipo (5.9) |
| Auditoría | Registro de sitio solo para admins | `audit_logs` de Capsule + lectura por API |

## 4. Aspecto "como GitHub pero Git Capsule"

### 4.1 Qué dice la documentación de personalización de Forgejo (V)

- Base: carpeta `custom` del directorio de trabajo, sobreescribible con `FORGEJO_CUSTOM` o `--custom-path`; configuración en `$FORGEJO_CUSTOM/conf/app.ini` (forgejo.org/docs/latest/contributor/customization/).
- Plantillas: `$FORGEJO_CUSTOM/templates/` (p. ej. `home.tmpl`); ganchos `templates/custom/{header,extra_links,extra_links_footer,extra_tabs}.tmpl`; correo en `templates/mail/`. Estáticos: `public/assets/` se sirve en `/assets/`; solo `robots.txt`, `manifest.json`, `.well-known/` y `assets/` se exponen.
- Logo y favicon: se reemplazan `assets/logo.svg`/`favicon.svg` en el código fuente y `make generate-images` produce `logo.svg/png`, `favicon.svg/png`, `avatar_default.png`, `repo_default.png`, `apple-touch-icon.png` que se colocan en `custom/public/assets/img/`. Con imagen oficial (sin compilar) se puede **colocar directamente** esos archivos con el mismo nombre en `custom/public/assets/img/` (**(?)** confirmar que la imagen los sirve desde ahí sin recompilar).
- CSS propio: el gancho documentado es `templates/custom/header.tmpl`. No hay carpeta de CSS dedicada en la doc.
- Config: `[DEFAULT] APP_NAME`, `APP_SLOGAN`, `APP_DISPLAY_NAME_FORMAT`; `[ui] DEFAULT_THEME` (por defecto `forgejo-auto`; también `forgejo-light`, `forgejo-dark`, `auto`, `gitea`, `arc-green`) y `THEMES` (V: admin/config-cheat-sheet; la hoja de configuración tiene más texto sin leer (?) offset 100000: claves `[actions]`).
- Aviso oficial: personalizar plantillas, logos y archivos públicos es **"unsupported"**: las actualizaciones pueden romperlo sin avisar (V: admin/customization). La configuración (`APP_NAME`, `[ui]`) sí es estable.
- Mecanismo de tema propio (CSS `theme-*.css` + `THEMES`): **(?)** no figura en las páginas leídas. Mirar `forgejo.org/docs/latest/admin/` y el repo `codeberg.org/forgejo/forgejo` (`web_src/css/themes/`, `docs`); en Gitea es `custom/public/assets/css/theme-<nombre>.css` más `THEMES`.
- Locales: `custom/options/locale` es inferencia ((?) verificar en el código, directorio `options/locale`) para renombrar cadenas.

### 4.2 Decisión: el dashboard es la superficie primaria; Forgejo es motor y respaldo

Principio (dueño): los repos viven en `app.tumi-ai.com/git/{org}/{repo}`, con la sesión, navegación y diseño de Capsule. El dashboard implementa **todas** las pantallas de repo y consume la API de Capsule, que a su vez llama a Forgejo con el token de servicio y la identidad del usuario (cabecera `Sudo`, sección 3). Forgejo no es el producto visible.

Papel de la UI web de Forgejo (`git.tumi-ai.com`): **respaldo y administración avanzada**. Decisión: se muestra a **todo usuario autenticado** con tema Git Capsule (SSO OIDC, `REQUIRE_SIGNIN_VIEW=true`), porque quien tiene rol write ya accede por protocolo y ocultarla solo añadiría un modo de fallo si el dashboard se rompe; pero **no está en la navegación** ni se promueve: aparece como enlace "Abrir en Forgejo" en las pantallas aún incompletas (tabla de entregas) y para administradores de plataforma. Allí el usuario tiene los permisos de su equipo (write/read; nadie es admin de repo salvo el bot), de modo que las acciones de gobierno (protecciones, secretos, webhooks, miembros) solo se hacen desde Capsule.

Reparto de pantallas por entrega (detalle en `WORKBREAKDOWN.md`):

| Superficie | Entrega 1 (primera usable) | Entrega 2 | Entrega 3 |
|---|---|---|---|
| Código: explorador de archivos y visor con resaltado (README, blob, historial de ruta) | **Dashboard** | Blame | - |
| Ramas y etiquetas | **Dashboard** | - | - |
| Commits y diff de commit | **Dashboard** (diff unificado de solo lectura) | Diff dividido | - |
| Pull requests: lista, conversación, caja de merge, checks, aprobar/pedir cambios, comentarios generales | **Dashboard** | - | - |
| Pull requests: **revisión línea a línea** (comentarios en línea, sugerencias) | enlace "Abrir en Forgejo" (`html_url`) | **Dashboard** | Aplicar sugerencias |
| Editor web de archivos / subir archivos | enlace "Abrir en Forgejo" | - | **Dashboard** (editar y hacer commit en rama) |
| Actions: lista de runs, logs, relanzar, dispatch | **Dashboard** | Gráfico de jobs | - |
| Seguridad, Entornos, Aprobaciones, Ajustes (protecciones, webhooks, secretos, miembros), Tokens de acceso | **Dashboard** (no existen en Forgejo) | - | - |
| Comparación avanzada, blame (entrega 1), wiki, administración del sitio | Forgejo | Forgejo | Forgejo |

Consecuencias: (1) el tema de Forgejo sigue siendo necesario (respaldo y enlaces) pero con inversión mínima: config + logo + variables CSS; (2) la navegación entre ambos es continua (SSO first-party); (3) la API es la misma en todas las entregas: `/pulls/{n}/files` ya devuelve parches y `reviewCreate` ya acepta comentarios en línea, así que llevar la revisión línea a línea al dashboard (entrega 2) no cambia el contrato; (4) los datos de Forgejo se **proxifican con paginación, caché y límites** en el backend (paquetes A1/B1), nunca se exponen sus URLs de API al navegador.

#### Alternativas evaluadas para servir Forgejo "dentro" del dashboard

| Opción | Pros | Contras |
|---|---|---|
| **A. Subdominio propio `git.tumi-ai.com` (actual) + dashboard nativo** | Ya construido (Caddy, OIDC, SSH); cookies y CSRF de Forgejo aisladas del dashboard; sin cambios de ROOT_URL; URLs de clonado limpias (`git@git.tumi-ai.com:org/repo.git`); un fallo de una app no tumba la otra | Dos orígenes (se mitiga con SSO y diseño común); "Abrir en Forgejo" sale a otro host |
| B. Forgejo bajo subruta del dashboard (`app.tumi-ai.com/forge/`, `ROOT_URL` con ruta) | Mismo dominio en la barra de direcciones | Subruta de Forgejo: **(?)** verificar soporte y salvedades en `forgejo.org/docs/latest/admin/` (proxy inverso/subruta); hay que enrutar `/forge/*` desde el origen de Next.js (memoria y latencia); cambian redirecciones OIDC, webhooks y URLs de clonado (rompe repos ya configurados) y el SSH sigue necesitando otro host; cookies del mismo sitio mezclan superficies (un XSS en una plantilla de Forgejo alcanzaría el dashboard) |
| C. iframe del mismo origen | Parece integrado | Forgejo envía `X-Frame-Options`/CSP `frame-ancestors` restrictivos por defecto (**(?)** clave en `[security]` del cheat-sheet) y aflojarlos habilita clickjacking; cookies de terceros bloqueadas si el origen difiere; foco, scroll, enlaces profundos y móvil malos |
| D. Proxy inverso que reescribe el HTML de Forgejo | Control total del aspecto | Frágil, mantenimiento alto, inseguro |

**Recomendación: A.** Dashboard nativo como superficie primaria, `git.tumi-ai.com` como host de protocolo y respaldo en subdominio propio, sin subruta ni iframe: mínima superficie de ataque y cero migración.


Cómo se logra la marca en Forgejo, en orden de estabilidad:
1. **Config estable**: `APP_NAME=Git Capsule`, `APP_SLOGAN`, `[ui] DEFAULT_THEME=git-capsule-dark` (si el mecanismo (?) existe; si no, `forgejo-dark`), `THEMES` reducido a los de la marca.
2. **Activos**: logo/favicon en `custom/public/assets/img/` (SVG textual "Git Capsule", sección UX §Marca).
3. **CSS vía `header.tmpl`** con variables CSS de la paleta del dashboard (`--bg-base: #000`, `--accent: #7c3aed`…) sobrescribiendo las variables de color de Forgejo (**(?)** nombres reales de variables CSS: mirar `web_src/css/themes/theme-forgejo-dark.css` en el repo). Se elige variables sobre CSS de selectores para minimizar rotura entre versiones.
4. **Plantillas (inestable)**: solo `extra_links*.tmpl`, `header.tmpl` y `home.tmpl`/login. No se copia plantillas completas. Cada subida de `GIT_VERSION` pasa un **test de humo visual** (paquete A3: Playwright contra Forgejo efímero) y el directorio `custom/` vive en el repo (`deploy/forgejo/custom/`) y se monta de solo lectura.
5. Ocultar lo no soportado: `[ui]`/`[repository]` y unidades por defecto de repo (`DEFAULT_REPO_UNITS=repo.code,repo.pulls,repo.actions`; **(?)** clave y valores en cheat-sheet) y `DISABLE_*` (stars, forks, explore: **(?)** claves exactas).

Riesgo reconocido: las partes 3-5 son "no soportadas" por Forgejo; la mitigación es el test visual en cada actualización y mantener la superficie de plantillas mínima.

## 5. Funcionalidad por área

Notación de permisos: v = viewer, d = deployer, a = admin (rol de proyecto); "org a" = owner/admin de la org. Equipo Forgejo: `<proyecto>-viewer` (read), `-deployer` y `-admin` (write). Acciones nuevas definidas en `API.openapi.yaml` (`x-permissions`). Estados: hecho / ajustar / nuevo / fuera.

### 5.0 Mapa de paridad

| Funcionalidad GitHub | Equivalente Git Capsule | Estado |
|---|---|---|
| Organizaciones | Organizaciones de Capsule = org de Forgejo con el mismo slug (provisionada por proyecto, INTEGRATION §a) | hecho (backend 000030) / ajustar (identidades) |
| Repositorios | 1 repo Forgejo por proyecto Capsule | hecho (000030) |
| Repos sin despliegue | Proyecto runtime `none` | ajustar |
| Ramas, etiquetas | `/git/branches`, `/git/tags` | hecho (lista) / nuevo (crear/borrar) |
| Reglas de protección de rama | `/git/protections` (modelo propio + proyección a Forgejo) | nuevo |
| PR obligatorio / aprobaciones mínimas / checks requeridos | Opciones de la regla | nuevo (nativo (?) + Capsule) |
| CODEOWNERS | Archivo nativo + resolución a usuarios Capsule + aviso de sintaxis GitHub | ajustar |
| Commits firmados opcional | `require_signed_commits` (?) nativo | nuevo |
| Historial lineal | Estrategias permitidas (solo rebase/ff) + regla | ajustar (no nativo (?)) |
| Eliminar rama al fusionar | Ajuste de repo/regla | nuevo |
| Pull requests (revisiones, comentarios, sugerencias, draft, estrategias, auto-merge) | `/git/pulls...` | hecho (lista) / nuevo |
| Issues, Projects, Wiki, Discussions | Ocultos (desactivar unidades) | fuera de alcance |
| Actions (sintaxis, runners, matrices, reutilizables) | Forgejo Actions en runners aislados | hecho (infra) / ajustar (UI) |
| Secretos y variables org/repo/entorno | repo nativo; org y entorno Capsule (5.6) | nuevo |
| Artefactos, caché | (?) soporte del runner; si no, S3 | nuevo/(?) |
| Entornos y aprobaciones | Modelo Capsule (5.7) | nuevo |
| Previews por PR | `/previews` | hecho |
| Pestaña Seguridad (Dependabot, code scanning, secret scanning) | Renovate + osv-scanner, Semgrep+reglas propias, gitleaks, trivy, SARIF API, políticas y supresiones (5.8) | nuevo |
| Insights, actividad, gráficos de contribución | `/activity`, `/insights` | nuevo |
| Notificaciones | In-app + correo + Slack/Discord | nuevo |
| Webhooks salientes | Capsule los emite (firmados) | nuevo |
| Auditoría | `/audit-log` | nuevo |
| Importar desde GitHub | `/orgs/{o}/git/imports` (usa migración nativa de Forgejo (?)) | nuevo |
| Espejo a GitHub | `/git/mirror` (push mirror nativo (?)) | nuevo opcional |
| API y CLI | OpenAPI + `capsule git/pr/branch/...` | ajustar |
| Forks y colaboración externa | Sin forks en v1 (solo ramas dentro del repo); PRs de forks bloqueados | fuera de alcance |
| Dependency graph / SBOM | osv-scanner genera lista (5.8); SBOM CycloneDX vía trivy opcional | nuevo opcional |
| Sponsors, Packages, Pages, Codespaces | — | fuera de alcance |

### 5.1 Repos y organizaciones

- Comportamiento: crear proyecto crea (si no existe) org Forgejo con el slug, equipos base y repo privado `auto_init`, con rama `main`, y registra webhook de push/PR firmado (INTEGRATION §a). Estado visible en `/git/repo` (`provision_status`, `last_error`); se reintenta con backoff (`git_core_state`).
- Reglas: slug inmutable tras crear el repo (renombrar rompe URLs y webhooks; v1 no lo permite); borrado = archivar, nunca `DELETE /repos` salvo confirmación y respaldo reciente (INTEGRATION). Org con modo `restricted`: sin fila explícita no hay equipo.
- Casos límite: el slug existe en Forgejo pero no en Capsule (huérfano) -> no se adopta automáticamente, error `GIT_NOT_READY` con instrucción de administrador; proyecto creado con Forgejo caído -> proyecto usable sin Git, reintento en segundo plano, banner en UI.
- Permisos: crear/archivar = `project.ops`/`project.delete`; leer = viewer.
- Nativo vs. Capsule: Forgejo guarda; Capsule decide cuándo y quién.

### 5.2 Ramas y etiquetas

- Crear/borrar rama (`git.write`); no se puede borrar la rama por defecto ni una protegida; la protección de etiquetas es nativa: regla `v*` con solo equipo `-admin` (V).
- Casos límite: nombre inválido (reutiliza `gitsource.ValidBranch`), ramas con `/`, rama borrada con PR abierto (cierra el PR; se avisa antes).
- Rama por defecto: cambiarla exige `git.admin` y revalida protección y webhook de auto-deploy (`project_git.branch`).

### 5.3 Reglas de protección de rama

Modelo `branch_protection_rules(project_id, pattern, …)` en Capsule (paquete A3/A4; campos en `ProtectionInput`). Se proyecta a Forgejo con el token de servicio y se reconcilia.

| Opción | Dónde se aplica | Estado nativo |
|---|---|---|
| PR obligatorio (bloquea push directo) | Forgejo (lista blanca de push vacía) | (?) swagger |
| Aprobaciones mínimas, descartar aprobaciones obsoletas, bloquear con revisiones rechazadas | Forgejo | (?) swagger: `required_approvals`, `dismiss_stale_approvals`, `block_on_rejected_reviews` |
| Checks requeridos (con glob) | Forgejo | (?) `enable_status_check`, `status_check_contexts` |
| Revisión de CODEOWNERS obligatoria | Forgejo (`block_on_official_review_requests`) o Capsule | (?) |
| Commits firmados | Forgejo | (?) `require_signed_commits` |
| Historial lineal | Capsule: solo estrategias `rebase`/`fast-forward` permitidas en el repo; push de merge commits no se puede impedir de forma nativa | no nativo (?) |
| Rama al día antes de fusionar | Forgejo | (?) `block_on_outdated_branch` |
| Bloquear force-push y borrado | Forgejo (por defecto de protegida) | (V general) |
| Aplicar a admins | Forgejo (`apply_to_admins`) | (?) |
| **Política de seguridad que bloquea merge** | **Capsule**: check `capsule/security` requerido (5.8) | nuevo |
| **Entorno requerido antes de fusionar a rama de release** | Capsule: check `capsule/env:<nombre>` | nuevo |
| Eliminación automática de rama | Ajuste de repo | (?) `default_delete_branch_after_merge` |

Reglas: la regla sin glob gana sobre la que lo tiene (V). Conflicto entre reglas de Capsule (dos patrones que solapan) se evalúa igual y `evaluate` explica. Un admin que quiera saltarse una regla debe quitarla (queda auditado); no hay "bypass" silencioso (`enforce_for_admins` por defecto true). Permisos: lectura = viewer; escritura = `git.admin`. Caso límite: regla creada sobre rama que no existe aún (válido, patrón futuro); cambio que dejaría la rama por defecto sin protección en proyectos con entorno production -> aviso.

Los checks "requeridos" que Capsule publica como commit status: `capsule/preview`, `capsule/security`, `capsule/policy`, `capsule/env:<nombre>`; los de CI son contextos de Actions. La UI muestra cuáles faltan.

### 5.4 Pull requests

- Crear, editar, borrador, marcar listo, solicitar revisores, revisar (aprobar/pedir cambios/comentar) con comentarios en línea y sugerencias, comentar, actualizar rama, fusionar, auto-merge.
- Mergeabilidad (`Pull.mergeable`): Capsule calcula `can_merge` y `blockers` (`CHECKS_REQUIRED`, `REVIEWS_REQUIRED`, `CODEOWNER_REQUIRED`, `CONFLICTS`, `BRANCH_OUT_OF_DATE`, `POLICY_BLOCKED`, `DRAFT`, `SIGNATURE_REQUIRED`, `APPROVAL_REQUIRED`) combinando el estado nativo y lo propio. Un solo lugar para "por qué no puedo fusionar".
- Estrategias: `merge`, `squash`, `rebase`, `fast-forward` (**(?)** mapa exacto a `Do` de Forgejo: `merge|rebase|rebase-merge|squash|fast-forward-only|manually-merged`). El repo restringe cuáles se ofrecen.
- Borrador: si Forgejo lo soporta nativamente (prefijo `WIP:` en título (?)), se usa; si no, `draft` se guarda en Capsule y el check `capsule/policy` bloquea hasta `ready`.
- Auto-merge: nativo "fusionar cuando los checks pasen" ((?) `merge_when_checks_succeed`). Si falta o no cubre políticas Capsule, Capsule mantiene `auto_merge` en BD y un worker reintenta el merge cada vez que llega un evento `status`/`pull_request_review`/`workflow_run`; condición de carrera resuelta con `head_sha` (409 si el cabezal cambió).
- Sugerencias: bloque ` ```suggestion ` en comentario en línea (nativo (?): la doc dice que el botón de comentario en línea puede "sugerir una modificación"). "Aplicar sugerencia" se hace en la UI de Forgejo en v1.
- PR de forks: **no soportados** (no hay forks; ver 6.4).
- Permisos: ver/comentar según matriz (comentar = `git.review`: deployer y admin; viewer solo lee); aprobar requiere ser revisor válido: quien abrió el PR no cuenta para el mínimo (aplicado por Forgejo; (?) verificar `self-approval`); fusionar `git.merge` (deployer/admin) sujeto a la regla; descartar revisión `git.admin`.
- Casos límite: PR cuya rama base se renombra; revisor cuyo rol cambió (su aprobación sigue válida salvo `dismiss_stale_approvals`; si pierde acceso al proyecto se descartan sus revisiones pendientes y se re-solicita); commit nuevo tras aprobación (aprobación obsoleta si la regla lo pide); merge mientras el despliegue de preview está en curso (el preview se cierra tras merge: `closePreview`).

### 5.5 Issues y proyectos

Decisión: **se ocultan** (desactivar unidades `repo.issues`, `repo.projects`, `repo.wiki`, `repo.packages` en repos y equipos; INTEGRATION hoy da `repo.issues` a equipos: **cambiar**). Razones: duplicarían el seguimiento que el usuario ya tiene fuera, ampliarían la superficie de permisos y moderación, y Capsule no los necesita para el ciclo de código→despliegue. Excepción técnica: el repo de plataforma usa un issue único de `security-audit.yml` hoy; con alertas propias (5.8) ese flujo se retira. Si más adelante se quisiera, se habilita por proyecto sin cambio de API (`repo.issues` es una unidad). Renovate requiere que el repo acepte el "Dependency Dashboard": **(?)** Renovate crea un issue de dashboard; si Issues está desactivado Renovate lo omite (config `dependencyDashboard: false`); decisión: `dependencyDashboard=false` y estado en la pestaña Seguridad.

### 5.6 Actions: workflows, runners, secretos, variables

- Sintaxis y capacidades nativas: ver 3.1. Plantillas de `deploy/forgejo/workflows` y `actions/templates/forgejo-ci-cd.yml` se ofrecen como "Nuevo workflow" (paquete B4).
- Runners: infraestructura de `deploy/forgejo/README.md §8`. Dos etiquetas: `ci` (confiable: ramas del repo, jobs con secretos) y, si se activa PR de contribuidores no admins, `ci-untrusted` en **otra** instancia sin secretos ni red a la VPC (paquete B4). La UI solo lista runners (lectura).
- Secretos y variables: repo nativos (V). **Org**: Forgejo los admite a nivel de propietario ((?) `forgejo.org/docs/latest/user/actions/` página de secretos devolvió 404 en esta sesión; verificar `/api/swagger`: `/orgs/{org}/actions/secrets`, `/orgs/{org}/actions/variables`); la API de Capsule los ofrece en `/orgs/{orgID}/git/secrets|variables` y los escribe en la org de Forgejo. **Entorno**: Forgejo no tiene secretos de entorno; Capsule los inyecta **solo en el paso de despliegue** (token `capsule deploy`), no en CI; los secretos de entorno no existen en Forgejo, evitando que un PR los lea.
- Enmascarado: el runner "intenta" ocultar secretos (V, mejor esfuerzo); Capsule enmascara de nuevo valores de secretos conocidos en `jobLogs` antes de servirlos y decide que el viewer ve logs de CI (los jobs con secretos solo corren en ramas protegidas, ver T3).
- Artefactos y caché: **(?)** estado real; mientras no se verifique, la spec define: artefactos hasta 14 días en S3 (paquete B4) y caché local del runner. Verificar en `forgejo.org/docs/latest/user/actions/` y `admin/actions/` (`[actions] ARTIFACT_RETENTION_DAYS`, `storage.artifacts`).
- Permisos: ver ejecuciones = viewer; relanzar/cancelar/dispatch = deployer; secretos/variables de repo = admin; de org = org admin.
- Casos límite: runner sin etiqueta disponible (cola con aviso "sin runners en línea"); workflow en `.github/workflows` (se ejecuta por respaldo (V): la UI lo muestra con insignia); `pull_request_target` se **prohíbe** por lint de política (6.3).

### 5.7 Entornos de despliegue y aprobaciones (todo Capsule)

Forgejo no tiene aprobaciones de despliegue (V: ausentes en la referencia de Actions). Modelo:

- **Entorno** = política con nombre sobre un proyecto/repo (`environments`): `kind` (staging/production/other), `target_project_id` (el proyecto Capsule que recibe el despliegue: puede ser el mismo para un solo entorno o un proyecto hermano para staging), patrones de rama/etiqueta que pueden desplegar, `reviewers` (usuarios o roles), `required_approvals`, `allow_self_approval` (false), `wait_minutes`, `windows` (días y horas con zona), `require_source_environment` (solo promover SHAs exitosos en staging), `require_checks_on_sha`.
- **Promoción** = solicitud de desplegar un SHA (o el artefacto ya construido) a un entorno. Estados: `pending_approval -> waiting -> approved -> deploying -> success|failed`; salidas `rejected|cancelled|expired`. Caduca a las 72 h sin decisión.
- Flujo: `capsule-deploy` (acción) o la API crea la promoción; Capsule evalúa en orden: rama permitida, checks verdes del SHA, política de seguridad, entorno origen, **aprobaciones** (N distintas, ninguna del solicitante), **espera**, **ventana**; solo entonces llama al flujo de despliegue existente (el mismo de `capsule deploy`). Se reutiliza el artefacto: promover staging→producción **no recompila** (mismo `source` en S3), de modo que lo probado es lo desplegado.
- Aprobadores: `env.approve` se concede por la lista del entorno, no por rol; un admin de proyecto no aprueba si no está listado (evita que quien configura se apruebe solo). Pendientes visibles en `/orgs/{o}/approvals` y por notificación.
- Historial: `environment_deployments` + auditoría (quién pidió, quién aprobó/rechazó, comentario, SHA, checks en el momento).
- Rollback: reutiliza el rollback existente (000033/acción `rollback`) y puede saltarse espera/ventana pero **no** aprobación si la política lo exige (`rollback_requires_approval`, por defecto false para producción: caso de emergencia).
- Permisos: ver = viewer; solicitar = deployer; configurar = `env.admin` (admin); aprobar = `env.approve`.
- Casos límite: aprobador pierde acceso -> su aprobación ya dada se conserva, nuevas no; cambio de política con promociones pendientes (se re-evalúan; las pendientes que ya no cumplan pasan a `cancelled` con motivo); SHA reescrito (force-push imposible en protegida; si ocurre, la promoción se invalida); dos promociones simultáneas al mismo entorno (una cola por entorno, la segunda espera; `Idempotency-Key` evita duplicados); ventana que cierra durante `waiting` (pasa a `waiting` hasta la próxima ventana, con caducidad global).
- Previews por PR (hecho) son entornos efímeros implícitos (`kind=preview`), sin aprobación.

### 5.8 Seguridad

Forgejo no ofrece alertas, SARIF ni escaneo integrado (**(?)** confirmar no existe en notas de versión v15). CodeQL queda descartado por licencia (decisión del dueño).

Fuentes de alertas:

| Tipo | Herramienta | Disparo | Ingesta |
|---|---|---|---|
| Dependencias | osv-scanner (`workflows/security-audit.yml`, hoy abre issue) + Renovate `vulnerabilityAlerts`/`osvVulnerabilityAlerts` (PR de seguridad) | programado semanal + en PR a rama protegida | SARIF (osv-scanner admite `--format sarif` (?) verificar) o JSON propio -> `/security/sarif` |
| Código (SAST) | Semgrep OSS + reglas propias (`deploy/forgejo/sast/rules`), gosec, Bandit, eslint-security | en PR y push a rama protegida | SARIF 2.1.0 |
| Secretos | gitleaks | en push/PR | SARIF; el valor **nunca** se almacena: solo huella, ruta, línea y regla |
| Imágenes/IaC | trivy | en PR/por programación | SARIF |
| Otras herramientas | cualquiera que emita SARIF | — | `tool_name` libre, `sarif-other` |

Ingesta (`POST /security/sarif`): token de CI con alcance `security:write` limitado a **un proyecto** (como el token `deploy` existente, `capsule tokens create --scope`), gzip+base64 hasta 10 MiB comprimido, `commit_sha` + `ref`; procesamiento asíncrono; huella estable (rule_id + ruta + hash de contexto, o `partialFingerprints` del SARIF) para deduplicar entre subidas; una alerta desaparece (`fixed`) cuando una subida posterior de la misma herramienta y rama por defecto ya no la contiene. Validación estricta del esquema, límites de tamaño/recursión y límite de alertas por subida (5000) para evitar abuso; SARIF no confiable: se trata como datos, nunca se renderiza HTML de mensajes (se escapa Markdown).

Severidades: `critical|high|medium|low|info` con mapeo: Semgrep ERROR=high, WARNING=medium (ya fijado en `sast/README.md`), gosec/Bandit tal cual, CVSS de osv: ≥9 critical, ≥7 high, ≥4 medium, <4 low; gitleaks siempre `high` (`critical` si el patrón es de proveedor de nube).

Supresiones: por alerta (`dismiss`) o regla (`suppressions`), con **motivo enumerado, justificación ≥10 caracteres y caducidad obligatoria** (máx. 365 días; 180 para critical/high). Al caducar la alerta vuelve a `open` y se notifica 7 días antes (`security.suppression.expiring`). Supresión por huella en una rama aplica a la misma huella en otras; la ruta glob no puede ser `**`. Quién: `security.triage` (deployer/admin); **dismiss de critical/high exige admin** (`security.admin`) salvo política distinta. Todo queda en auditoría.

Políticas (`security_policies`): `block_merge_on` por tipo y severidad mínima, `block_deploy_on`, herramientas requeridas, ramas aplicables. Aplicación: check `capsule/security` (pending mientras falte la subida de una herramienta requerida; failure si hay alertas abiertas no suprimidas ≥ umbral en el diff del PR frente a la rama base). Solo alertas **nuevas** del PR bloquean (comparación de huellas contra la base) para no bloquear por deuda previa; la política de despliegue sí mira alertas abiertas en el SHA. Fallar cerrado: si la herramienta requerida no subió resultados en 30 min, el check queda en failure con mensaje.

Renovate: bot autoalojado con cuenta de servicio no admin (`deploy/forgejo/renovate`). Capsule añade: activar/desactivar por repo (marca el topic `renovate` o excluye), estado de onboarding, PR abiertos, y botón "ejecutar ahora" (cron/`capsule crons trigger`). `dependencyDashboard=false` (5.5). Los PR de Renovate pasan por las mismas protecciones; el automerge solo de parches de devDependencies con checks verdes (política ya definida en `default.json`).

UI: pestaña Seguridad con resumen, lista filtrable, detalle con traza, historial de supresiones y política (UX.md). Permisos: ver = viewer, salvo las alertas de tipo secreto, de las que el viewer solo ve contadores (ruta y regla las ven deployer y admin; el valor nunca se guarda).

### 5.9 Insights, actividad, notificaciones, webhooks, auditoría

- Actividad por repo: push, ramas, PR, revisiones, merges, despliegues, aprobaciones, alertas. Fuente: eventos entrantes + eventos Capsule en `git_activity`.
- Insights: contribuciones, tiempo a primera revisión y a merge (mediana), frecuencia de despliegue y tasa de despliegues fallidos. Cálculo en Capsule desde su tabla de eventos (no se pide a Forgejo).
- Notificaciones: bandeja in-app, correo (SES ya existe en el backend de email (?) verificar `handlers/email.go`), Slack/Discord. Preferencias por evento y canal; resumen opcional diario.
- Webhooks salientes: sobre firmado `X-Capsule-Signature: sha256=hex(HMAC(secreto, timestamp+"."+cuerpo))` más `X-Capsule-Timestamp`, ID de entrega estable, reintentos con backoff, SSRF vía `gitsource/ssrf.go`, rotación con ventana de 24 h, desactivación al recibir 410. Catálogo de eventos y esquema: `API.openapi.yaml` (`x-webhook-events`, `webhooks`). Slack/Discord: mensaje formateado, no el sobre; URL entrante cifrada. Correo: lista de destinatarios, plantilla fija.
- Auditoría: se reutiliza `audit_logs`; se añaden acciones (`git.protection.change`, `env.approval.decide`, `security.alert.dismiss`, `webhook.*`, `repo.settings.change`, `member.role.change`, `recovery.run`). Lectura `GET /orgs/{o}/audit-log` (org admin). Retención ≥ 400 días.

### 5.10 Importación desde GitHub y espejo

- Importación: Forgejo tiene migración desde GitHub (repo, y opcionalmente issues/PR/releases/etiquetas) con token ((?) `/api/swagger`: `POST /repos/migrate`, servicio `github`; ya hay precedente: `gitRepoCmd --import-url`). Capsule la envuelve: token efímero (nunca persistido ni en logs), crea proyectos, estado por repo, y convierte **CODEOWNERS** de GitHub (sintaxis glob) avisando de lo no equivalente (Forgejo usa regex Go (V)) y conserva `.github/workflows` (se ejecutan por el respaldo (V)) marcando acciones externas no resolubles. Sin issues si Issues está oculto (se importan como archivo adjunto/lista en el reporte).
- Espejo opcional hacia GitHub: push mirror nativo de Forgejo ((?) `POST /repos/{o}/{r}/push_mirrors`); credencial (token de GitHub) cifrada en Capsule; solo ramas configuradas; no sincroniza PR ni revisiones. Desactivado por defecto; riesgo: salida de código privado a un tercero, por eso exige `git.admin` y auditoría, y la UI avisa.

## 6. Modelo de amenazas del Git

Activos: código privado (de EVVG y clientes), credenciales de servicio, secretos de CI/entorno, integridad de `main` y de lo desplegado, disponibilidad del Git y del CI.

### 6.1 Resumen

| # | Amenaza | Vector | Mitigación en esta spec | Estado |
|---|---|---|---|---|
| T1 | Robo del token de servicio `CAPSULE_GIT_TOKEN` (admin de Forgejo) | Fuga de logs/imagen/variables; RCE en el backend | Alcance mínimo, solo en el backend, rotación trimestral y bajo demanda, redacción en logs, nunca en variables de proyecto; token distinto por función (aprovisionamiento / lectura de checks / Renovate / issues) | Pendiente de implementar (A1) |
| T2 | SSRF vía URL de repo/webhook/mirror/import | URL controlada por usuario | `gitsource/ssrf.go` ya bloquea IP privadas y re-resuelve; se aplica a webhooks salientes, espejo e importación; sin redirects a hosts no validados; Forgejo `GIT_WEBHOOK_ALLOWED_HOSTS=external,private` solo porque el receptor es Capsule: no ampliar | Hecho para clones; extender (A5, C1) |
| T3 | Ejecución de CI no confiable | PR/rama maliciosa ejecuta código en el runner | Runner EC2 aparte, sin ingreso, IMDSv2 hop 1, sin docker.sock, límites, egreso 80/443/53/123 (hecho); jobs con secretos solo en ramas protegidas; **lint de workflows** (rechaza `pull_request_target`, `permissions` excesivos, `curl|sh`) como check requerido de `.forgejo/workflows/**` vía CODEOWNERS; runner efímero por job a futuro (documentado) | Parcial |
| T4 | Secretos en logs | `echo $SECRET`, artefactos | Enmascarado del runner (mejor esfuerzo (V)) + re-enmascarado de Capsule + gitleaks sobre artefactos/logs de ramas; secretos de entorno solo en el paso de despliegue | Nuevo |
| T5 | PR de forks / colaboradores externos | Código externo con acceso a secretos | v1 sin forks ni cuentas externas (registro cerrado, OIDC solo Capsule); si se habilitan: `pull_request` de fork no recibe secretos y token de solo lectura (V) y requiere aprobación de ejecución ((?) existe en Forgejo; verificar `forgejo.org/docs/latest/admin/actions/`) | Mitigado por diseño |
| T6 | Abuso de `pull_request_target` | Ejecuta código de la base con secretos y token de escritura (V) | Prohibido por lint; el token por job ya es de repo (V) | Nuevo |
| T7 | Escalada de rol vía deriva Forgejo/Capsule | Equipos desincronizados | Reconciliación periódica + auditoría de deriva; al quitar rol se quita del equipo y se descartan revisiones pendientes; ningún humano es admin de repo en Forgejo | A2 |
| T8 | Vinculación de cuentas | `ACCOUNT_LINKING` por email | Se mantiene `disabled` hasta que Capsule garantice email verificado y único | Hecho |
| T9 | Webhook falso/replay | POST a `/hooks/git/{id}` | HMAC en tiempo constante antes de parsear, límite de tamaño, idempotencia por `X-Forgejo-Delivery` (INTEGRATION), el secreto por proyecto cifrado | Hecho (verificar idempotencia (?) en `git_hooks.go`) |
| T10 | SARIF malicioso | Subida con tamaños/anidación enormes o HTML | Esquema estricto, límites, escape de contenido, token de alcance mínimo, tasa por proyecto | Nuevo |
| T11 | Aprobación suplantada o auto-aprobación | Solicitante aprueba su propio despliegue | `allow_self_approval=false` por defecto, aprobadores nombrados, auditoría, comentario obligatorio al rechazar | Nuevo |
| T12 | Robo de sesión/2FA | Cuenta de administrador | Login solo por Capsule; 2FA exigido a administradores de plataforma y a la cuenta de emergencia (CHECKLIST); Capsule debe ofrecer 2FA propio ((?) hoy no confirmado: verificar `handlers/auth.go`) | Pendiente |
| T13 | Fuerza bruta SSH/HTTPS | Puerto 22 y 443 públicos | fail2ban, `MaxStartups`, solo llaves, límite de tasa de Caddy (A3) | CHECKLIST |
| T14 | Compromiso del host con Forgejo + Capsule | Mismo host: Forgejo tiene `.env` y docker.sock del backend cerca | Mover Forgejo a instancia propia antes de abrir CI amplio (decisión 3); mientras, 768 MB, usuario no root, red `capsule-net` sin docker.sock en el contenedor Git | Decisión |
| T15 | Pérdida/corrupción de repos | Disco, error | Dump cifrado diario, simulacro (DR-BACKUP.md), versionado S3 | Parcial |
| T16 | Cadena de suministro de herramientas del CI | Imágenes/acciones comprometidas | Versiones fijadas, por digest; acciones de CI resueltas desde la propia instancia (`DEFAULT_ACTIONS_URL` (?)), Renovate fija SHAs | Parcial |
| T17 | Exfiltración vía espejo/import | Admin configura espejo a un tercero | `git.admin`, auditoría, aviso, credenciales cifradas | Nuevo |
| T18 | Reglas de Semgrep del registro: licencia | Uso como servicio a terceros | Ver decisión 4 del dueño | Decisión |

### 6.2 Credenciales y rotación

- Tokens de servicio en gestor de secretos del backend (cifrados en reposo con la clave de plataforma, KMS más adelante según memoria del proyecto); fecha de rotación en tabla `platform_credentials(name, rotated_at, expires_at)` y alerta a 30 días.
- Rotación del secreto de webhook por proyecto: botón/`rotate`; Forgejo se actualiza vía API del hook y el backend acepta ambos 24 h.
- **Acceso de clientes Git (push/pull) sin sesión de navegador.** Los usuarios son solo-OIDC (sin contraseña) y `POST /users/{u}/tokens` de Forgejo exige BASIC del propio usuario (V, INTEGRATION §c), así que Capsule no puede emitir tokens de Forgejo con sudo. Diseño en 6.5: credential helper + tokens de Git de Capsule autenticados en el borde.
- 2FA: administradores de plataforma obligatorio; cuenta de emergencia obligatorio.

### 6.5 Acceso de clientes Git: `capsule git login`, credential helper y "Tokens de acceso"

Objetivo: `git clone/push https://git.tumi-ai.com/org/repo.git` funciona con credenciales de corta duración emitidas por Capsule; la sesión del navegador nunca se usa en Git.

**Diseño recomendado (autenticación en el borde, sin tokens de Forgejo):**
1. Capsule emite **tokens de Git** (`cgt_...`) en su BD (`git_access_tokens`: hash SHA-256, usuario, alcance `read|write`, proyectos permitidos opcional, `expires_at`, `last_used_at`, `revoked_at`). Dos tipos: **efímeros** (1 h por defecto, máx. 12 h) que pide el credential helper, y **de acceso** (con nombre, caducidad 7 a 90 días) creados en la pantalla "Tokens de acceso" para CI externo y scripts.
2. Caddy (`git-proxy`) aplica `forward_auth` hacia `http://backend:8080/internal/git-auth` en las rutas de Git por HTTP; el backend valida el BASIC (`usuario:cgt_...`), comprueba el rol de proyecto (read/write) y responde con la cabecera `X-WEBAUTH-USER: <forgejo_username>` (si la credencial no empieza por `cgt_`, responde 2xx sin esa cabecera para que Forgejo autentique OAuth2/otros por su cuenta); Caddy la reenvía a Forgejo, que debe tener autenticación por proxy inverso ((?) `[service] ENABLE_REVERSE_PROXY_AUTHENTICATION` y la variante de API; verificar en el cheat-sheet que cubre git-over-HTTP y que el autoregistro por proxy queda desactivado). **Caddy debe eliminar `X-WEBAUTH-USER` de toda petición entrante** antes de `forward_auth`, y Forgejo solo debe ser alcanzable por Caddy o la red interna: si alguien llega a Forgejo sin pasar por Caddy podría suplantar a cualquiera (riesgo grave; decisión 1 del dueño). Las protecciones de rama siguen aplicándose en Forgejo.
3. **Plan B** si el proxy inverso no cubre git-over-HTTP o el dueño no acepta ese riesgo: Capsule fija una contraseña aleatoria de uso interno por usuario (API admin de usuarios, (?) verificar), crea tokens de Forgejo `capsule-{id}` con BASIC y los **borra** al caducar (job). Inconvenientes: los tokens de Forgejo no caducan de forma nativa (?), hay contraseñas internas que rotar y más piezas móviles.
4. **SSH**: las llaves públicas se gestionan desde Capsule (`/user/git-ssh-keys`), que las registra en Forgejo con la API admin (`POST /admin/users/{u}/keys`, (?) verificar). El usuario no necesita entrar a Forgejo.

**CLI y credential helper** (CLI.md §3.1): `capsule git login` usa la sesión del CLI, comprueba el acceso y ejecuta `git config --global credential.https://git.tumi-ai.com.helper "!capsule git credential"`; `capsule git credential get|store|erase` implementa el protocolo de helpers de Git: en `get` llama a `POST /user/git-credentials` y devuelve `username=<nick>` y `password=<token efímero>`; `store` y `erase` no hacen nada. El token no se guarda en disco.

**Dashboard**: `Ajustes de cuenta > Tokens de acceso` y `Llaves SSH`: crear (nombre, alcance, proyectos, caducidad; el valor se muestra una sola vez), listar con último uso, revocar, aviso 7 días antes de caducar. La revocación surte efecto en el siguiente request (validación por `forward_auth`, caché máxima 30 s).

Amenazas y mitigación: robo de token (corta vida, alcance, revocación, solo hash en BD, último uso e IP en auditoría); fuerza bruta (32 bytes aleatorios y límite de tasa por IP en `/internal/git-auth`); caída de Capsule (Git por HTTP deja de autenticar; SSH sigue funcionando y existe la cuenta de emergencia).

#### 6.5.1 El botón "Código/Clonar": tres pestañas

| Pestaña | Contenido | Credencial |
|---|---|---|
| **Clonar con Capsule** (recomendada) | `capsule git clone <org>/<repo>`; si no hay CLI, enlace de instalación (`npm i -g @kyntocg/capsule-cli`, V en `docs/AGENT_PROMPT.md`) y `capsule login` | Token efímero `cgt_` ligado a la **sesión activa del CLI** |
| **Clonar con Git** (HTTPS) | `git clone https://git.tumi-ai.com/<org>/<repo>.git`, más las líneas de configuración de Git Credential Manager (6.5.2) y enlace a "Tokens de acceso" como plan B | OAuth2 de Forgejo vía navegador (GCM) o token personal `cgt_` como contraseña |
| **SSH** | `git clone git@git.tumi-ai.com:<org>/<repo>.git`, enlace a "Llaves SSH" | Llave del usuario (sincronizada por Capsule) |

`capsule git clone` hace: (1) comprobar sesión (`capsule login` si falta); (2) `git config --global credential.https://git.tumi-ai.com.helper "!capsule git credential"` y `credential.https://git.tumi-ai.com.useHttpPath true` (para que Git entregue `path=org/repo` y el token sea **por repo**); (3) `git clone` de la URL HTTPS sin credenciales en la URL. Después `git push/pull` siguen funcionando mientras la sesión del CLI viva: cada `credential get` pide `POST /user/git-credentials`; si el token vigente caduca en menos de 10 min se emite otro (renovación automática, sin preguntar). Al hacer `capsule logout` o al revocarse la sesión, los tokens efímeros de esa sesión se revocan.

Propiedades del token efímero (`kind=ephemeral`): alcance mínimo = **un repo** y `read` o `write` (write solo si el rol del proyecto es deployer/admin; el rol se re-evalúa en **cada** validación, de modo que quitar un rol corta el acceso en <= 30 s); expiración 1 h (máx. 12 h por política); revocable (individual o por sesión); auditado (emisión, primer uso, revocación; IP y último uso visibles al usuario); ligado a usuario y sesión; nunca válido para la API de Capsule ni de Forgejo (solo Git por HTTP).

#### 6.5.2 "Clonar con Git" y Git Credential Manager contra Forgejo (investigado)

Fuentes leídas (V): documentación de GCM `docs/generic-oauth.md` (github.com/git-ecosystem/git-credential-manager) y `forgejo.org/docs/latest/user/oauth2-provider/`.

- GCM soporta **proveedores OAuth genéricos** con claves `credential.<url>.oauthClientId` (obligatoria), `oauthClientSecret` (opcional), `oauthRedirectUri` (por defecto `http://127.0.0.1`, debe ser HTTP y apuntar a localhost), `oauthAuthorizeEndpoint`, `oauthTokenEndpoint` (absolutos o relativos al host), `oauthDeviceEndpoint` (opcional: activa el flujo de dispositivo), `oauthScopes`, `oauthResponseMode`, `oauthDefaultUserName` (por defecto `OAUTH-USER`) y `oauthUseClientAuthHeader`. Flujos: navegador con redirección a loopback y flujo de dispositivo si hay endpoint. La página no habla de variables de entorno, de refresh tokens ni de Gitea/Forgejo.
- Forgejo como **proveedor OAuth2**: endpoints `/login/oauth/authorize`, `/login/oauth/access_token`, `/login/oauth/userinfo`, `/login/oauth/keys`, descubrimiento `/.well-known/openid-configuration`; **solo** concesión de código de autorización con PKCE y extensiones OIDC (sin flujo de dispositivo, sin client credentials documentado); ejemplos de respuesta con `expires_in: 3600` y `refresh_token`; **los scopes no están implementados** y la propia doc avisa de que una app con token tiene derechos amplios (administrativos si el usuario es admin); los tokens OAuth2 sirven como contraseña de Git por HTTP; **Git Credential Manager y git-credential-oauth están preconfigurados en el servidor** con un client ID fijo igual en todas las instancias; clientes públicos con PKCE usan loopback `127.0.0.1` con cualquier puerto (no `localhost`).
- Conclusión: **sí es viable** el flujo "git clone abre el navegador -> Entrar con Capsule -> vuelve el token" sin crear tokens a mano. El usuario llega a Forgejo, que ya delega el login en Capsule por OIDC first-party (sin pantalla de consentimiento), Forgejo emite el token OAuth2 y GCM lo guarda y renueva con el refresh token.
- Qué registrar y cómo se provisiona: **nada que registrar**: las aplicaciones de GCM y git-credential-oauth vienen preregistradas en Forgejo (V). El ID fijo de cliente y los endpoints se muestran en el diálogo como líneas de `git config`; los valores exactos del client ID **(?)** deben copiarse de `forgejo.org/docs/latest/user/oauth2-provider/` y probarse contra la instancia (no se transcriben de memoria). `capsule git setup-gcm` escribe esas claves con `git config --global`. Para clientes propios (p. ej. una futura app de escritorio) se registraría una aplicación en `/user/settings/applications`; **(?)** no se conoce API de administración para registrar aplicaciones OAuth2 a nivel de instancia (mirar `/api/swagger`: `POST /user/applications/oauth2` es por usuario); por eso la v1 no registra nada propio.
- Líneas que muestra el diálogo: `git config --global credential.https://git.tumi-ai.com.oauthClientId <ID-preregistrado>`, `...oauthAuthorizeEndpoint /login/oauth/authorize`, `...oauthTokenEndpoint /login/oauth/access_token`, `...oauthRedirectUri http://127.0.0.1` (más `provider generic` si GCM lo exige, **(?)** confirmar en la doc de GCM sobre selección de proveedor).
- Riesgos propios de esta ruta (por eso no es la recomendada):
  1. **Sin alcance**: el token da los derechos del usuario en Forgejo, no "un repo con read/write" (en la práctica, los de su equipo; **para administradores de plataforma sería administrativo**: no usar esta ruta con cuentas admin, usar SSH o la ruta Capsule).
  2. **No lo gobierna Capsule**: no aparece en "Tokens de acceso", la revocación es en Forgejo (`/user/settings/applications`), no se liga a sesión de CLI y su auditoría es la de Forgejo. Mitigación: Capsule puede revocar por API admin si Forgejo lo permite ((?) verificar) y el rol sigue controlado por equipos sincronizados.
  3. **Interacción con `forward_auth` (6.5)**: `/internal/git-auth` debe responder 2xx **sin** cabecera `X-WEBAUTH-USER` cuando la credencial no empieza por `cgt_`, para que Forgejo autentique los tokens OAuth2 por su cuenta.
  4. Equipos sin navegador (servidores, WSL sin navegador, contenedores) no pueden usarla: Forgejo no ofrece flujo de dispositivo (V).

#### 6.5.3 Ruta recomendada por sistema operativo y cómo se muestra

Decisión: **la ruta recomendada en todos los SO es "Clonar con Capsule"** (auditada, con alcance por repo, rol re-evaluado, renovación automática, revocable, funciona sin navegador en el host de clonado). "Clonar con Git" queda como alternativa sin instalar nada de Capsule:

| SO | Primera opción en el diálogo | Alternativa | Notas |
|---|---|---|---|
| Windows | Capsule | Git + GCM (suele venir con Git for Windows (?) verificar versión mínima en la doc de GCM) | GCM abre el navegador sin instalar más |
| macOS | Capsule | Git + GCM (`brew install --cask git-credential-manager` (?)) o git-credential-oauth | GCM no viene con Git de Apple |
| Linux | Capsule | git-credential-oauth (paquete de la distro (?)) o GCM | En servidores sin navegador: token personal o SSH |
| Cualquiera sin navegador / CI | SSH o token personal | - | Sin flujo de dispositivo en Forgejo (V) |

Detección de SO opcional (`navigator.userAgentData?.platform` con respaldo a `navigator.userAgent`): solo ordena las pestañas y muestra el comando de instalación adecuado; todas las opciones siguen accesibles. Sin detección o con SO desconocido: orden Capsule, Git, SSH.

#### 6.5.4 Plan B cuando GCM no está instalado

Token personal creado en el dashboard (`Ajustes de cuenta > Tokens de acceso`), usado como **contraseña** HTTPS con el usuario Forgejo mostrado; vale `forward_auth` (prefijo `cgt_`). Alcance (read/write), proyectos opcionales y caducidad (máx. 90 días) obligatorios, valor visible una sola vez, revocable y auditado.

#### 6.5.5 CI y runners: nunca la sesión de un humano

- Checkout en Actions: el token por ejecución que crea Forgejo (V: único por run, lee el repo aunque sea privado, no ve otros repos, muere al terminar).
- Pushes/etiquetas/lecturas de otros repos desde CI: **token de servicio** (`kind=service`, `POST /orgs/{o}/projects/{p}/git/service-tokens`): creado por un admin del repo, no ligado a un humano, alcance `read|write` a **un repo**, caducidad máx. 90 días con aviso y rotación, guardado como secreto de CI (nunca variable), nunca puede tocar ramas protegidas más allá de lo que permitan las reglas. Las automatizaciones que llaman a la API de Capsule siguen usando tokens `cap_` con alcance (`deploy`, `security:write`).
- Los runners no tienen `capsule login`; se prohíbe por política de workflows (6.3) montar `~/.capsule` o usar credenciales de usuarios.

#### 6.5.6 Forks y PRs

- v1 no tiene forks (6.4): los PR salen de ramas del propio repo, así que el mismo token del repo basta. Los tokens **nunca** dan acceso a repos distintos del indicado en su `path`.
- Para probar un PR localmente: `capsule pr checkout N` (`git fetch origin pull/N/head` (?) verificar que la referencia existe en Forgejo) con el mismo credential helper, con alcance `read` bastante.
- Si en el futuro se admiten forks: un token de lectura del repo base no concede lectura del fork ni viceversa; los PR de forks no reciben secretos ni token de escritura en CI (V: `pull_request` de fork, secretos vacíos y token de solo lectura).

### 6.3 Política de workflows (lint)

Un job de plantilla `workflow-policy` (en `deploy/forgejo/workflows`) rechaza: `pull_request_target` sin lista aprobada, `permissions: write-all`, secretos pasados a pasos de terceros no fijados por SHA, `runs-on` que no sea etiqueta registrada, acciones sin fijar por SHA/digest, `curl ... | sh`. Es check requerido en la regla de `.forgejo/workflows/**` (CODEOWNERS a admins).

### 6.4 PRs de forks

v1: desactivados (`ALLOW_FORKS`/fork deshabilitado en repos; **(?)** clave `[repository] DISABLE_FORKS` o permiso por org). Sin cuentas externas, no hay vector de fork.

## 7. Marca (resumen; detalle en UX.md)

Nombre "Git Capsule" (dos palabras, G y C mayúscula), logo textual `⬡ Git Capsule` (hexágono o cápsula en `#7c3aed`), tono técnico, directo, en español de producto; sin la palabra "demo". Iconografía de línea 1.5 px. Colores: tokens del dashboard actual.

## 8. Decisiones que necesita el dueño

(Solo lo que no puede decidirse sin el dueño.)

1. **¿Se acepta la autenticación de Git por proxy inverso (cabecera `X-WEBAUTH-USER` de confianza) en Forgejo?** Es lo que permite tokens de Git de corta duración emitidos por Capsule sin contraseñas internas (6.5). Riesgo: cualquier camino a Forgejo que no pase por Caddy permite suplantar usuarios. Recomendación: **sí**, con Caddy borrando la cabecera entrante, Forgejo sin puerto publicado (ya así) y prueba de regresión en CHECKLIST; si no se acepta, plan B de 6.5.
2. **Presupuesto de infraestructura para aislar Forgejo y el CI.** Hoy Forgejo y Capsule comparten un t3.medium. Recomendación: antes de abrir CI a más de 2-3 proyectos, mover Forgejo a su propia instancia (t3.small/medium) con volumen EBS con snapshots, y mantener un solo runner compartido `ci` (confiable) más uno `ci-untrusted` solo si habrá PR de gente fuera del estudio.
3. **¿Git Capsule es solo para uso interno del estudio/EVVG, o lo usarán clientes terceros?** Condiciona la licencia de las reglas Semgrep del registro (la licencia prohíbe ofrecerlas como servicio (V: `sast/README.md`), así que con terceros se usarían solo reglas propias), el aislamiento multi-inquilino de runners y 2FA obligatorio. Recomendación: tratar v1 como **interno**, con solo reglas propias en la oferta a terceros desde ya.
4. **Aprobación de producción: ¿quién aprueba y cuántas aprobaciones?** Recomendación por defecto para `production`: 1 aprobación de un admin distinto del solicitante, espera 0, ventana libre, `allow_self_approval=false`; en proyectos con un solo admin, el flujo exige una segunda persona designada (si no existe, el dueño debe nombrarla o aceptar autoaprobación auditada).
5. **RPO/RTO objetivo del Git y de la plataforma** (afecta coste y frecuencia de respaldo). Recomendación: RPO 6 h para repos (dump cada 6 h en lugar de diario) y RTO 4 h para la plataforma completa, con simulacro mensual (DR-BACKUP.md).
