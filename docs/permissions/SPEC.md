# Motor de usuarios y permisos de Capsule: especificación

Estado: DISEÑO (fase sin código). Fecha: 2026-11-03.
Documentos hermanos: `MIGRATION.md`, `API.openapi.yaml`, `UX.md` (+ `mockups/`), `CLI.md`, `WORKBREAKDOWN.md`, `SKILL-CHANGES.md`.

Petición del dueño: permisos atómicos (proyectos, repos, etc.), plantillas y grupos, y un sidebar que dependa de lo que cada
persona puede hacer. Decisiones ya tomadas por el dueño: permisos atómicos + plantillas + grupos + sidebar por permisos.
Regla de diseño: no se añade nada que el modelo base no necesite (sin ABAC genérico, sin lenguaje de políticas).

## 0. Qué existe hoy (leído del código, no supuesto)

| Pieza | Dónde | Comportamiento real |
|---|---|---|
| Roles de organización | `org_members.role` (000002), `handlers/org_members.go` | **Cuatro**, no tres: `owner`, `admin`, `member`, `readonly` (`validMemberRoles` = admin/member/readonly; owner nace con la org y es intocable). `organizations.owner_id` duplica al owner. |
| Roles de proyecto | `authz/authz.go`, `project_members` (000028) | `viewer`, `deployer`, `admin`. Fila explícita por (proyecto, usuario). |
| Modo de acceso | `organizations.project_access_mode` `open`/`restricted` | Global a la organización. En `open`, `member` hereda `deployer` y `readonly` hereda `viewer` en todos los proyectos; en `restricted` solo ven los proyectos con fila. |
| Decisión | `authz.Resolve(orgRole, mode, explicit)` | owner/admin => admin siempre (una fila explícita NO los baja). `readonly` => nunca más que viewer aunque la fila diga admin (techo oculto). `member` con fila => la fila SUSTITUYE al rol heredado (puede bajar a viewer). Rol de org desconocido => oculto. Sin acceso => 404 (no filtra existencia); visible sin permiso => 403. |
| Acciones | `authz.AllActions` (9) + `GitActions` (13) + `GatewayActions` (1) | `project.read/deploy/env_write/env_reveal/ops/databases/network/members/delete`; `git.read/write/review/merge/admin`, `security.read/triage/admin`, `env.read/request/admin/approve`, `webhooks.manage`; `project.connect`. `env.approve` no está en ningún rol: la decide la lista de aprobadores del entorno (usuarios o rol de proyecto). |
| Chequeos fuera del motor | `org_members.go`, `org.go`, `orgenv.go`, `audit.go`, `project.go` | Acciones de organización (invitar, cambiar rol, quitar, variables de cuenta, auditoría `org.admin`, renombrar/borrar org) son `if callerRole == "owner"/"admin"` sueltos. No hay catálogo. |
| Tokens `cap_` | `api_tokens.scopes` (CSV), `middleware/scope.go` | Alcances `*`, `deploy`, `security:write`. `deploy` y `security:write` SON LISTAS DE RUTAS parseadas del path (`deployRouteAllowed`), no permisos. El token además pasa por el rol del dueño. |
| Tokens Git `cgt_` | `git_access_tokens` (000044), `gittokens/` | `scope read/write` + `project_ids[]`; el rol se reevalúa en cada uso (`roleAllows`). Servicio: `user_id` NOT NULL, se evalúa como el creador. |
| Tokens gateway `cgs_` | `gateway_service_tokens` (000063) | Un proyecto, opcional un servicio, solo `project.connect`, <= 90 días. `created_by` ON DELETE SET NULL: sobreviven al creador. |
| Usuario de plataforma | `users.role` (000001), `handlers/admin.go` | `admin` (plataforma) o `member`; LA SUSPENSIÓN SE GUARDA COMO `role = 'suspended'` y `SetUserRole` acepta cualquier cadena. |
| Proyección a Forgejo | `gitsync/reconcile.go`, `oidc/service.go` | 3 equipos por proyecto `<slug>-viewer/-deployer/-admin` (admin y deployer = permiso `write` en Forgejo); claim `groups`: `org:<slug>`, `org:<slug>:<rol>` (lo arma `oidc.groups`) y `project:<org>/<proj>:<rol>` (lo arma `authz.ProjectGroups`, inyectado por `ExtraGroups`). |
| Auditoría | `audit_logs` (000010, 000055), `handlers/audit.go` | Solo `GET`; no hay forma HTTP de editar o borrar filas. |
| Frontend | `sidebar.tsx`, `lib/members.ts`, `stores/auth.ts` | Menú estático con dos banderas: `adminOnly` (`user.role === 'admin'`) y `orgAdminOnly` (rol en alguna org). `useProjectRole` deriva el rol de la lista de miembros del proyecto, que solo puede leer un admin del proyecto (`ProjectMembers`): para el resto devuelve `null` y la UI "se queda permisiva". |

Uso real de las acciones por handler (conteo de `authz.X` en `server/handlers`, sin tests): ProjectRead 33, ProjectOps 29, GitRead 27,
GitWrite 13, GitAdmin 12, ProjectNetwork 11, SecurityTriage 10, SecurityRead 7, ProjectDeploy 7, ProjectDatabases 6, EnvRead 6,
SecurityAdmin 4, EnvAdmin 3, ProjectEnvWrite 2, ProjectDelete 2, ProjectConnect 2, GitReview 2, GitMerge 2, WebhooksManage 1,
ProjectMembers 1, ProjectEnvReveal 1, EnvRequest 1.

## 1. Problemas del diseño actual y su corrección

| # | Problema | Evidencia | Corrección |
|---|---|---|---|
| G1 | Permisos mezclados con alcances de token: `deploy` y `security:write` son rutas, con otro vocabulario que `authz`. Añadir una ruta exige tocar `scope.go` a mano. | `deployRouteAllowed` | Un token lleva un subconjunto de permisos atómicos; cada ruta declara el permiso que exige (`x-permission`) y el token, por defecto, se niega en rutas sin permiso registrado (sec. 9). |
| G2 | `project.ops` es un cajón de sastre (ajustes, workers, crons, dominios, correo, SQL, backups, enlace de repo, presign). `project.read` mezcla "ver que existe" con "leer todo". | `handlers/*` (sec. 3.2) | Se divide en átomos; los roles del sistema los conceden juntos, así que nadie cambia de comportamiento (sec. 3.3). |
| G3 | `project_access_mode` es una bandera global que mezcla visibilidad con rol por defecto; no se puede tener un proyecto abierto y otro restringido. | `org.go` PATCH | Pasa a "acceso base" de la plantilla de organización, con sobrescritura por proyecto (sec. 5.4). La columna se conserva. |
| G4 | Techo oculto de `readonly` dentro de `Resolve` y degradación implícita de `member`. | `authz.Resolve` | Se hacen explícitos: `techo` y `base` en la plantilla de organización (sec. 4). |
| G5 | Acciones de organización sin catálogo. | `org_members.go`, `orgenv.go` | Átomos de organización (sec. 3.1). |
| G6 | `users.role` mezcla rol de plataforma y estado, y acepta cualquier valor. | `admin.go` | `users.status` y `users.platform_role` con CHECK; `users.role` queda derivada hasta retirarla (MIGRATION fase 5). |
| G7 | Crear proyecto solo exige ser miembro: un `readonly` puede crear proyectos; igual la creación de bases y dominios de nivel organización sin proyecto. | `project.go:48`, `authorizeOptionalProject` | La migración lo CONSERVA (equivalencia) con átomos `project:create`, `database:create`, `domain:manage` a nivel org, marcados `legacy_gap`; la corrección es un cambio de comportamiento aparte, anunciado y por organización (MIGRATION sec. 7). |
| G8 | `/aws/billing` no tiene comprobación de rol en el handler. | `handlers/billing.go` | Átomos `billing:read/manage` a nivel org; corrección separada (MIGRATION sec. 7). Es endpoint de plataforma: P1 lo verifica antes de decidir. |
| G9 | La UI deriva permisos de una lista que no puede leer. | `useProjectRole` | `GET /me/permissions` como única fuente de la UI (sec. 11). |
| G10 | Invitar = añadir a quien ya tiene cuenta, sin consentimiento ni caducidad; no se puede invitar a quien no tiene cuenta. Sin suspensión por org, sin transferencia de propiedad, sin invariante explícita de "último owner". | `Invite` en `org_members.go` | Ciclo de vida completo (sec. 7). |
| G11 | `EnvApprove` queda fuera de los roles (acierto) pero su lista vive aparte. | `environments/` | Permiso concedible a nivel de entorno (sec. 5.3); la lista de aprobadores es su vista. |
| G12 | Forgejo no distingue admin de deployer; dos de los tres equipos son iguales. | `gitsync` | La proyección usa nivel read/write derivado de `git:read`/`git:write` (sec. 10). |
| G13 | Tokens de servicio evalúan al creador; los `cgs_` sobreviven a su creador. | `gittokens`, 000063 | Regla explícita de ciclo de vida y revocación al dar de baja (sec. 9.4 y 7.4). |

## 2. Principios

1. Un solo catálogo de permisos `recurso:acción` en código (`authz/catalog`), versionado. Handler, token, UI y Forgejo usan esas cadenas.
2. Solo unión, más un techo. El conjunto efectivo es la unión de lo concedido; lo único que resta es el `techo` de la plantilla de organización y la ausencia de acceso base en `restricted`. No hay denegación explícita (sec. 5.5).
3. Equivalencia primero: los roles actuales pasan a ser plantillas del sistema que reproducen `Resolve` bit a bit (sec. 6 y `MIGRATION.md`).
4. El servidor decide; la UI refleja. Ocultar un menú no es seguridad.
5. Falla cerrado: permiso desconocido, plantilla corrupta o versión de catálogo futura => se ignora lo desconocido y se niega.
6. Todo cambio de acceso se audita con valor anterior y nuevo.
7. Sin complejidad sin justificar: grupos planos, un solo operador de resta, alcances org / proyecto / repo / entorno.

## 3. Catálogo de permisos atómicos

### 3.0 Formato y reglas

- Identificador: `recurso:acción`, minúsculas, `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*`. El recurso es el sustantivo del producto (`deployment`, `git`, `envvar`); la acción es un verbo o "read".
- El catálogo vive en código (`backend/internal/authz/catalog`), no en base de datos: una entrada tiene `id`, `scopes` (dónde puede concederse: `org`, `project`, `repo`, `env`, `platform`), `sensitive`, `requires[]`, `legacy[]` (acciones viejas de las que deriva), `since` (versión de catálogo), `group` y textos (es/en). Se publica por `GET /permissions/catalog` y en `catalog.json` generado (la UI y el CLI no tienen copia).
- `catalog_version` es un entero que sube al añadir permisos. Las plantillas del sistema solo reciben permisos nuevos en una versión de plantilla nueva (sec. 4.3). Los permisos nunca se renombran ni se reutilizan: se marcan `deprecated` y se mantienen.
- Un permiso desconocido guardado en una plantilla o token (por ejemplo de una versión futura tras una reversa) se IGNORA al evaluar (no concede nada) y se reporta en `GET /orgs/{org}/templates/{id}` como `unknown_permissions`.
- Comodines: `*` (todo) y `recurso:*`. Se admiten SOLO en plantillas del sistema (owner y admin de organización, admin de proyecto) y en el techo de tokens `*` heredados. Las plantillas personalizadas enumeran permisos: un permiso nuevo del catálogo jamás se concede por sorpresa a una plantilla de cliente.
- `sensitive` = pasa por la ruta estricta de verificación (sec. 12.2) y, si se niega, se audita.
- Total: 66 permisos de proyecto/repo/entorno, 26 de organización y 7 de plataforma = 99 (cabe en un bitset de 128 bits).

### 3.1 Permisos de organización (alcance `org`)

Columnas: plantillas de organización del sistema (O = owner, A = admin, M = member, R = readonly). `G7` = conservado por equivalencia, ver sec. 1.

| Permiso | Deriva de | O | A | M | R | Notas |
|---|---|:-:|:-:|:-:|:-:|---|
| `org:read` | pertenecer | x | x | x | x | ver la organización |
| `org:update` | `org.go` (solo owner renombra) | x | | | | nombre |
| `org:delete` | `org.go` | x | | | | sensible |
| `org:access-policy` | `org.go` PATCH `project_access_mode` | x | x | | | modo y sobrescrituras por proyecto; sensible |
| `org:transfer` | nuevo | x | | | | transferencia de propiedad; sensible |
| `member:read` | `List` (cualquier miembro) | x | x | x | x | |
| `member:invite` | `Invite` (owner/admin) | x | x | | | |
| `member:update` | `UpdateRole` | x | x | | | no puede tocar a un owner (sec. 7.5) |
| `member:remove` | `Remove` | x | x | | | |
| `member:leave` | `Remove` sobre uno mismo | | x | x | x | el último owner no puede (sec. 7.5) |
| `member:suspend` | nuevo | x | x | | | suspensión por organización |
| `group:read` | nuevo | x | x | | | |
| `group:manage` | nuevo | x | x | | | crear, editar, borrar grupos y su membresía; sensible |
| `template:read` | nuevo | x | x | | | |
| `template:manage` | nuevo | x | x | | | plantillas personalizadas; sensible |
| `assignment:read` | nuevo (a nivel org) | x | x | | | ver asignaciones y simular (sec. 11.4) |
| `assignment:grant` | `project.members` generalizado | x | x | | | asignar plantillas; sujeto a la regla de no-escalada (sec. 13.1); sensible |
| `audit:read` | `audit.go` `org.admin` | x | x | | | |
| `audit:export` | `audit.go` CSV | x | x | | | |
| `orgvar:read` | `orgenv.go` List (enmascarado) | x | x | x | x | |
| `orgvar:write` | `orgenv.go` Set/Delete | x | x | | | sensible |
| `orgvar:reveal` | `orgenv.go` `?reveal=true` | x | x | | | sensible |
| `billing:read` | `/aws/billing` (G8) | x | x | | | corrección posterior (MIGRATION sec. 7) |
| `billing:manage` | nuevo | x | | | | sensible |
| `token:read-all` | nuevo | x | x | | | ver tokens de otros miembros (metadatos) |
| `token:revoke-any` | nuevo | x | x | | | revocar tokens de otros; clave al dar de baja |
| `oauthclient:manage` | `oauthmembers.go` (`--org-id`) | x | x | | | verificar el chequeo actual en P1 |
| `project:create` | `project.go` (G7) | x | x | x | x | `legacy_gap` |

Además, estos permisos de proyecto se conceden a nivel `org` en las plantillas de arriba para conservar el comportamiento de las rutas sin proyecto (sec. 3.2, nota 2): `database:create`, `domain:manage` (O, A, M, R: `legacy_gap`, G7), `assignment:read`/`assignment:grant` (ya arriba).

### 3.2 Permisos de proyecto, repo y entorno

Columnas: `V` viewer, `D` deployer, `P` admin de proyecto (la plantilla `admin`). Alcance: P = proyecto, R = repo, E = entorno.

| Permiso | Alc. | Deriva de | V | D | P | Qué cubre |
|---|:-:|---|:-:|:-:|:-:|---|
| `project:view` | P R E | `project.read` | x | x | x | saber que el proyecto existe; es la puerta de visibilidad (404 si falta) |
| `project:read` | P | `project.read` | x | x | x | detalle del proyecto |
| `project:update` | P | `project.ops` | | x | x | ajustes del proyecto |
| `project:delete` | P | `project.delete` | | | x | sensible |
| `project:restore` | P | `project.delete` (`recover.go`) | | | x | recuperar proyecto borrado; sensible |
| `deployment:read` | P | `project.read` | x | x | x | lista, detalle |
| `deployment:create` | P | `project.deploy` | | x | x | incluye `upload-url` |
| `deployment:cancel` | P | `project.deploy` | | x | x | |
| `deployment:rollback` | P | `project.deploy` | | x | x | |
| `preview:read` | P | `project.read` | x | x | x | |
| `preview:manage` | P | `project.deploy` | | x | x | crear y borrar previews |
| `log:read` | P | `project.read` | x | x | x | runtime, lambda, workers, storage, cron |
| `envvar:read` | P | `project.read` | x | x | x | lista enmascarada |
| `envvar:write` | P | `project.env_write` | | x | x | |
| `envvar:reveal` | P | `project.env_reveal` | | | x | valores secretos; sensible |
| `environment:read` | P E | `env.read` | x | x | x | entornos y promociones |
| `environment:manage` | P E | `env.admin` | | | x | configurar entornos y su lista de aprobadores |
| `promotion:request` | P E | `env.request` | | x | x | |
| `promotion:approve` | E (P) | `env.approve` | | | | ninguna plantilla del sistema lo trae; se concede en el entorno (sec. 5.3); sensible |
| `worker:read` | P | `project.read` | x | x | x | |
| `worker:manage` | P | `project.ops` | | x | x | crear, borrar, arrancar, parar |
| `cron:read` | P | `project.read` | x | x | x | |
| `cron:manage` | P | `project.ops` | | x | x | crear, borrar |
| `cron:trigger` | P | `project.ops` | | x | x | |
| `domain:read` | P (O) | `project.read` | x | x | x | |
| `domain:manage` | P O | `project.ops` | | x | x | en `org`: dominios sin proyecto (G7) |
| `email:read` | P | `project.read` | x | x | x | estado, estadísticas, DNS, logs, supresiones |
| `email:manage` | P | `project.ops` | | x | x | configurar, probar, enviar, borrar supresión |
| `storage:read` | P | `project.read` | x | x | x | |
| `storage:manage` | P | `project.databases` | | | x | crear, borrar buckets |
| `storage:presign` | P | `project.ops` | | x | x | |
| `database:read` | P (O) | `project.read` | x | x | x | lista y detalle |
| `database:create` | P O | `project.databases` | | | x | en `org`: bases sin proyecto (G7) |
| `database:delete` | P | `project.databases` | | | x | sensible |
| `database:query` | P | `project.ops` | | x | x | explorador SQL; sensible |
| `backup:read` | P | `project.read` | x | x | x | |
| `backup:manage` | P | `project.ops` | | x | x | política, ejecutar, verificar |
| `backup:restore` | P | `project.databases` | | | x | sensible |
| `connaudit:read` | P | `project.read` | x | x | x | auditoría de conexiones |
| `connaudit:manage` | P | `project.ops` | | x | x | modo y supresiones |
| `network:read` | P | `project.read` | x | x | x | reglas de acceso a bases, puertos, lista de IP |
| `network:manage` | P | `project.network` | | | x | sensible |
| `gateway:connect` | P | `project.connect` | | x | x | `capsule connect/tunnel/ssh` |
| `gateway:manage` | P | `project.network` | | | x | exponer o cerrar servicios y puerto aleatorio; sensible |
| `gateway:token` | P | `project.network` | | | x | tokens `cgs_`; sensible |
| `git:read` | P R | `git.read` | x | x | x | código, ramas, commits, PR (también revisiones y comentarios leídos) |
| `git:write` | P R | `git.write` | | x | x | ramas, abrir PR, comentar, token Git `write` |
| `git:review` | P R | `git.review` | | x | x | |
| `git:merge` | P R | `git.merge` | | x | x | sujeto a la regla de la rama |
| `git:link` | P | `project.ops` (`git.go`, `CreateRepo`) | | x | x | enlazar o crear el repo del proyecto |
| `git:protect` | P R | `git.admin` | | | x | protección de ramas; sensible |
| `git:settings` | P R | `git.admin` | | | x | ajustes del repo |
| `git:mirror` | P R | `git.admin` | | | x | espejos |
| `git:review-dismiss` | P R | `git.admin` | | | x | descartar revisiones |
| `git:token-service` | P R | `git.admin` | | | x | tokens de servicio `cgt_`; sensible |
| `ci:read` | P R | `git.read` | x | x | x | workflows, runs, logs |
| `ci:run` | P R | `git.write` | | x | x | lanzar, relanzar, cancelar |
| `ci:variable` | P R | `git.admin` | | | x | variables de CI |
| `ci:secret` | P R | `git.admin` | | | x | secretos de CI; sensible |
| `security:read` | P | `security.read` | x | x | x | alertas |
| `security:triage` | P | `security.triage` | | x | x | descartar bajas y medias con justificación |
| `security:upload` | P | `security.triage` | | x | x | subir SARIF (también crear el token `security:write`) |
| `security:admin` | P | `security.admin` | | | x | críticas y altas, políticas; sensible |
| `webhook:manage` | P | `webhooks.manage` | | | x | webhooks salientes |
| `assignment:read` | P (O) | `project.members` | | | x | ver quién tiene acceso al proyecto |
| `assignment:grant` | P R E (O) | `project.members` | | | x | asignar; regla de no-escalada; sensible |

Notas:

1. **Equivalencia de la partición.** Cada acción vieja `A` se expande a un conjunto fijo `expand(A)` de átomos de la tabla (columna "Deriva de"). Los roles del sistema reciben `expand(A)` COMPLETO para cada `A` que hoy conceden. Por eso un handler puede elegir cualquier átomo de `expand(A)` sin cambiar la decisión de ningún usuario con roles del sistema: la elección fina solo importa para plantillas personalizadas. El paquete P1 la fija leyendo cada handler y la deja en un fichero dorado ruta -> átomo (MIGRATION sec. 3, F0).
2. Rutas sin proyecto (`/orgs/{org}/databases`, `/domains`): hoy exigen solo pertenecer (`authorizeOptionalProject`). Se evalúan a nivel `org` con `database:create`/`domain:manage`/`*:read`, que las cuatro plantillas de organización conservan (G7). Al operar sobre un recurso con proyecto, se exige el permiso de proyecto (`authorizeResourceProject`, ya existente).
3. `promotion:approve` no está en ningún rol: lo decide el entorno. Hoy la lista de aprobadores admite usuarios o un rol de proyecto (`Reviewer`); en el modelo admite usuario, grupo o plantilla (sec. 5.3).
4. `project:view` separado de `project:read` permite que un grupo con acceso solo a un repo o un entorno vea el proyecto (nombre) sin leer despliegues, logs ni variables.
5. `git:read` y `ci:read` los conceden juntos todas las plantillas del sistema; igual `git:write`/`ci:run`. Una plantilla personalizada puede separarlos.

### 3.3 Permisos de plataforma (alcance `platform`)

Hoy `users.role == 'admin'` abre `/api/v1/admin/*` y `/platform/backups*`. Se mantienen dos valores (`platform_role` = `user` | `admin`), no se crean plantillas de plataforma en v1 (justificación: un solo operador, sin demanda). `admin` concede:
`platform-user:read`, `platform-user:create`, `platform-user:suspend`, `platform-user:delete`, `platform-user:set-role`, `platform-backup:read`, `platform-backup:run`.
Un admin de plataforma NO es miembro de las organizaciones ni obtiene permisos de organización por serlo. Las acciones de plataforma salen en `GET /me/permissions` (campo `platform`) y alimentan el menú "Usuarios de plataforma".

### 3.4 Dependencias (`requires`)

El servidor valida al guardar una plantilla o un token; falta una dependencia => `422` con la lista (la UI ofrece "añadir las que faltan"). Reglas del catálogo:

- Todo permiso de proyecto, repo o entorno requiere `project:view`.
- `X:manage`, `X:write`, `X:create`, `X:delete`, `X:run`, `X:trigger`, `X:request`, `X:merge`, `X:review` requieren el `X:read` de su recurso cuando existe (`git:*` requiere `git:read`; `ci:*` requiere `ci:read`; `security:triage|upload|admin` requieren `security:read`).
- `envvar:reveal` requiere `envvar:read`. `backup:restore` requiere `backup:read`. `database:query` requiere `database:read`.
- `promotion:approve` requiere `environment:read`. `assignment:grant` requiere `assignment:read`. `member:*` requiere `member:read`. `group:manage` requiere `group:read`; `template:manage`, `template:read`.
- Los tokens no exigen dependencias entre sus permisos: la decisión es la intersección con el conjunto del usuario, que ya cumple las dependencias; un token con `git:write` sin `git:read` simplemente no puede leer.

## 4. Plantillas

Una plantilla es un conjunto nombrado de permisos, versionado e inmutable por versión.

### 4.1 Tipos

| `kind` | Qué contiene | Dónde se asigna |
|---|---|---|
| `org` | `permissions` de nivel org, `floor`, `base`, `ceiling` (abajo) | una por miembro (su "rol de organización") |
| `project` | permisos de proyecto/repo/entorno | usuario o grupo, en alcance org (todos los proyectos), proyecto, repo o entorno |
| `repo` | subconjunto de `project` válido en alcance repo | usuario o grupo, en repo |

Campos de una plantilla `org` además de `permissions`:

- `floor` (plantilla `project` o ninguna): lo que el titular tiene SIEMPRE en todos los proyectos, sin que ninguna asignación más cercana lo reduzca. owner y admin: `floor = admin` de proyecto. Es la traducción literal de "owner/admin => admin en todo".
- `base` (plantilla `project` o ninguna): lo que tiene por defecto en los proyectos donde no tiene asignación propia, mientras la política de la org o del proyecto sea `open` (sec. 5.4). member: `base = deployer`; readonly: `base = viewer`.
- `ceiling` (conjunto de permisos o ninguno): tope absoluto de TODO lo que el titular pueda llegar a tener. readonly: org(readonly) + permisos del viewer. Es lo único que resta en el motor (sec. 5.5).

### 4.2 Plantillas del sistema (inmutables para el cliente)

`org_id IS NULL`, `system = true`. Nadie puede editarlas ni borrarlas por API (`409 SYSTEM_TEMPLATE`); se pueden clonar. Slugs reservados.

| Plantilla | kind | Contenido |
|---|---|---|
| `owner` | org | `*` de organización; floor = `admin` |
| `admin` | org | columna A de sec. 3.1; floor = `admin` |
| `member` | org | columna M de sec. 3.1; base = `deployer` |
| `readonly` | org | columna R de sec. 3.1; base = `viewer`; ceiling = columna R + conjunto del `viewer` |
| `viewer` | project | columna V de sec. 3.2 |
| `deployer` | project | columna D |
| `admin` | project | columna P (`*` de proyecto salvo `promotion:approve`) |
| `repo-read` | repo | `project:view`, `git:read`, `ci:read` |
| `repo-write` | repo | `repo-read` + `git:write`, `git:review`, `git:merge`, `ci:run` |

`kind` desambigua los slugs repetidos (`admin` de org vs `admin` de proyecto): las rutas y el CLI siempre indican el tipo (`capsule roles show project/admin`). Los textos visibles conservan los nombres de hoy (Owner, Admin, Member, Readonly; Admin, Deployer, Viewer).

Qué es "inmutable" y cómo evoluciona: el contenido de una versión no cambia jamás. Capsule publica una versión nueva de una plantilla del sistema solo con una migración y una nota de versión; si la versión nueva AÑADE permisos (un permiso nuevo del catálogo) se aplica a todos; si QUITA permisos es un cambio de comportamiento y sigue el procedimiento de MIGRATION sec. 7 (aviso, activación por organización, reversible). Las asignaciones a plantillas del sistema siguen siempre la última versión.

### 4.3 Plantillas personalizadas por organización

- Se crean con `template:manage`, `kind` org/project/repo, slug único por (org, kind) y distinto de los reservados, 1-200 permisos, todas las dependencias satisfechas, ninguna con comodín.
- **Clonar:** copia la última versión de cualquier plantilla visible (incluidas las del sistema) a una nueva con `cloned_from`. Es el camino normal para "Deployer pero sin `database:query`".
- **Versionar:** cada guardado crea `version = n+1` con `note` y autor; las versiones no se editan ni se borran. Revertir = publicar una versión nueva con el contenido de una anterior. `GET .../versions/{n}/diff/{m}` muestra permisos añadidos y quitados.
- **Propagación:** las asignaciones siguen la última versión por defecto. Antes de publicar, `POST .../publish?dry_run=true` devuelve el impacto (personas, grupos, proyectos afectados y los permisos que ganan o pierden). Una asignación puede fijarse a una versión (`pin_version`) para cambios cautelosos; en la UI aparece como "fijada en v3". Se decide seguir-la-última por defecto porque editar el rol es exactamente lo que el administrador espera que cambie a todos, y fijar es la excepción explícita.
- **Regla de no-escalada al editar:** quien guarda una versión solo puede AÑADIR permisos que él mismo tenga en alcance org (o `owner`). Quitar es libre.
- **Archivar:** una plantilla en uso no se borra; se archiva (no asignable de nuevo) y las asignaciones vivas siguen funcionando. Borrar exige cero asignaciones.
- **Aplicar:** a un grupo o a una persona, vía asignaciones (sec. 5.2). No hay "perfil de usuario" aparte.

## 5. Resolución

### 5.1 Alcances

```
org  ->  project  ->  repo      (repo hoy es 1:1 con el proyecto: POST /projects/{id}/git/repo)
                  ->  env       (entorno de despliegue del proyecto)
```

Un alcance se identifica por `(scope_type, scope_id)`. `repo` y `env` solo admiten permisos cuya entrada del catálogo los incluya en `scopes`; una asignación que lleve permisos fuera de su alcance se rechaza con `422` y la lista.

### 5.2 Asignaciones

Una asignación es `(sujeto, alcance, plantilla, versión opcional fijada, caducidad opcional, razón)`. Sujeto = usuario o grupo. Fuentes: `manual`, `migrated` (las filas de `project_members`), `legacy-api` (rutas viejas), `approver` (lista de aprobadores), `oidc` (membresía importada, sec. 6.3) y `temporary`. No hay asignaciones negativas.

### 5.3 Algoritmo `Effective(user, org, scope)` (normativo)

```
membership m := org_members(org,user); user u := users(user)
si m no existe          -> Member=false, set=vacío            (403 "not a member")
si u.status != active o m.status != active -> Member=true, set=vacío, motivo=suspended
T := plantilla org de m (versión actual o fijada); si no resuelve -> vacío (cierra)
org-set := T.permissions        -- en v1 la plantilla de org es la única fuente de permisos de nivel org
si scope = org -> devolver aplicar_techo(org-set)

proyecto p (de la org; verificar p.org_id == org):
  propias := asignaciones vivas (usuario directo ∪ grupos del usuario) en scope project p
  mode    := p.access_override ?? org.project_access_mode           (open|restricted)
  respaldo:= ∪ perms de asignaciones vivas (usuario ∪ grupos) en scope org con plantilla project   -- "todos los proyectos"
             ∪ (mode = open ? T.base : vacío)
  base    := propias existen ? ∪ perms(propias) : respaldo          -- lo más cercano gana; dentro de un nivel, unión
  set     := aplicar_techo( base ∪ T.floor )
  si project:view ∉ set -> Hidden=true, set=vacío                   (404, no filtra existencia)

repo r de p:  set := aplicar_techo( set_proyecto ∪ perms(asignaciones vivas en scope repo r) )
env  e de p:  set := aplicar_techo( set_proyecto ∪ perms(asignaciones vivas en scope env e)  ∪ perms(aprobadores)(e) )
  (visibilidad por repo o entorno: una asignación en repo o entorno trae project:view, así que alcanza la visibilidad del proyecto sin dar project:read)
```

`aplicar_techo(x)` = `x ∩ T.ceiling` si la plantilla tiene techo, si no `x`. "Vivas" = no revocadas, no caducadas, de miembro activo, grupo no archivado.

Reglas que se derivan, todas ya ciertas en `Resolve` hoy:

1. owner/admin: el floor suma siempre `admin`; una fila más cercana no lo reduce.
2. member con fila propia: la fila SUSTITUYE al respaldo (puede bajar de deployer a viewer). Con dos filas en el mismo nivel (por ejemplo usuario + grupo) se unen: nunca se pierde un permiso por pertenecer a un grupo.
3. readonly: el techo corta cualquier fila (una fila `admin` da `viewer`). En `restricted` sin fila no tiene respaldo, no alcanza `project:view`: oculto.
4. Rol de organización que no resuelve: vacío y oculto.
5. Respuesta HTTP: `!Member` -> 403 "not a member"; `Hidden` -> 404; visible sin el permiso -> 403 (`PERMISSION_DENIED` con `missing`). Igual que `authz.authorize`.
6. `Source` (campo que hoy devuelve `GET .../members`): `org` si el permiso viene del floor, `explicit` si viene de `propias`, `inherited` si del respaldo. Se conserva en la API de compatibilidad.

### 5.4 Política de acceso base (reemplaza a `project_access_mode`)

- `organizations.project_access_mode` se conserva y sigue siendo la política de la org (`open`/`restricted`).
- Nuevo: `projects.access_override` nullable (`open`/`restricted`), por proyecto. Caso de uso real: una organización abierta con un proyecto confidencial.
- `open` activa el `base` de las plantillas de organización; `restricted` lo desactiva. El efecto sobre quien ya tiene filas es nulo, como hoy.
- Cambiar la política es `org:access-policy` y se audita (`access.mode.changed`). Pasar a `restricted` calcula antes quién perdería visibilidad y exige confirmar (`409 WOULD_HIDE` con la lista y `confirm=true`), incluido el propio actor, tal como pide la skill hoy.

### 5.5 Denegación explícita: NO

Recomendación firme, con razones:

1. Con solo unión la función de decisión es monótona: añadir una asignación nunca quita nada. Eso hace trivial el simulador ("tiene X por la asignación Y"), la auditoría y la reversa.
2. La denegación obliga a una precedencia (¿el deny de grupo gana al allow directo?) y vuelve ambiguas las migraciones y la proyección a Forgejo, que no admite negativos.
3. Hoy no existe ninguna regla negativa de usuario; lo parecido (techo de readonly, "sin fila en restricted") se modela como techo y ausencia de base.
4. Los casos de uso reales (contratista, invitado, "todos menos X") se cubren con el techo en la plantilla de organización (`readonly` o una personalizada con techo), con `restricted`, y con plantillas más pequeñas. Si apareciera una necesidad de "bloquear a esta persona en este proyecto", la respuesta correcta es quitarle las asignaciones o suspenderla, no una regla negativa.

Decisión abierta D1 si el dueño la quiere igualmente (sec. 15): se añadiría una sola lista `deny` por (usuario, alcance) con precedencia "deny gana siempre", sin condiciones.

### 5.6 Precedencia (resumen)

1. Estado: usuario o membresía suspendidos => nada.
2. Techo (`ceiling`) recorta todo.
3. Floor suma siempre.
4. Asignaciones propias del proyecto sustituyen al respaldo; dentro del mismo nivel, unión.
5. En repo y entorno las asignaciones solo suman al conjunto del proyecto.
6. Un token recorta al final (sec. 9).

## 6. Grupos

### 6.1 Modelo

- Un grupo pertenece a UNA organización: `(id, org_id, slug, name, description, source, external_ref, archived_at)`. Slug único por org, `[a-z0-9-]{1,40}`.
- Membresía `(group_id, user_id, added_by, added_at, expires_at?, source)`. Solo miembros activos de la organización; al dejar la org o suspenderse, la fila sigue pero no cuenta (se limpia al dar de baja).
- Un grupo NO tiene permisos propios: recibe asignaciones como cualquier sujeto. **Un grupo puede tener plantillas distintas en proyectos distintos** (`Equipo Pagos` = `deployer` en `api-pagos`, `viewer` en `web`, `repo-write` solo en el repo de `infra`): son filas de asignación con distinto alcance.
- Grupos del sistema: ninguno. El grupo implícito "todos los miembros" NO existe como fila: es lo que hace `base` (sec. 4.1).

### 6.2 Anidación: NO en v1

Justificación: los ciclos y la herencia transitiva complican la caché (un cambio en un grupo padre invalida a muchos), el simulador (más pasos de explicación) y la proyección a Forgejo, sin necesidad demostrada: un grupo "Plataforma" que contenga "SRE" y "Infra" se resuelve asignando ambos grupos donde haga falta, y los equipos grandes se modelan con plantillas. Si más adelante se pide, el punto de extensión es `group_members.member_type = 'group'` con profundidad máxima 2 y detección de ciclos; el modelo de evaluación no cambia (solo la expansión de usuario a grupos).

### 6.3 Importación desde el claim `groups` de un OIDC externo

Aviso de alcance: el paquete `oidc/` actual es el lado PROVEEDOR (Capsule emite el `groups` que consume Forgejo); no se encontró un inicio de sesión federado entrante. Esta función es por tanto de un paquete aparte (P12) y solo aplica si el dueño incorpora un IdP externo (decisión D8).

Diseño, si se activa:
- La org registra una fuente `group_sources(org_id, issuer, claim_name='groups', enabled)` y reglas `external_group -> group_id` explícitas (sin comodines, sin autocreación de grupos ni de plantillas).
- Al iniciar sesión, la membresía `source='oidc'` se sincroniza: se añaden los grupos presentes en el claim y mapeados y se retiran los `source='oidc'` ausentes. Nunca toca membresías `manual`.
- Un grupo cuyas asignaciones incluyan permisos `sensitive` o `assignment:grant` no se puede mapear salvo `allow_privileged=true` puesto por un owner (evita que un administrador del IdP se auto-escale).
- El claim saliente hacia Forgejo NO cambia de formato: se conservan `org:<slug>`, `org:<slug>:<rol>`, `project:<org>/<proj>:<rol>` (sec. 10) y solo se añade `grp:<org>/<slug>` por cada grupo del usuario para quien quiera mapearlos en Forgejo.

## 7. Ciclo de vida del usuario

### 7.1 Estados

```
cuenta (users.status):         active <-> suspended        -> deleted (soft, deleted_at)
membresía (org_members.status): invited(*) -> active <-> suspended -> (fila borrada = baja)
(*) la invitación es una fila de `invitations`, no de `org_members`
```

- `users.status`: `active` | `suspended` | `deleted`. Reemplaza el uso de `users.role = 'suspended'`. Suspender la cuenta (permiso `platform-user:suspend`) revoca sesiones (refresh tokens) y hace que `cap_`, `cgt_` y el login OIDC fallen en la siguiente validación (inmediato por sec. 12.2).
- `org_members.status`: `active` | `suspended`. Suspender en una org (`member:suspend`) deja a la persona sin acceso en ESA org (conjunto vacío) conservando sus asignaciones y grupos para reactivar sin reconfigurar. Sus tokens `cap_` siguen funcionando en otras orgs.

### 7.2 Alta e invitación

- **Alta de cuenta:** registro (`auth.go`) o creación por administrador de plataforma (`POST /admin/users`), sin cambios.
- **Invitación:** `POST /orgs/{org}/invitations` con email, plantilla de organización, grupos opcionales y hasta 20 asignaciones iniciales de proyecto. Genera un token de un solo uso (solo se guarda el hash), caduca a los 7 días (configurable 1-30), se envía por correo. Quien acepta (con cuenta existente o creándola) entra con exactamente lo invitado. Estados: `pending`, `accepted`, `expired`, `revoked`. `member:invite` es necesario y rige la regla de no-escalada: no se puede invitar con más permisos de los propios.
- **Compatibilidad:** `POST /orgs/{org}/members` (añadir a quien ya tiene cuenta, inmediato) se mantiene con el mismo comportamiento y el mismo `role` (`admin|member|readonly`; el rol `owner` sigue sin poder invitarse). Decisión D4: cuándo exigir aceptación explícita también a usuarios existentes (recomendación: opción por org, por defecto el comportamiento actual).
- Verificación de email: la invitación a un correo exige que la cuenta que acepta tenga ese email verificado; si no, el aceptar falla `409 EMAIL_MISMATCH`.

### 7.3 Suspensión y baja

- **Baja de la organización** (`member:remove`/`member:leave`): en una transacción borra `org_members`, `project_members`/asignaciones del usuario en la org, sus membresías de grupo, sus entradas como aprobador, y REVOCA: tokens `cgt_` de proyectos de la org, tokens `cgs_` creados por la persona en la org (opción `keep_service_tokens=true` para transferirlos a otra persona antes), y encola `notifyOrgChanged` (equipos de Forgejo, tal como hoy). Se audita con el estado anterior completo (`old_values`: rol, asignaciones, grupos).
- **Baja de la cuenta** (soft delete): equivale a la baja de todas sus orgs más borrado lógico; las filas de auditoría se conservan con `actor_label` (ya existe) para no perder trazabilidad.

### 7.4 Tokens de servicio y bajas

Los `cgt_` de servicio se evalúan como su creador. Al dar de baja o suspender al creador se revocan (regla anterior); para que un pipeline sobreviva, un admin debe antes crear uno propio. Decisión D6 (principales de servicio propios de la org) fuera de v1.

### 7.5 Último owner y transferencia de propiedad

Invariante, comprobada en la MISMA transacción que cualquier cambio que pueda romperla y protegida con un bloqueo de fila sobre la organización: **toda organización tiene al menos un owner activo**. Se bloquea con `409 LAST_OWNER`: quitar, degradar, suspender o dar de baja al último owner (también por `DELETE /admin/users/{id}` y por suspensión de plataforma).

- Varios owners: se permite (recomendación D3). `organizations.owner_id` pasa a ser "propietario principal" (facturación y contacto) y se mantiene sincronizado; el resto de la lógica usa la plantilla `owner`.
- Un `admin` no puede modificar, suspender ni quitar a un owner (`403`), ni asignarse la plantilla `owner`. Hoy ya es así (`targetRole == "owner"` => 403; ni el owner puede tocar su propio rol). En el modelo solo otro owner puede degradar a un owner, y nunca al último.
- **Transferencia:** `POST /orgs/{org}/ownership-transfer` (`org:transfer`) nombra a un miembro activo; el destinatario acepta en 7 días; ambas partes confirman con reautenticación (contraseña o 2FA, mismo mecanismo que el acceso a secretos si existe). Resultado: el destinatario pasa a `owner`; quien transfiere pasa a `admin` (o sigue siendo co-owner si `keep_owner=true`). `owner_id` se actualiza. Auditoría `access.owner.transferred` con ambos IDs e IP.

## 8. Acceso temporal

- `expires_at` en asignaciones y en membresías de grupo. Máximo por organización `temp_access_max_days` (por defecto 90, rango 1-365); sin caducidad solo si la política lo permite.
- La evaluación ignora filas caducadas en el instante de la decisión (la caché guarda `next_expiry` y se recompone en ese momento; un barrido cada minuto audita `access.expired`, emite la invalidación y notifica a Forgejo).
- Expiración de una asignación NO borra la fila (queda `expired` para la auditoría y para "renovar").
- Aviso: 24 h antes (y 1 h antes si dura menos de 1 día) el sujeto y quien la concedió reciben notificación (`notifications` ya existe).
- CLI: `capsule members grant ana@x --template deployer --project api --for 8h`.
- Sin flujo de "solicitud de acceso" en v1 (decisión D7).

## 9. Tokens y permisos

### 9.1 Modelo

Un token (`cap_`, `cgt_`, `cgs_`) lleva un SUBCONJUNTO de permisos atómicos y un alcance de recurso (organización, y proyecto opcional). Regla única:

```
permisos de la petición con token = Effective(usuario, alcance de la ruta, EN ESE INSTANTE)  ∩  token.permissions  ∩  alcance de recurso del token
```

El token nunca puede exceder al usuario (si el usuario pierde algo, el token lo pierde en la siguiente petición) y nunca concede algo que el usuario no tenga (comprobación también al crearlo).

- **Creación:** `permissions ⊆ Effective(usuario, org/proyecto del token)`; si no, `403` con la lista de los excedentes. Los tokens con permisos explícitos DEBEN llevar `org_id`; `project_id` es opcional (sin proyecto, los permisos de proyecto valen en cualquier proyecto de la org donde el usuario los tenga en ese momento).
- **No tokenables:** los permisos con `tokenable=false` jamás se pueden meter en un token: `org:*`, `member:*`, `group:*`, `template:*`, `assignment:*`, `token:*`, `oauthclient:manage`, `billing:manage`, `platform-*`. Así un token no puede conceder acceso ni acuñar otro token (cierra la escalada por token; ver 13.1).
- **Caducidad:** los nuevos `cap_` con permisos explícitos tienen `expires_at` obligatorio (máx. 365 d; 30 d por defecto en CLI). Lo ya existente no cambia.

### 9.2 Compatibilidad con los alcances actuales

`api_tokens.scopes` se conserva y se lee tal cual; `api_tokens.permissions text[]` es nuevo y nulo en todo lo existente. Si `permissions` es nulo, el token se traduce con esta tabla (no hay migración de datos; el comportamiento es idéntico por construcción y se prueba, MIGRATION sec. 5):

| Alcance heredado | Equivale a `permissions` | Alcance de recurso |
|---|---|---|
| `*` o vacío | `*` (todo lo que tenga el usuario; se conserva la capacidad actual, incluida la de acuñar tokens) | ninguno |
| `deploy` | `deployment:read`, `deployment:create`, `deployment:cancel`, `deployment:rollback`, `envvar:read`, `preview:read`, `preview:manage`, `environment:read`, `promotion:request` | `project_id` obligatorio |
| `security:write` | `security:upload` | `project_id` obligatorio |
| `deploy,security:write` | unión de ambos | `project_id` |

Fuente de la tabla: cada ruta de `deployRouteAllowed` (env GET; previews GET/POST/DELETE; environments GET; promotions POST y GET; deployments GET/POST, `upload-url`, `{id}`, `logs`, `cancel`, `rollback`) y `securityWriteRouteAllowed` (POST y GET de `security/sarif`). Se verifica ruta por ruta en la prueba de equivalencia (MIGRATION sec. 5.4).

Tokens Git: `cgt_` `scope=read` => `{git:read}`; `write` => `{git:read, git:write}`, ligados a `project_ids[]` como ahora, reevaluados en cada uso (`gittokens.roleAllows` pasa a `Engine.Can`). Tokens gateway: `cgc_` (conexión, un uso, <= 5 min) y `cgs_` => `{gateway:connect}`. Nada de esto cambia el esquema de `git_access_tokens` ni de `gateway_service_tokens`; la columna `permissions` solo se añade a `api_tokens`.

Los alcances `deploy` y `security:write` siguen siendo aceptados en `POST /user/tokens` y en `capsule tokens create --scope` indefinidamente: son alias de las listas de la tabla. `--perm` es la forma nueva.

### 9.3 Cómo se evalúa y por qué se elimina `TokenAllows` por ruta

Hoy `middleware.TokenAllows` decide por método y ruta ANTES del handler. Con permisos atómicos la decisión se mueve al punto donde el handler llama a la autorización: `authorize(..., perm)` lee el techo del token (`middleware.TokenPerms(ctx)`) y niega con `403 TOKEN_SCOPE` (`missing`). Riesgo a cerrar: una ruta sin llamada a `authorize` ya no estaría protegida por la lista de rutas. Por eso:

1. Existe una tabla única `routePermissions` (`ruta -> permisos exigidos`, o `public`, o `session-only`). Un test falla si una ruta del router no está en la tabla, y otro si la tabla no coincide con los `x-permission` de `API.openapi.yaml` y de la ruta real.
2. Un middleware `TokenGate` consulta la tabla: un token con permisos explícitos o heredado acotado solo pasa en rutas cuyo permiso exigido pertenece al token; `session-only` (por ejemplo `/user/tokens`, `/me/*`, `/admin/*`) se niega siempre a tokens acotados. El `*` heredado sigue pasando todo (como hoy).
3. Rutas nuevas sin entrada en la tabla: el test las bloquea en CI y, en producción, el `TokenGate` las niega a tokens acotados (por defecto cierra).

### 9.4 Ciclo de vida y servicio

- Un token personal vive mientras viva la cuenta y su membresía; baja o suspensión => deja de valer (efecto de la fórmula) y los `cgt_`/`cgs_` creados en esa org se revocan (sec. 7.3).
- `token:read-all` ve metadatos (nombre, prefijo, creador, alcance, último uso), nunca el valor. `token:revoke-any` revoca. Cada revocación se audita.
- Tokens `cgs_`: pueden sobrevivir a un cambio de rol del creador (son credenciales de infraestructura de un proyecto, caducan <= 90 d); se mitiga con la revocación al dar de baja y el filtro "creados por" en `token:read-all`. Si el creador pierde `gateway:token` el token NO se invalida solo (limitación aceptada; D6 la elimina con principales de servicio).

## 10. Proyección a Forgejo y a OIDC

### 10.1 Equipos

`gitsync.Reconciler.desired` deja de llamar a `authz.Resolve` y pregunta al motor: para cada miembro activo, `set = Effective(u, repo(p))`, `level = write` si `git:write ∈ set`, `read` si `git:read ∈ set`, nada en otro caso. Equipos por proyecto:

- Nuevos: `<slug>-read` (permiso Forgejo `read`) y `<slug>-write` (`write`). Nadie es admin de repo en Forgejo salvo el bot (decisión de `docs/git-capsule/SPEC.md` sec. 2, se mantiene): `git:protect`, `git:settings`, `ci:secret` los ejecuta Capsule con la cuenta de servicio.
- Heredados: `<slug>-viewer/-deployer/-admin` se mantienen durante la transición (una versión) y se reconcilian con la etiqueta heredada (sec. 10.2) para poder revertir sin reconstruir equipos; después se retiran (decisión D10).
- El reconciliador sigue quitando a quien esté en un equipo sin derecho (deriva manual), y `AuditDrift` no cambia. Los accesos por repo (alcance `repo`) entran porque `Effective` en alcance repo ya los incluye. Hoy un proyecto tiene exactamente un repo, así que repo y proyecto comparten equipos; si se admiten varios repos por proyecto, los equipos pasan a ser por repo (el cambio es local al reconciliador).
- `authz.RoleAllows(nr, authz.GitReview)` (reconcile.go) pasa a `set.Has(git:review)`.

### 10.2 Etiqueta heredada de rol (`legacy_role`)

Para todo consumidor viejo (claim `groups`, `GET .../members`, equipos heredados, CLI antiguo) existe una función pura `LegacyRole(set) -> admin|deployer|viewer|""`: el mayor rol del sistema cuyo conjunto está CONTENIDO en `set`. Nunca sobre-informa (una plantilla personalizada con más permisos que `deployer` pero sin todos los de `admin` se etiqueta `deployer`; una que no cubra `viewer` se etiqueta vacía). Para la organización, `org_members.role` se mantiene como la misma etiqueta (owner/admin/member/readonly, o la más baja que la plantilla cubra, y `readonly` como suelo) para el código antiguo que lo lea; para plantillas del sistema es exactamente el valor de hoy.

### 10.3 Claim `groups`

Formato idéntico al actual: `org:<slug>`, `org:<slug>:<rol>`, `project:<org>/<project>:<rol>` (rol = `LegacyRole`, solo si no vacío y con `project:view`), y `ProjectGroups` mantiene su orden (`sort.Strings`). Se añade `grp:<org>/<grupo>` (solo pertenencia, sin permisos) y NUNCA se emiten permisos atómicos en el claim: crecería sin límite y filtraría el modelo. Para usuarios sin plantillas ni grupos personalizados el claim es BYTE A BYTE el actual (se prueba, MIGRATION sec. 5.5).

## 11. Superficies para frontend, CLI y auditoría

### 11.1 `GET /me/permissions`

Fuente única de la UI y de `capsule perms me`. Parámetros: `org` (id o slug; por defecto la org activa), `project` (opcional), `expand=projects` (máscaras por proyecto). Respuesta:

- `catalog_version`, `epoch` (`access_epoch` de la org), `user` (id, status), `platform` (lista de permisos de plataforma),
- `org` (id, slug, `template` {slug, version, label}, `permissions[]` a nivel org),
- `project_default` (permisos que se tienen en proyectos sin asignación propia: lo que la UI usa en listados y menús de nivel organización),
- `aggregate` (unión de permisos de proyecto en CUALQUIER proyecto visible: decide si un menú de nivel org tiene sentido, por ejemplo "Databases"),
- `projects` (solo con `expand=projects`): `{ "<project_id>": {"mask": "<hex>", "source": "org|explicit|inherited"} }` sobre un `catalog` ordenado que se devuelve una vez (`catalog_index`), para no repetir 99 cadenas por proyecto; con `project=<id>` devuelve `permissions[]` en claro.
- Cabeceras: `ETag` (hash del contenido) y `Cache-Control: private, max-age=0, must-revalidate`; la UI usa `If-None-Match` y recibe `304`. `X-Access-Epoch` en todas las respuestas autenticadas para que la UI detecte cambios sin consultar.
- Coste: una lectura de la caché de snapshot (sec. 12), sin consultas a base de datos en acierto.

La UI no tiene copia de las reglas: `useCan(perm, {project?})` lee de este endpoint; el servidor sigue siendo la autoridad (un menú oculto no es una protección).

### 11.2 Errores

Se conservan los códigos HTTP y mensajes de hoy (`403 FORBIDDEN "not a member"`, `404 NOT_FOUND "project not found"`, `403 FORBIDDEN "your project role does not allow this action"`). Se añade, solo cuando el recurso es visible para el actor: `error.details = {permission: "database:create", scope: {type, id}, missing: [...], reason: "no_grant|ceiling|suspended|token_scope|expired"}` y un código nuevo `PERMISSION_DENIED` (el campo `code` actual de las respuestas de este tipo es `FORBIDDEN`; se mantiene `FORBIDDEN` en `code` durante la compatibilidad y `PERMISSION_DENIED` va en `details.code`). Nunca se devuelve `details` ni distinción de motivo cuando el resultado es 404 (no filtrar existencia).

### 11.3 Auditoría

Cada cambio de acceso escribe en `audit_logs` (misma tabla, solo `GET`) con `action` `access.*` (cabe en `varchar(50)`), `resource_type` en `template|group|group_member|assignment|org_member|invitation|token|org_policy`, `resource_id`, `old_values`/`new_values` (JSON), `ip_address`, `user_agent`, `project_id` cuando aplica, y `metadata` con `request_id`, `via` (`session|token`), `token_id`, `on_behalf_of` y `impact` (personas afectadas). Eventos: `access.template.created|updated|archived|cloned|published`, `access.group.created|updated|archived`, `access.group_member.added|removed|expired`, `access.assignment.granted|changed|revoked|expired`, `access.org_member.role_changed|suspended|reactivated|removed`, `access.invitation.created|accepted|revoked|expired`, `access.owner.transferred`, `access.mode.changed`, `access.token.revoked_by_admin`, `access.denied` (solo permisos `sensitive`, con límite de frecuencia por (usuario, permiso) para no inundar). Una escritura de acceso y su fila de auditoría van en la MISMA transacción (si falla la auditoría, falla el cambio). Hoy `Audit` de `project_members` es un paso aparte: se corrige. La CSV de `audit:export` conserva su formato y añade las columnas nuevas al final.

### 11.4 Simulador y "explicar"

`POST /orgs/{org}/access/simulate` con `{user, permission, scope:{type,id}, token?, what_if?}` (requiere `assignment:read`; cualquiera puede explicarse a sí mismo por `GET /me/permissions/explain`). Respuesta: `allowed`, `reason`, y un `trace` ordenado y estable con los pasos de la sec. 5.3: pertenencia y estado, plantilla de org (versión), floor, base y política (open/restricted/override), asignaciones propias (directas y por grupo, con plantilla, versión, caducidad, quién y cuándo las dio), techo, token, y el paso decisivo. `what_if` admite SOLO una lista de asignaciones hipotéticas para ver el diff (permisos que ganaría o perdería); no es un lenguaje de reglas. El simulador es una vista del MISMO código que decide (`Engine.Explain` devuelve el rastro y `Can` usa la misma función), con una prueba que exige `Explain(x).allowed == Can(x)` sobre miles de casos.

## 12. Evaluación, caché y rendimiento

### 12.1 Snapshot por (usuario, organización)

El motor compila, una vez por (usuario, org, epoch), una estructura inmutable: estado de membresía, bitsets de 128 bits (`permissions`, `floor`, `base`, `ceiling` de la plantilla), bitset "todos los proyectos" de las asignaciones de alcance org, y tres mapas `project_id -> bitset`, `repo_id -> bitset`, `env_id -> bitset` con SOLO los alcances que tienen asignaciones propias, más `next_expiry` y `epoch`. Un proyecto sin entrada usa el respaldo (`base` solo si open) sin materializarse, así 10 000 proyectos y 50 000 asignaciones a un grupo no explotan memoria: el tamaño crece con el número de asignaciones del usuario, no con el de proyectos. `Can` es: lookup en mapa, unión y máscara de bitsets, test de un bit (sin asignaciones de memoria; objetivo <= 200 ns).

- Caché en proceso con presupuesto de bytes (por defecto 64 MB, LRU), clave `(user_id, org_id)`.
- `FilterProjects`/`Visibility`: una pasada O(N proyectos) de tests de bit sobre la lista que el handler ya tiene; sin consultas por proyecto.
- Las listas de grupos del usuario y las asignaciones de grupo se resuelven al compilar: una consulta con `UNION` por `(subject_type, subject_id)` indexada (sec. 14).

### 12.2 Invalidación y revocación inmediata

- Cada escritura de acceso incrementa `organizations.access_epoch` (y `users.access_epoch` si cambia la cuenta) EN LA MISMA TRANSACCIÓN y ejecuta `NOTIFY capsule_access, '<org_id>'` al confirmar.
- Todas las instancias hacen `LISTEN capsule_access` y expulsan los snapshots de esa org; el proceso que escribe además expulsa localmente antes de responder (lectura propia consistente).
- Red de seguridad: TTL de 30 s por snapshot (si se pierde un NOTIFY, el peor retraso es 30 s) y `next_expiry` para caducidades.
- **Ruta estricta** para permisos `sensitive` y para toda decisión de tokens `cap_`: se compara el `access_epoch` de org y usuario (una consulta por clave primaria, <= 1 ms local) con el del snapshot; si difiere, se recompila al instante. Suspender a alguien, quitarle un rol o revocar un token es efectivo en la siguiente petición sensible incluso si falla el NOTIFY. Para lecturas no sensibles el límite es la entrega del NOTIFY (milisegundos) con TTL 30 s como techo, coherente con "revocar surte efecto en <= 30 s" de los tokens Git de hoy.
- Los tokens Git y de gateway siguen validándose como hoy (hash + reevaluación del rol por uso), ahora con `Engine.Can`.

### 12.3 Presupuesto de rendimiento (medible, ver WORKBREAKDOWN)

| Operación | Objetivo p99 | Cómo se mide |
|---|---|---|
| `Can` con snapshot en caché | < 0,2 ms (benchmark en proceso; objetivo de diseño 200 ns/op) | `go test -bench`, 99 permisos, usuario con 500 asignaciones |
| Decisión por petición, extremo a extremo con caché (middleware + `Can` + ruta estricta si es sensible) | < 5 ms | prueba con Postgres real local, 1000 peticiones, p99 |
| Compilar snapshot, usuario con 10 000 asignaciones y 5 000 proyectos | < 50 ms | prueba con Postgres real local |
| `GET /me/permissions?expand=projects` con 5 000 proyectos visibles | < 25 ms servidor, < 300 KB sin comprimir | prueba de carga local |
| Evictión tras escritura (mismo proceso) | siguiente petición ya ve el cambio | prueba de lectura propia |
| Otro proceso, tras `NOTIFY` | < 1 s p99 (techo 30 s) | prueba con dos procesos |
| Ruta estricta (epoch por PK) añadida a una petición sensible | < 1,5 ms | misma prueba |

## 13. Seguridad

### 13.1 Escalada de privilegios

1. **No-escalada al asignar:** para crear o cambiar una asignación (a usuario o grupo, en cualquier alcance), el actor debe tener `assignment:grant` en ese alcance Y su conjunto efectivo en ese alcance debe CONTENER todos los permisos de la plantilla (y del `floor`/`base` si es de organización). `owner` queda exento. Esto impide que un admin de proyecto entregue `promotion:approve` o `database:query` que él no tiene, y que un admin de org asigne `owner`.
2. **Membresía de grupo es una concesión:** añadir a alguien (o a uno mismo) a un grupo exige `group:manage` Y contener la unión de lo que ese grupo concede (calculada en el alcance de cada asignación). Un `group:manage` sin los permisos del grupo solo puede quitar miembros.
3. **Auto-concesión:** nadie puede crear ni ampliar una asignación sobre sí mismo salvo `owner` (impide el bucle "me hago admin del proyecto porque administro el grupo").
4. **Edición de plantillas:** solo añadir lo que se posee (sec. 4.3); una plantilla en uso por el `owner` o por el último `admin` de un proyecto no se vacía (la invariante "queda al menos un portador de `assignment:grant`" se comprueba antes de guardar).
5. **Propiedad:** un `admin` no toca a un `owner` (sec. 7.5); `owner` no se concede por invitación; la transferencia exige reautenticación y aceptación.
6. **Techo:** una plantilla con techo no se puede asignar como `base` a quien no la tiene; el techo se aplica siempre al final (no existe asignación que lo eluda).
7. **Grupos OIDC:** reglas de sec. 6.3 (sin permisos sensibles por mapeo salvo `allow_privileged`).

### 13.2 Confused deputy

- La organización SIEMPRE sale de la ruta y se verifica contra `projects.org_id` (patrón `authorizeResourceProject`); ningún id de organización o proyecto del cuerpo de la petición se acepta como autoridad. La prueba de equivalencia incluye un caso de proyecto de otra org.
- Los componentes que actúan por otros tienen identidad y permisos propios y mínimos, nunca los de un usuario: el webhook de Git entrante (`POST /hooks/git/{projectID}`, firmado) actúa como `system:webhook` solo con `deployment:create`/`preview:manage` sobre ESE proyecto; el reconciliador de Forgejo lee verdad de Capsule y escribe con la cuenta de servicio de Forgejo; el CLI/credential helper emite tokens `cgt_` que se reevalúan por uso. Cada fila de auditoría de una acción por delegación lleva `actor_label` (ya existe) y `on_behalf_of`.
- Los tokens (`cap_`) heredan del usuario pero nunca lo amplían (sec. 9.1); un token no puede crear tokens ni conceder acceso (`tokenable=false`).
- La UI no es autoridad: todo `x-permission` se aplica en servidor.

### 13.3 Último owner y propiedad

Sec. 7.5. Pruebas obligatorias: concurrencia de dos owners que se degradan a la vez (bloqueo de fila: uno recibe `409 LAST_OWNER`), suspensión de plataforma del único owner (`409`), borrado de cuenta (`409`).

### 13.4 Otras superficies

- **Enumeración:** 404 para recursos no visibles; el simulador y `explain` solo describen alcances visibles al actor; las listas (`members`, `groups`, `assignments`) filtran por visibilidad de proyecto.
- **Fuga por tiempo:** la ruta 404 y la 403 hacen el mismo trabajo de resolución antes de responder (la comprobación de existencia del recurso no se salta).
- **Límites:** plantillas por org <= 200; permisos por plantilla <= 200; grupos por org <= 500; miembros por grupo <= 5 000; asignaciones por org <= 100 000; asignaciones iniciales por invitación <= 20. Rechazar con `422` antes que degradar el rendimiento.
- **Integridad de datos:** `CHECK` de formato en slugs y permisos; asignaciones con `UNIQUE (subject_type, subject_id, scope_type, scope_id, template_id)` entre las vivas; clave foránea a la organización en todo; `org_id` repetido en `access_assignments` con `CHECK` contra el proyecto vía trigger o `FOREIGN KEY (scope_id, org_id)` en la tabla de proyectos para impedir un proyecto de otra org.
- **Reproducción de invitaciones:** token de un solo uso, hash almacenado, comparación en tiempo constante, límite de intentos por IP, caducidad.
- **Registro de decisiones denegadas** solo para `sensitive` y con límite de frecuencia (13.4 y sec. 11.3).
- **Integridad de la auditoría:** solo `GET` (sin cambios); una cadena de hashes para detectar manipulación directa en BD queda como decisión D13.

## 14. Esquema de datos (boceto normativo; el SQL real lo escriben los paquetes P2-P4)

Convenciones del repo: migraciones `NNNNNN_nombre.up.sql/.down.sql` en `backend/internal/repository/migrations/`, idempotentes (`IF NOT EXISTS`), con `.down.sql`. Siguiente número libre: **000065** (el directorio termina en 000064). Rangos en `WORKBREAKDOWN.md`.

```
-- 000065 usuarios y política
ALTER TABLE users ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted'));
ALTER TABLE users ADD COLUMN platform_role text NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','admin'));
ALTER TABLE users ADD COLUMN access_epoch bigint NOT NULL DEFAULT 0;
  -- backfill: status = (role='suspended' ? 'suspended':'active'); platform_role = (role='admin' ? 'admin':'user'); users.role se conserva
ALTER TABLE organizations ADD COLUMN access_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN access_settings jsonb NOT NULL DEFAULT '{}'; -- temp_access_max_days, invite_requires_acceptance, engine ('v1'|'shadow'|'v2'), custom_roles
ALTER TABLE projects ADD COLUMN access_override text CHECK (access_override IN ('open','restricted'));

-- 000066 plantillas
role_templates(id uuid pk, org_id uuid null refs organizations on delete cascade, kind text check in ('org','project','repo'),
  slug text, name text, description text, system bool, cloned_from uuid null, current_version int, archived_at timestamptz,
  created_by uuid, created_at, updated_at, UNIQUE NULLS NOT DISTINCT (org_id, kind, slug))
role_template_versions(template_id refs role_templates, version int, permissions text[], ceiling text[] null,
  floor_template_id uuid null, base_template_id uuid null, note text, created_by uuid, created_at, PRIMARY KEY (template_id, version))
  -- filas inmutables: trigger BEFORE UPDATE/DELETE que lanza excepción

-- 000067 grupos
groups(id, org_id, slug, name, description, source text check in ('manual','oidc'), external_ref text, archived_at, created_by, created_at, UNIQUE (org_id, slug))
group_members(group_id, user_id, source text, added_by, added_at, expires_at null, PRIMARY KEY (group_id, user_id))
  INDEX (user_id)  -- usuario -> grupos en la compilación del snapshot

-- 000068 asignaciones
access_assignments(id, org_id, subject_type text check in ('user','group'), subject_id uuid,
  scope_type text check in ('org','project','repo','env'), scope_id uuid, template_id uuid, pinned_version int null,
  source text, reason text, expires_at timestamptz null, created_by uuid, created_at, revoked_at null, revoked_by null)
  UNIQUE (subject_type, subject_id, scope_type, scope_id, template_id) WHERE revoked_at IS NULL
  INDEX (org_id, subject_type, subject_id) WHERE revoked_at IS NULL     -- compilación del snapshot
  INDEX (scope_type, scope_id) WHERE revoked_at IS NULL                  -- "quién tiene acceso a X"
  INDEX (expires_at) WHERE revoked_at IS NULL AND expires_at IS NOT NULL -- barrido

-- 000069 miembros e invitaciones
ALTER TABLE org_members ADD status, template_id, template_version, suspended_at, suspended_by, invited_by; -- role se conserva (etiqueta heredada)
invitations(id, org_id, email citext, template_id, group_ids uuid[], assignments jsonb, token_hash char(64) unique, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at)
ownership_transfers(id, org_id, from_user, to_user, status, expires_at, created_at, accepted_at)

-- 000070 tokens
ALTER TABLE api_tokens ADD COLUMN permissions text[] NULL, ADD COLUMN org_id uuid NULL REFERENCES organizations(id);
  -- NULL permissions => alcance heredado (sec. 9.2). Sin migración de datos.

-- 000071 aprobadores y mapas externos (cuando toque)
group_sources, group_source_rules (sec. 6.3, paquete P12)
```

El catálogo NO está en la base de datos. Las plantillas del sistema se siembran/versionan desde código en una migración de datos idempotente (`INSERT ... ON CONFLICT DO NOTHING`) que fija sus UUID (derivados de `uuid_v5(namespace, kind/slug)`) para que ambos entornos coincidan.

## 15. Decisiones abiertas y recomendación

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| D1 | Denegación explícita | no / una lista `deny` por usuario y alcance | **No** (sec. 5.5). Reabrir solo ante un caso real que techo + `restricted` + plantillas no cubra. |
| D2 | Grupos anidados | no / profundidad 2 | **No** en v1; punto de extensión definido (sec. 6.2). |
| D3 | Varios owners | uno solo / varios | **Varios** con invariante de último owner. Quita un punto único de fallo humano y no complica el motor. |
| D4 | Invitación a usuario existente | inmediata (hoy) / con aceptación | Opción por org, **por defecto el comportamiento actual**; con aceptación para orgs nuevas tras el piloto. |
| D5 | Tokens `*` | mantener / deprecar | Mantener por compatibilidad; los nuevos `*` exigen `--allow-all` y caducidad <= 90 d; avisar en `capsule tokens list`; revisar a los 2 lanzamientos. |
| D6 | Principales de servicio de org (sustituir "token del creador") | v1 / más adelante | **Más adelante**; v1 revoca al dar de baja y deja visible al creador. |
| D7 | Solicitud de acceso (pedir permiso desde la UI) | v1 / más adelante | **Más adelante** (añade flujo, notificaciones, caducidad ya cubierta por acceso temporal). |
| D8 | SSO externo e importación de `groups` | incluir / diferir | **Diferir** hasta que haya IdP externo (no existe login federado hoy); el esquema ya lo prevé. |
| D9 | Plantilla editada: seguir la última o fijar versión | seguir / fijar | **Seguir por defecto**, `pin_version` opcional, con `dry_run` de impacto obligatorio en la UI. |
| D10 | Equipos de Forgejo `-read/-write` en lugar de `-viewer/-deployer/-admin` | cambiar / mantener | **Cambiar** con doble proyección una versión; admin y deployer ya eran idénticos para Forgejo. |
| D11 | Correcciones de comportamiento (G7 readonly crea proyectos, G8 facturación abierta) | ahora / opt-in por org con aviso | **Opt-in por org con aviso y luego por defecto en orgs nuevas**; nunca dentro de la migración de equivalencia. |
| D12 | Roles de plataforma granulares | v1 / más adelante | **Más adelante**; dos valores y siete permisos bastan. |
| D13 | Cadena de hashes en `audit_logs` (detección de manipulación) | v1 / v1.1 | **v1.1**; el log ya es solo-lectura por HTTP. |
| D14 | Menú: ocultar o mostrar bloqueado lo que no se puede ver | ocultar / candado | **Ocultar** secciones sin permiso de lectura (lo pidió el dueño); en páginas visibles, deshabilitar acciones con la razón en un tooltip. |
| D15 | `PUT /members/{u}` legado con asignaciones personalizadas existentes | sobrescribir / rechazar | **Rechazar con `409 MIXED_ASSIGNMENTS`** salvo `?replace=all` (nunca perder permisos sin querer). |
| D16 | Varios repos por proyecto | no / sí | **No** por ahora (hoy 1:1); el alcance `repo` ya lo admite sin cambiar el modelo. |
| D17 | Alcance de `project:create` para `readonly` y `member` tras la corrección | solo member+ / solo admin+ | **member o superior**; `readonly` no crea nada. |

## 16. Qué NO hace este diseño (a propósito)

Sin lenguaje de políticas ni condiciones (ABAC): no hay "solo de lunes a viernes" ni "solo desde esta IP" en permisos (la IP de bases y puertos ya tiene sus listas propias en `network:manage`). Sin permisos por base de datos o por puerto individual (heredan del proyecto): si aparece la necesidad, el alcance `env`/`repo` demostró cómo extender sin tocar la evaluación. Sin herencia de plantillas (una plantilla no extiende a otra: se clona). Sin grupos anidados ni denegación en v1.

## 17. Repositorios públicos y contribución externa (FASE APARTE, después del motor base)

Requisito posterior del dueño. Se diseña aquí pero NO bloquea ni entra en la migración de equivalencia: sus permisos son nuevos (ninguna acción actual
los concede, así que no cambian el comportamiento de nadie) y su paquete de trabajo es la fase P de `WORKBREAKDOWN.md`. Hoy todo es privado:
`DEFAULT_PRIVATE=private`, `REQUIRE_SIGNIN_VIEW=true`, y el Caddyfile solo manda por `forward_auth` las rutas Git con cabecera `Authorization`; sin ella llegan a Forgejo, que las rechaza.
Esto sustituye, SOLO para PR externos, la línea de `docs/git-capsule/SPEC.md` "sin forks en v1; PRs de forks bloqueados" (los usuarios normales siguen sin forks).

### 17.1 Permisos nuevos

| Permiso | Alcance | Quién | Notas |
|---|---|---|---|
| `repo:set-visibility` | org, project, repo | plantillas de org `owner` y `admin`; NO está en la plantilla `admin` de proyecto (se puede añadir a una personalizada) | cambia `private`/`public`; sensible; `tokens: denied`. Lleva guion porque el formato del catálogo no admite `_`. |
| `org:public-repos-policy` | org | solo `owner` | activa o desactiva la política de la organización; sensible; `tokens: denied` |
| `repo:read-public` | `public` | solo el principal anónimo y el externo | no es concedible a usuarios ni a plantillas; no tokenable |
| `pr:open-external` | `public` | solo el principal externo autenticado por GitHub | idem |

Recuento: el catálogo base (99) pasa a 103 con la fase P (67 de proyecto, 27 de organización, 7 de plataforma, 2 de principal público); sigue cabiendo en 128 bits. `repo:read-public` y `pr:open-external` tienen `scopes: [public]`: nunca aparecen en plantillas, asignaciones ni tokens (la validación los rechaza con 422).

### 17.2 Visibilidad y política de organización

- `projects.repo_visibility` = `private` (por defecto) | `public`; una sola fuente, mismo valor para el repo de Forgejo del proyecto (hoy 1:1).
- `access_settings.public_repos` = `forbidden` (por defecto, también en organizaciones existentes) | `allowed`. Con `forbidden` NINGÚN repo puede ser público: `repo:set-visibility` responde `409 PUBLIC_REPOS_FORBIDDEN`. Pasar a `forbidden` fuerza todos los repos de la org a `private` (interruptor de pánico, 17.7).
- Habilitar la política (`org:public-repos-policy`, solo owner): confirmación fuerte (escribir el slug de la organización) y reautenticación; auditoría `access.org_policy.public_repos`.
- Hacer público un repo: (1) política `allowed`; (2) `repo:set-visibility`; (3) preflight obligatorio (`POST .../visibility/preflight`): correos distintos de autor y committer de TODO el historial (se publican con el clon), escaneo de secretos del historial, ficheros > 50 MB y de nombres sensibles (`.env`, claves), tamaño total (tope 500 MB por defecto, `public_repo_max_mb`), espejos o submódulos a hosts internos; (4) confirmación fuerte: escribir `org/repo`, reautenticación (contraseña o 2FA) y casilla "entiendo que el historial, incluidos los correos de los autores, pasa a ser público y no se puede retirar de copias ya hechas"; los hallazgos críticos bloquean (`409 PREFLIGHT_BLOCKED`) salvo `acknowledge_findings=true` de un owner; (5) auditoría `access.repo.visibility_changed` con `old_values/new_values` y el resumen del preflight.
- Volver a privado (`make private`): una operación, sin reautenticación ni preflight, efecto inmediato (17.7).

### 17.3 Qué es público y qué nunca

Público (solo lectura, sin sesión) para un repo `public` de una org con política `allowed`:

| Sí | Cómo |
|---|---|
| Resumen (nombre, descripción, rama por defecto, lenguajes, licencia si hay) | `/api/v1/public/git/{org}/{repo}` |
| Árbol, ficheros y blobs en cualquier rama o etiqueta; `raw` | tope 1 MiB por blob; HTML, SVG y XML se sirven como `text/plain` o descarga, con `Content-Security-Policy: sandbox; default-src 'none'` y `X-Content-Type-Options: nosniff` |
| Ramas y etiquetas | lista y comparación mínima |
| Commits (lista y detalle, diff acotado) | autor = NOMBRE; el correo no se devuelve por la API pública (las líneas `Co-authored-by` del mensaje no se pueden filtrar: se avisa en el preflight) |
| README | Markdown saneado: sin HTML crudo, enlaces `nofollow noopener`, imágenes solo del mismo repo o por proxy propio |
| Releases (notas y archivos de fuente `zip`/`tar.gz`) | binarios adjuntos solo si el owner activa `public_release_assets` (apagado por defecto) |
| Clon anónimo HTTPS de solo lectura (`git-upload-pack`) | 17.5 |

NUNCA público, sin opción: ajustes del repo y del proyecto, reglas de protección de rama, secretos y variables (CI, entornos, organización), entornos, promociones y aprobaciones, despliegues y su estado, runs, logs y artefactos de CI, alertas de seguridad y SARIF, miembros, equipos, grupos, asignaciones, plantillas, auditoría, tokens y llaves de despliegue, webhooks, espejos y su configuración, issues y wiki (Capsule no los expone y en Forgejo quedan desactivados: `DEFAULT_REPO_UNITS` solo `repo.code,repo.pulls`), paquetes y registros de contenedores, tableros de Forgejo, PR internos y sus revisiones, previews de despliegue, `/explore` y cualquier listado de repos públicos de la plataforma (no hay directorio: se llega por enlace).

La vista pública vive en `https://app.tumi-ai.com/public/git/{org}/{repo}` (Next.js, fuera del grupo `(dashboard)`, sin guardia de sesión, sin acceso al almacén de autenticación del dashboard) y consume SOLO `/api/v1/public/git/*`, un router aparte con su propio middleware: sin cookies del dashboard, sin tokens, `Cache-Control` público, CORS `GET` sin credenciales. `{repo}` es el slug del proyecto.

### 17.4 Principales sin cuenta

Dos principales que NO son `users`, no pertenecen a ninguna organización, no tienen asignaciones, grupos ni tokens, y no pasan por `Effective(user,…)`:

| Principal | Cómo se identifica | Permisos | Efectivo si |
|---|---|---|---|
| `anonymous` | sin sesión | `repo:read-public` | el repo es `public` y la política de su org es `allowed` |
| `external:github:<id>` | sesión externa de GitHub (17.6); `<id>` numérico estable, el login solo se muestra | `repo:read-public`, `pr:open-external` | idem, más: identidad no bloqueada y límites de abuso no superados |

Función aparte `PublicEffective(principal, repo) -> set`, pura, sin snapshots de usuario (no usa la caché de la sección 12; caché propia por repo con TTL 5 s y epoch de la org). Ante recurso no público la respuesta es siempre `404` (no filtra existencia). El simulador la explica (`principal: anonymous|external`).

### 17.5 Clon anónimo en `git.tumi-ai.com` sin abrir el resto

No se toca `REQUIRE_SIGNIN_VIEW=true` ni se marca ningún repo como público en Forgejo (abriría su UI, su API y `/explore`). Propuesta (opción A, recomendada):

1. En Forgejo existe el usuario `capsule-anon`: solo lectura, sin llaves, `restricted`. El reconciliador (`gitsync`) lo mantiene en el equipo `<slug>-public-read` (permiso `read`) SOLO de los repos públicos y lo quita al volver a privado.
2. En el Caddyfile, un matcher `@git_anon` para el protocolo de LECTURA sin cabecera `Authorization`: `GET /{o}/{r}(.git)?/info/refs?service=git-upload-pack` y `POST /{o}/{r}(.git)?/git-upload-pack`. NO incluye `git-receive-pack`, LFS, `HEAD` ni `objects/` sueltos (no se ofrece el protocolo "dumb").
3. `@git_anon` llama a `forward_auth` a un endpoint interno nuevo `/internal/git-public-auth` (secreto compartido, como `/internal/git-auth`) con la ruta original. El backend responde 2xx con `X-WEBAUTH-USER: capsule-anon` solo si el repo es público, la política lo permite y la IP no está limitada; si no, `404` (Caddy lo devuelve tal cual). Forgejo ve a `capsule-anon` (el paso 1 del Caddyfile sigue borrando la cabecera entrante).
4. Cualquier otra ruta anónima sigue llegando a Forgejo sin credenciales y recibiendo 401. `deploy/forgejo/tests/smoke-caddy.sh` añade: anónimo + repo privado = 404; anónimo + `git-receive-pack` = 401; anónimo + `/explore` = redirección; anónimo + repo público + `upload-pack` = 200.

Opción B (descartada): `REQUIRE_SIGNIN_VIEW=false` con repos públicos en Forgejo: expone todas las pantallas de Forgejo de esos repos (issues, wiki, API, correos de commits vía API) y obliga a desactivar unidades una por una.

Límites de abuso, en el borde y en el backend (valores por defecto, configurables):
- Por IP y repo: 30 peticiones/min a la API pública, 6 `upload-pack`/min, máx. 2 clones simultáneos; global por IP 120/min. 429 con `Retry-After`. El módulo de tasa de Caddy hoy es opcional (`conf.d/`): para `@git_anon` pasa a obligatorio.
- Cuerpo de `upload-pack` <= 1 MiB, duración máxima 10 min, `--depth` permitido, filtros parciales desactivados (`uploadpack.allowFilter=false`), tamaño máximo del repo público 500 MB (se comprueba al publicar y en cada push; si lo supera, el repo pasa a `private` con aviso).
- Ancho de banda: presupuesto de salida por repo y día (20 GB por defecto), medido desde los logs JSON de Caddy; al agotarse, 429 para clones nuevos hasta el día siguiente y aviso al owner. Caddy no limita bytes/s: la protección real es concurrencia, presupuesto y tamaño.
- Archivos `zip/tar.gz`: mismo cupo que un clon, 1 por IP cada 10 s, tope 200 MB.
- Caché: la API pública responde con `ETag` = SHA de la referencia, `Cache-Control: public, max-age=60, s-maxage=300` para listas e `immutable` para blobs y commits por SHA; sin `Set-Cookie` ni `Vary: Cookie`; invalidación por el webhook de push (`Surrogate-Key: repo:<id>`). Un CDN delante es opcional. Las `404` se cachean 30 s como máximo.
- Detección de abuso: un externo con > 5 PR abiertos sin fusionar, o una IP con > 20 respuestas 429 en una hora, queda bloqueado temporalmente (`blocked_at`) y se audita.

### 17.6 Contribución externa con cuenta de GitHub

Regla del dueño: el visitante NO hace fork ni escribe. Solo puede ABRIR un pull request, autenticado con su cuenta de GitHub, nunca con una cuenta de usuario de este servidor.

**Identidad.** Capsule es cliente OAuth de GitHub (OAuth App, scope `read:user`, sin correo). Flujo `authorization code + PKCE + state` en `/public/auth/github/start` y `/callback`. Resultado: fila `external_identities(provider='github', provider_user_id, login, display_name, avatar_url, blocked_at)` (clave = id numérico: cambiar de login no crea otra persona; un login reutilizado no hereda nada). NO se crea `users`, `org_members`, asignación, grupo ni token. Sesión propia: cookie `__Host-capsule_ext` (HttpOnly, Secure, SameSite=Lax, `Path=/public`), 8 h, más token CSRF en cada POST; no vale en el dashboard ni en `/api/v1` fuera de `/public/*`. El `client_secret` de GitHub es un secreto de Capsule que gestiona el dueño. Esto NO es el SSO de la decisión D8: no inicia sesión en el dashboard ni importa grupos.

**Cómo llega el código sin dar escritura.** Dos entradas por la API pública con la sesión externa:
- (a) "Traer desde GitHub": el visitante indica `owner/repo@rama` de GitHub. Se exige `owner == su login` (v1). Host fijo `github.com` por HTTPS, sin seguir redirecciones a otros hosts, sin URLs libres (cierra SSRF), `git fetch --depth 50` con tope de 100 MB y 120 s, sin LFS, sin submódulos, sin hooks, en un proceso sin acceso a la red interna (egress solo a github.com).
- (b) Subir un parche (`git format-patch`/mbox, <= 1 MiB, sin binarios en v1).
- Se aplica a una rama de un FORK AISLADO del bot: organización de Forgejo `capsule-ext`, un fork privado por repo público (`capsule-ext/<org>--<repo>`) al que solo accede la cuenta de servicio. Rama `ext/gh-<id>/<n>`. El PR se abre desde esa rama hacia la rama por defecto del repo real (PR entre repos de Forgejo, sin permiso de escritura en el repo real). Autor del PR en Forgejo = el bot; título `[github:<login>] …`, etiqueta `external`, cuerpo con procedencia (URL y SHA de GitHub). Los commits conservan su autoría; no se crea ninguna cuenta de Forgejo.
- Por qué fork aislado y no una rama del repo real: una rama del repo real exigiría escritura del bot donde corre CI con secretos; el fork aislado separa el código no confiable (rama, workflows modificados) del repo de confianza, y borrar el fork borra todo el material externo.

**Ciclo de revisión.** Los mantenedores (`git:review`/`git:merge`) ven el PR en el dashboard con la insignia "externo" y la procedencia; el visitante lo ve en `/public/git/{org}/{repo}/contributions/{n}` solo con su sesión (los PR internos no son públicos). Comentarios del visitante: Markdown saneado, máx. 20/hora, publicados por el bot como `**@github:<login>:** …`. Los comentarios de mantenedores son visibles al autor solo si se marcan "visible para quien contribuye" (por defecto internos). Notificaciones: a mantenedores por `notifications`; al visitante, aviso en la vista y por correo solo si lo opta (no se guarda el de GitHub). Fusionar lo hace un mantenedor con la regla de rama habitual y no da permisos al visitante. Un PR sin actividad 30 días se cierra; al cerrarlo o fusionarlo se borra la rama del fork.

**CI de PR externos: NUNCA con secretos ni en el runner de confianza.** Los runners de hoy (`docs/ci-runner-scale-to-zero.md`, `deploy/forgejo/README.md` §8) son de confianza. Para externos:
1. Por defecto NO corre CI. Un mantenedor pulsa "Ejecutar CI sin confianza" (`ci:run`, auditado) tras revisar el diff.
2. Corre solo en un pool NO confiable aparte (etiqueta `untrusted`, instancia propia, sin rol de nube, sin red a servicios internos ni a Capsule, egress limitado, efímero, un job por máquina, destruido al terminar), sin variables ni secretos (de CI, entorno u organización), con token de solo lectura del propio fork, y con los workflows de la RAMA BASE del repo real, no de la rama del PR, salvo aprobación expresa del mantenedor.
3. `pull_request_target` y todo evento que concede secretos quedan deshabilitados para el fork aislado; el reconciliador rechaza abrir PR externos si el fork tiene secretos o si su runner es de confianza.
4. Artefactos y logs de estos runs son internos (17.3).

### 17.7 Volver a privado (`make private`) y pánico

Una operación (`capsule repo visibility private`, botón o política `forbidden`): (1) `repo_visibility = private` y `access_epoch` de la org +1; (2) `/internal/git-public-auth` y la API pública devuelven `404` desde ese instante (caché de decisión <= 5 s); (3) el reconciliador quita a `capsule-anon` y borra `<slug>-public-read`; (4) purga de caché por `Surrogate-Key`; (5) cierra los PR externos abiertos (no los borra) y suspende sesiones externas nuevas para ese repo; (6) auditoría `access.repo.visibility_changed`. La UI avisa siempre de que lo ya clonado o indexado por terceros no se puede retirar.

### 17.8 Riesgos específicos

| Riesgo | Mitigación |
|---|---|
| Filtrado de historial (secretos, correos, ficheros grandes) | preflight obligatorio con escaneo; correos del historial listados; bloqueo por hallazgos críticos; aviso de irreversibilidad |
| Issues, wiki, paquetes, artefactos y ajustes de Forgejo | Capsule no los expone; Forgejo sigue con `REQUIRE_SIGNIN_VIEW=true`, sin esas unidades; `capsule-anon` solo lee código |
| Correos en commits | no se devuelven por la API pública; en el clon son inevitables (preflight) |
| SSRF y espejos | el flujo externo solo habla con `github.com`; sin URLs libres; los espejos de repos públicos usan la misma lista de destinos permitidos de `git:mirror` |
| XSS por contenido (README, SVG, HTML) | saneado, `text/plain`/sandbox, CSP estricta, origen sin cookies del dashboard |
| Abuso de recursos | límites de 17.5, tamaño máximo, presupuesto de salida |
| PR externo malicioso (workflows, hooks, binarios) | fork aislado, sin CI por defecto, runner no confiable sin secretos, workflows de la rama base |
| Suplantación de identidad GitHub | clave = id numérico, `state`+PKCE, cookie con `Path=/public`, CSRF |
| Confusión dashboard vs público | UI distinta (insignia "Público", sin menú del dashboard), UX sec. 8 |
| Repo público por descuido | política `forbidden` por defecto, confirmación fuerte, auditoría y aviso semanal al owner con los repos públicos |

Decisiones abiertas de la fase P: D18 entradas (a) y (b) en v1 (recomendación: ambas); D19 PR desde organizaciones de GitHub (después); D20 binarios de releases públicos (apagado); D21 CDN delante (cuando haya tráfico; el diseño no lo exige).
