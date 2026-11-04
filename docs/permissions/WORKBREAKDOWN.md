# Desglose de trabajo

Paquetes ejecutables por agentes en paralelo, con archivos poseídos (nadie más los toca), contratos que exponen y consumen, dependencias, esfuerzo
(persona-días de un agente, redondeado) y criterios de aceptación medibles. Estimaciones con +-30 %.

Dos bloques: **motor base** (P0-P11) y **fase P: repos públicos y contribución externa** (PP1-PP7), que empieza cuando el motor base esté en F3
(decisión del motor nuevo estable, `MIGRATION.md`) y no bloquea la migración.

## 1. Rangos de migración (siguiente libre: 000065; el directorio llega a 000064)

| Rango | Dueño | Contenido |
|---|---|---|
| 000065-000070 | P2 | usuarios (status, platform_role, epoch), organizaciones (epoch, settings), proyectos (override), plantillas y versiones, grupos, asignaciones, columnas de `org_members`, invitaciones, transferencias, `api_tokens.permissions/org_id`; siembra de plantillas; triggers de sincronización |
| 000071-000079 | reservado al motor base | fuentes de grupos externos (P12 opcional), índices, correcciones |
| 000080-000084 | PP1 | `projects.repo_visibility`, ajustes públicos de la org, `external_identities`, `external_contributions`, presupuesto de salida |
| 000085-000099 | reservado | ampliaciones de la fase P y siguientes |

Cada migración lleva su `.down.sql`, es idempotente, y se prueba `up/down/up` (reglas de la sec. 5). Nadie crea un número fuera de su rango.

## 2. Reglas comunes a todos los paquetes

1. No editar archivos de otro paquete. Si hace falta un cambio en un archivo ajeno, se abre petición al dueño (lista en la columna "Archivos").
2. Un cambio de comportamiento visible para nadie salvo en los pasos de la sec. 7 de `MIGRATION.md`.
3. `go vet ./...`, `go test -race ./...` del paquete, `gofmt`, linters del repo; frontend: `tsc --noEmit`, lint y pruebas del repo.
4. Sin secretos en el código ni en los tests; los valores de prueba salen de fixtures.
5. Documentar lo que se haga en el mismo PR (godoc, `docs/permissions` si cambia el contrato).
6. Cada PR indica qué criterios de aceptación cubre y adjunta la salida de las pruebas.

## 3. Motor base

### P0 Catálogo, plantillas del sistema como datos, oráculo y tabla de rutas  (5 d)

- Archivos: `backend/internal/authz/catalog/*.go`, `backend/internal/authz/catalog/catalog.json` (generado) , `backend/internal/authz/systemtemplates.json`, `backend/internal/authz/legacy_oracle_test.go` (copia congelada de `Resolve`/matriz con build tag de test), `backend/tools/routeperms/` (extractor `go/ast` ruta -> acción vieja), `backend/internal/authz/routes_authz.golden`.
- Expone: `catalog.All() []Perm`, `catalog.Has(id)`, `catalog.Expand(old authz.Action) []string`, tipo `catalog.Set` (bitset 128 bits: `Has`, `Union`, `Intersect`, `ContainsAll`), `catalog.Version`, `systemtemplates` cargables (`Org(slug)`, `Project(slug)`, `Repo(slug)`).
- Consume: `authz` actual (solo lectura).
- Depende de: nada.
- Aceptación: (1) el catálogo tiene exactamente 99 entradas con los identificadores de `SPEC.md` y un test compara contra la tabla de la spec (parseando `SPEC.md` sec. 3); (2) `TestSystemTemplatesMatchLegacyMatrix` (MIGRATION 5.1) verde; (3) ninguna acción de `AllActions`+`GitActions`+`GatewayActions` sin `Expand` (23 de 23); (4) `routes_authz.golden` cubre el 100 % de las rutas del router (el extractor falla si una ruta no tiene fila); (5) `catalog.json` regenerable y sin cambios en CI (`make catalog-check`).

### P1 Evaluador, snapshot y caché  (8 d)

- Archivos: `backend/internal/authz/engine/*.go` (`engine.go`, `snapshot.go`, `cache.go`, `explain.go`, `legacyrole.go`, `store.go`, `memstore_test.go`, `equivalence_test.go`, `bench_test.go`).
- Expone: `engine.Engine` con `Effective(ctx, user, org, scope) (Access, Set, error)`, `Can(ctx, user, scope, perm) (bool, error)`, `CanAll`, `Explain(...) Decision`, `FilterProjects`, `Visibility`, `LegacyRole(Set)`, `Invalidate(org|user)`, interfaz `engine.Store` (carga de plantilla de org, asignaciones de usuario y grupos, política, override por proyecto, aprobadores) y adaptador `engine.AsLegacy(*Engine) authz.Service-compatible`.
- Consume: P0 (catálogo, plantillas).
- Depende de: P0.
- Aceptación: (1) matriz exhaustiva de 2 070 casos (MIGRATION 5.1) y 90 combinaciones de `Access` con 0 diferencias frente al oráculo; (2) `Explain(x).allowed == Can(x)` en 20 000 casos aleatorios; (3) propiedad de monotonía: añadir una asignación nunca quita un permiso (10 000 casos); techo siempre aplicado; (4) benchmark `BenchmarkCan` <= 200 ns/op y 0 asignaciones de memoria con snapshot en caché, usuario con 500 asignaciones (se registra el resultado); (5) compilación de snapshot <= 50 ms con 10 000 asignaciones y 5 000 proyectos (con el store en memoria); (6) cobertura >= 90 % del paquete; (7) `-race` sin hallazgos.

### P2 Esquema, repositorio y siembra  (7 d)

- Archivos: `backend/internal/repository/migrations/000065_*` a `000070_*` (up y down), `backend/internal/repository/access_store.go`, `access_templates.go`, `access_groups.go`, `access_assignments.go`, `access_notify.go`, `access_*_db_test.go`, `backend/internal/repository/access_seed.go`.
- Expone: `repository.AccessStore` que implementa `engine.Store` y los comandos de escritura transaccionales (`CreateTemplate`, `PublishVersion`, `SetOrgTemplate`, `Assign`, `Revoke`, `AddGroupMember`, ..., cada uno incrementa `access_epoch` y hace `NOTIFY capsule_access` en la misma transacción), `Listen(ctx, func(orgID))`.
- Consume: P0 (siembra desde `systemtemplates.json`, UUID deterministas).
- Depende de: P0.
- Aceptación: (1) `up`, `down`, `up` ejecutados sobre base vacía y sobre base con datos (orgs de los 4 roles, `project_members` en 3 roles, usuarios admin/suspendidos/raros); (2) recuentos de MIGRATION sec. 2 correctos; (3) triggers sin bucle y probados (`project_members` <-> `access_assignments`, `org_members.role` <-> `template_id`, `users.role` <-> `platform_role/status`); (4) plantillas del sistema inmutables (UPDATE/DELETE de versiones falla); (5) índices usados en `EXPLAIN` de la carga de snapshot (sin `Seq Scan` en `access_assignments` con 100 000 filas); (6) carga de snapshot de un usuario con 10 000 asignaciones <= 50 ms medidos con Postgres real; (7) `NOTIFY` recibido por un segundo proceso < 1 s (p99 sobre 1 000 eventos).

### P3 Cableado en sombra y decisión + tabla de rutas  (10 d)

- Archivos: `backend/internal/authz/authz.go` (se mantiene la API; `Service` delega), `backend/internal/authz/shadow.go`, `backend/internal/server/handlers/authz_support.go`, `backend/internal/server/middleware/tokengate.go`, `backend/internal/server/routeperms.go` (tabla única), `backend/internal/server/router.go` (solo líneas de cableado), `backend/internal/config` (interruptor `CAPSULE_AUTHZ_ENGINE`), `backend/internal/metrics` (contadores de sombra).
- Expone: `authorize(..., perm string)` con átomos; `routePermissions`; modos `v1|shadow|v2` global y por org; métricas `authz_shadow_total/_mismatch_total/_seconds`; `middleware.TokenPerms(ctx)`.
- Consume: P1, P2.
- Depende de: P1, P2.
- Aceptación: (1) suite vieja (`authz_test.go`, `git_authz_test.go`, `project_members_test.go`, `gittokens`, `gitsync`, handlers) verde con `v1` y con `v2` (MIGRATION 5.2); (2) test "toda ruta del router tiene fila en `routePermissions`" y "la tabla coincide con los `x-permission` de `API.openapi.yaml`"; (3) modo sombra: 0 diferencias en 100 000 decisiones generadas contra Postgres real y +<= 1 ms p99 por petición; (4) decisión extremo a extremo con caché < 5 ms p99 (1 000 peticiones, Postgres real), con ruta estricta < 1,5 ms adicionales; (5) revocación: tras `Revoke` en el mismo proceso la siguiente petición ya niega; en otro proceso < 1 s (techo 30 s); (6) un token acotado sobre ruta sin entrada recibe 403.

### P3b Migración mecánica de handlers a átomos  (6 d, tres agentes en paralelo)

Cada subpaquete posee SOLO sus archivos (cambiar la acción vieja por el átomo de `routes_authz.golden`; sin cambiar lógica):
- P3b-1: `project.go`, `project_members.go`, `deployment.go`, `deployment_rollback.go`, `envvar.go`, `environments.go`, `promotions.go`, `apitoken.go`, `recover.go`, `logs.go`, `webhooks.go`, `cronjobs.go`, `workers.go`.
- P3b-2: `database.go`, `database_access.go`, `storage.go`, `backups.go`, `domain.go`, `email.go`, `network.go`, `project_ports.go`, `connaudit.go`, `orgenv.go`, `org.go`, `org_members.go`, `audit.go`, `billing.go` (solo anotar el átomo y la ruta; la corrección C3 va aparte).
- P3b-3: `git.go`, `git_core.go`, `git_mirror.go`, `git_protect.go`, `git_review.go`, `gitapi_*.go`, `insights.go`, `renovate.go`, `security.go`, `gateway/api/*` (permiso `gateway:connect`).
- Aceptación (cada uno): `routes_authz.golden` sin diferencias para sus rutas; pruebas del handler sin cambios y verdes; 0 referencias a `authz.Project*|Git*|Security*|Env*|Webhooks*` en sus archivos salvo la capa de compatibilidad.

### P4 API de plantillas, grupos, asignaciones, `/me/permissions`, simulador, auditoría  (10 d)

- Archivos: `backend/internal/service/access/*.go`, `backend/internal/server/handlers/access_templates.go`, `access_groups.go`, `access_assignments.go`, `access_me.go`, `access_simulate.go`, `access_audit.go`, tests, y el cableado de rutas nuevas en `router_access.go` (archivo propio incluido desde `router.go` por P3).
- Expone: todas las rutas de `API.openapi.yaml` salvo invitaciones, propiedad, tokens y fase P; `access.Service` (`CheckNoEscalation`, `ImpactOf`, ...).
- Consume: P1, P2, P3.
- Depende de: P3.
- Aceptación: (1) cada ruta responde conforme al OpenAPI (validación de contrato automática con `kin-openapi` en CI); (2) regla de no-escalada: 40 casos negativos (admin de proyecto que intenta entregar `database:query`, auto-concesión, añadir a grupo sin contener sus permisos, editar plantilla para añadir lo que no tiene) devuelven 403 `ESCALATION`; (3) cada escritura deja su fila de auditoría en la misma transacción (prueba: fallo de auditoría revierte el cambio); (4) `GET /me/permissions` con 5 000 proyectos: < 25 ms servidor, < 300 KB, `304` con `If-None-Match`; (5) simulador: `allowed` idéntico a `Can` (comprobado en 1 000 casos); (6) límites (200 plantillas, 500 grupos, 100 000 asignaciones) devuelven 422; (7) 404 para recursos no visibles, sin diferencias de forma ni de tiempo apreciables entre inexistente y no visible (prueba de comparación de tamaños y de rutas de código).

### P5 Ciclo de vida: invitaciones, suspensión, baja, propiedad, acceso temporal  (8 d)

- Archivos: `backend/internal/service/accesslifecycle/*.go`, `handlers/invitations.go`, `handlers/ownership.go`, `handlers/org_member_status.go`, `handlers/admin.go` (traducción a `status/platform_role`), `handlers/org_members.go` (solo los puntos de compatibilidad, coordinado con P3b-2), `backend/internal/jobs/access_expiry.go` (barrido por minuto), plantillas de correo.
- Expone: invitaciones, transferencia, suspensión/reactivación, `LastOwner` guard, barrido de caducidades, baja con limpieza completa.
- Consume: P2, P3, P4 (servicio de asignaciones).
- Depende de: P3, P4.
- Aceptación: (1) invariante de último owner: dos owners que se degradan a la vez, uno recibe 409 (prueba concurrente con 100 repeticiones); suspensión de plataforma y borrado de cuenta del único owner => 409; (2) baja deja 0 filas en `access_assignments`, `group_members`, `project_members` y aprobadores de esa persona y revoca sus `cgt_`/`cgs_` de la org (verificado por consulta); (3) invitación: token de un solo uso, hash en base, comparación en tiempo constante, caducidad, `EMAIL_MISMATCH`, límite de intentos; (4) transferencia exige reautenticación y aceptación, y audita ambos; (5) una asignación caducada deja de contar en el instante `expires_at` (prueba con reloj controlado) y el barrido audita `access.expired`; (6) los endpoints viejos de miembros mantienen su comportamiento (suite vieja verde).

### P6 Tokens con permisos  (6 d)

- Archivos: `handlers/apitoken.go` (creación con `permissions`; coordinado con P3b-1 para el átomo), `backend/internal/server/middleware/scope.go` (traducción de alcances heredados, `TokenAllows` pasa a la tabla), `middleware/tokengate.go` (de P3, uso), `backend/internal/gittokens/*` (`roleAllows` -> `Engine.Can`), `handlers/access_tokens.go` (`token:read-all`, `token:revoke-any`), repositorio de `api_tokens`.
- Consume: P2, P3.
- Depende de: P3.
- Aceptación: (1) tabla de rutas x alcances x proyecto (MIGRATION 5.4) con 0 diferencias frente a `TokenAllows` actual; (2) propiedad: 10 000 casos donde `decisión_token ⊆ decisión_usuario`; (3) un token con permisos explícitos no puede crear tokens ni conceder acceso (permisos no tokenables rechazados con 422 en la creación y con 403 en uso); (4) crear un token con permisos que el usuario no tiene => 403 con la lista; (5) los tokens `cap_`, `cgt_` y `cgs_` existentes siguen funcionando sin migrar datos; (6) revocar un token ajeno con `token:revoke-any` surte efecto en < 30 s (prueba con dos procesos).

### P7 Proyección a Forgejo y OIDC  (5 d)

- Archivos: `backend/internal/gitsync/*` (estado deseado vía motor, equipos `-read/-write` en doble proyección con los heredados), `backend/internal/oidc/service.go` y el inyector de `ExtraGroups` (formato idéntico, más `grp:`), pruebas existentes.
- Consume: P1, P3.
- Depende de: P3.
- Aceptación: (1) estado deseado idéntico al actual en 1 000 organizaciones aleatorias (MIGRATION 5.5), con equivalencia viewer->read y deployer/admin->write; (2) claim `groups` byte a byte igual para datos sin plantillas ni grupos personalizados; (3) alta, cambio y baja de un acceso por repo reflejados en el equipo correcto en < 1 reconciliación; (4) deriva manual en Forgejo se corrige y se audita (suite `gitsync` verde).

### P8 Frontend: estado de acceso y sidebar por permisos  (8 d)

- Archivos: `frontend/lib/access.ts`, `frontend/lib/nav.ts`, `frontend/stores/access.ts`, `frontend/components/layout/sidebar.tsx`, `components/layout/org-selector.tsx`, `components/layout/mobile-drawer.tsx`, `frontend/lib/members.ts` (retira `useProjectRole`; coordinado con P9), pruebas.
- Expone: `useAccess`, `useCan`, `useCanAny`, `<Can perm>`; el menú descrito en `UX.md` sec. 2.
- Consume: contrato `GET /me/permissions` y `/permissions/catalog` (de `API.openapi.yaml`; puede construirse con un servidor simulado de contrato antes de P4).
- Depende de: contrato de P4 (no de su código).
- Aceptación: (1) prueba de tabla `nav.ts`: cada `anyOf` existe en `catalog.json`; (2) para 8 personas de prueba (owner, admin, member, readonly, contratista de repo, aprobador, platform-admin, suspendido) el menú renderizado coincide con la matriz esperada; (3) estados cargando, error, vacío, suspendido y revocado en caliente cubiertos con pruebas; (4) accesibilidad: `axe` sin errores graves, recorrido solo con teclado (selector de org con flechas, cajón móvil con foco atrapado y `Escape`); (5) sin llamadas redundantes: `If-None-Match` con 304 en revalidaciones; (6) `tsc --noEmit` y lint limpios.

### P9 Frontend: gestión de usuarios, grupos, roles, asignaciones y simulador  (12 d)

- Archivos: `frontend/app/(dashboard)/access/**`, `frontend/components/access/**`, `frontend/lib/access-api.ts`, `components/members-tab.tsx`, `components/org-access-section.tsx`, `app/(dashboard)/admin/users/**` (si procede).
- Consume: API de P4, P5, P6, y P8.
- Depende de: P4, P5, P8.
- Aceptación: (1) cada pantalla de los mockups implementada con los estados cargando, vacío y error; (2) editor de plantillas: dependencias automáticas, vista previa de impacto, no permite marcar lo que el actor no tiene; (3) asignaciones: diálogo `WOULD_HIDE` con lista, avisos de interacción (sustituye/suma); (4) simulador muestra el rastro del servidor sin recalcular reglas en el cliente; (5) `axe` sin graves y recorrido con teclado; (6) pruebas de componentes y un flujo E2E (crear grupo, asignar plantilla en un proyecto, ver el cambio en el sidebar de otra sesión < 5 s).

### P10 CLI  (7 d)

- Archivos: `cli/cmd/capsule/roles.go`, `groups.go`, `perms.go`, `invite.go`, `access_members.go`, `owner.go`, ediciones puntuales en `oauthmembers.go` (miembros) y `tokens.go`, `exitcodes.go` (solo documentación de códigos), pruebas.
- Consume: API de P4, P5, P6.
- Depende de: P4, P5, P6.
- Aceptación: (1) cada comando de `CLI.md` con prueba de humo contra el servidor falso y de código de salida según la tabla; (2) los comandos actuales no cambian (tests existentes verdes); (3) ningún secreto en argv (invitaciones, contraseñas, TOTP por prompt o stdin); (4) `--output json` válido y estable (esquemas de ejemplo comparados).

### P11 Skill y documentación  (2 d)

Archivos: `.claude/skills/capsule/**` (según `SKILL-CHANGES.md`), `docs/permissions/*`. Depende de P10 y P9. Aceptación: cada comando de la skill existe en el CLI (script que extrae los bloques de código y ejecuta `--help`), y la skill no promete nada no implementado.

### P12 (opcional, diferido: decisión D8) SSO externo y grupos importados  (8 d)

Archivos: `backend/internal/oidc/federated/*`, migración 000071+, `handlers/group_sources.go`. Solo si hay IdP externo.

## 4. Fase P: repos públicos y contribución externa

Empieza cuando P3 esté en producción (modo `v2`) y P4 desplegado. Todo es aditivo y nada cambia para organizaciones con la política `forbidden` (por defecto).

### PP1 Datos, política, permisos y preflight  (8 d)

- Archivos: migraciones `000080_*` a `000084_*`, `backend/internal/authz/catalog` (+4 permisos, catálogo 103; coordinado con P0 mediante entrega de una versión nueva del catálogo, nunca editando `catalog.json` a mano), `backend/internal/authz/engine/public.go` (`PublicEffective`), `backend/internal/service/publicrepo/*` (política, preflight, escaneo de secretos, tamaño), `handlers/public_policy.go`, `handlers/public_visibility.go`, repositorio de las tablas nuevas.
- Expone: `PublicEffective(principal, repo)`, `publicrepo.Service` (`Preflight`, `SetVisibility`, `SetPolicy`, `ForcePrivate(org)`), rutas `/orgs/{org}/policy/public-repos`, `/projects/{p}/git/visibility[/preflight]`.
- Depende de: P3, P4 (y P0 para el catálogo).
- Aceptación: (1) catálogo = 103 y 128 bits suficientes; ninguna plantilla ni asignación ni token acepta `repo:read-public`/`pr:open-external` (422); (2) con política `forbidden` (por defecto) `SetVisibility(public)` => 409 y 0 repos públicos tras migrar (consulta); (3) publicar exige preflight <= 15 min, `confirm_repo`, casilla y reautenticación (cada omisión => error específico, 12 casos); hallazgo crítico => 409 salvo `acknowledge_findings` de un owner; (4) `repo:set-visibility` solo en `owner` y `admin` de organización (matriz sobre plantillas del sistema: no en `admin` de proyecto); (5) `ForcePrivate` deja la API pública con 404 en <= 5 s medidos y audita (`access.repo.visibility_changed`); (6) preflight detecta correos, secretos de un repo de prueba con 5 secretos plantados (5 de 5) y bloquea > 500 MB.

### PP2 API pública, vista Next.js, caché y límites  (10 d)

- Archivos: `backend/internal/server/public/*` (router aparte, middleware propio: sin cookies del dashboard, sin tokens, CORS GET sin credenciales, límites por IP), `handlers/public_git.go`, `backend/internal/service/publicrepo/render.go` (README saneado, tipos MIME seguros), `frontend/app/public/git/[org]/[repo]/**` (fuera de `(dashboard)`), `frontend/components/public/**`.
- Consume: PP1, gitcore.
- Depende de: PP1.
- Aceptación: (1) las rutas públicas solo devuelven lo de la lista "Sí" de SPEC 17.3; una batería de 60 URLs de lo "NUNCA público" (ajustes, runs, logs, artefactos, miembros, issues, wiki, packages, secretos, entornos, PR internos) devuelve 404; (2) un repo privado, una org con política `forbidden` y un repo inexistente devuelven respuestas indistinguibles (mismo cuerpo, cabeceras y orden de magnitud de tiempo); (3) la API pública nunca incluye correos (prueba sobre un repo con correos conocidos: 0 apariciones en cuerpos y cabeceras); (4) HTML/SVG se sirve con `text/plain` o descarga y CSP `sandbox` (prueba con cargas XSS conocidas en README, SVG y nombres de fichero); (5) límites: 31.ª petición/min de una IP => 429 con `Retry-After`; caché: la segunda lectura de un blob por SHA devuelve `304`/`immutable`; (6) p99 de lectura de árbol con caché < 50 ms.

### PP3 Borde Git anónimo  (6 d)

- Archivos: `deploy/forgejo/Caddyfile` (matcher `@git_anon` y `forward_auth` a `/internal/git-public-auth`), `deploy/forgejo/conf.d/rate-limit.caddy` (obligatorio para `@git_anon`), `deploy/forgejo/tests/smoke-caddy.sh` (casos nuevos), `backend/internal/server/handlers/git_public_auth.go`, `backend/internal/gitsync/public_reader.go` (usuario `capsule-anon` y equipo `<slug>-public-read`), `deploy/forgejo/README.md` (sección de borde), `deploy/forgejo/CHECKLIST.md`.
- Depende de: PP1, P7.
- Aceptación: `smoke-caddy.sh` con los casos: anónimo + repo privado = 404; anónimo + `git-receive-pack` = 401; anónimo + `/explore` = redirección; anónimo + repo público + `upload-pack` = 200 y `git clone` real funciona en un contenedor de prueba; 31.ª solicitud/min = 429; cabecera `X-WEBAUTH-USER` entrante siempre borrada (caso existente verde); `REQUIRE_SIGNIN_VIEW` sigue en `true` (comprobación de configuración); al pasar a privado, `capsule-anon` sale del equipo en la siguiente reconciliación (<= 1 min) y el clon falla; 0 cambios de comportamiento para los casos existentes del smoke (48 comprobaciones previas verdes).

### PP4 Identidad GitHub y PR externo  (12 d)

- Archivos: `backend/internal/extcontrib/*` (OAuth con PKCE y `state`, sesión `__Host-capsule_ext`, `external_identities`, fetch seguro desde GitHub, aplicación de parche, fork aislado `capsule-ext`, límites y bloqueo), `handlers/public_auth.go`, `handlers/public_contrib.go`, `backend/internal/gitcore/*` (solo adiciones: crear fork privado, rama y PR entre repos, comentar como bot; coordinado con el dueño de gitcore).
- Depende de: PP1, PP2.
- Aceptación: (1) el externo no tiene fila en `users`, `org_members`, `access_assignments` ni `api_tokens` tras 100 flujos completos (consulta); su cookie no sirve en `/api/v1` fuera de `/public/*` ni en el dashboard (prueba negativa); (2) clave = id numérico: cambiar de login no crea otra identidad; (3) fetch: solo `github.com` por HTTPS; URL con otro host, redirección a otro host, `file://`, IP interna y esquema distinto => rechazo (20 casos SSRF); tope de 100 MB y 120 s; (4) el PR se abre sin escritura en el repo real (comprobado: la cuenta del bot en el repo real no tiene rama `ext/*`; todo en `capsule-ext/<org>--<repo>`); (5) más de 5 PR abiertos o 20 comentarios/hora => 429 y bloqueo temporal auditado; (6) los comentarios del externo se publican saneados y firmados `@github:<login>`; los internos no son visibles salvo marcados; (7) cerrar o fusionar borra la rama del fork.

### PP5 CI no confiable  (6 d)

- Archivos: `deploy/` módulo de runner `untrusted` (infraestructura como código del repo, ruta exacta a confirmar al empezar; no se despliega en esta fase de diseño), `backend/internal/service/ciwake/*` (solo la rama del pool nuevo), `handlers/public_contrib_ci.go` (`run-ci`), reglas de workflows de la rama base.
- Depende de: PP4.
- Aceptación: (1) por defecto un PR externo NO dispara CI (0 runs en 50 PR de prueba); (2) `run-ci` solo con `ci:run` y deja auditoría; (3) el job corre solo en el runner con etiqueta `untrusted`; un job con etiqueta de confianza para un PR externo se rechaza; (4) dentro del job no existe ningún secreto ni variable (prueba: workflow que imprime el entorno solo muestra valores de prueba del propio fork, ninguno de la org/entorno) ni acceso de red a servicios internos (prueba: conexiones a rangos privados y al backend fallan); (5) `pull_request_target` deshabilitado en el fork; (6) el reconciliador rechaza abrir PR externos si el fork tiene secretos o el runner es de confianza.

### PP6 Dashboard y CLI de la fase P  (6 d)

- Archivos: `frontend/app/(dashboard)/projects/[id]/settings/visibility/**`, `frontend/app/(dashboard)/projects/[id]/contributions/**`, `frontend/components/public-visibility/**`, `cli/cmd/capsule/repovis.go`, `contributions.go`; sidebar: solo el aviso de repos públicos (entrada en `nav.ts` coordinada con P8).
- Depende de: PP1, PP4, P8, P10.
- Aceptación: flujos de `mockups/public-view.html` implementados; diálogo con botón deshabilitado hasta cumplir requisitos; "Volver a privado" en un clic, efecto verificado (clon y vista pública 404 en <= 5 s); comandos de `CLI.md` sec. 9 con códigos de salida; `axe` sin graves.

### PP7 Pruebas de seguridad de la fase P  (4 d)

- Archivos: `backend/internal/server/public/security_test.go`, `deploy/forgejo/tests/public-negative.sh`, informe en `docs/permissions/SECURITY-PUBLIC.md` (resultados).
- Depende de: PP2-PP5.
- Aceptación: sin hallazgos críticos ni altos abiertos en: filtrado (60 URLs), enumeración, XSS, SSRF (20 casos), fuerza bruta de sesión externa, CSRF en POST externos, abuso de recursos (clones concurrentes, archivos grandes) con los límites activos, y confusión de contexto (la cookie externa no autentica el dashboard).

## 5. Reglas de prueba (todas)

- **Postgres real** local en WSL: `wsl -d Ubuntu -u root -- pg_ctlcluster 18 main start`. Los tests de repositorio y de migración usan el helper `backend/internal/repository/dbtest_helpers_db_test.go` (archivos `*_db_test.go`); no se simula Postgres. Cada test crea sus organizaciones con UUID propios y limpia lo suyo.
- **Migraciones:** `up`, `down`, `up` y de nuevo `up` (idempotencia); sobre base vacía y sobre base sembrada; los `down` no tocan tablas anteriores.
- **Equivalencia** (P1, P3, P6, P7): las matrices de `MIGRATION.md` sec. 5 son parte del CI y bloquean el merge. El oráculo del comportamiento viejo vive en el test, no en el código de producción.
- **Concurrencia:** `-race` siempre; pruebas de invariantes con goroutines (último owner, caducidad, caché).
- **Rendimiento:** benchmarks con `-benchmem` y umbrales como aserciones en tests de integración (decisión por petición con caché < 5 ms p99; `Can` en proceso <= 200 ns/op; snapshot <= 50 ms con 10 000 asignaciones; `/me/permissions` con 5 000 proyectos < 25 ms; revocación entre procesos < 1 s p99). Los resultados se imprimen y se adjuntan al PR.
- **Contrato:** `API.openapi.yaml` validada y usada para probar cada ruta; `x-permission` comparado con `routePermissions`.
- **Seguridad:** casos negativos explícitos por paquete (escalada, token, 404 vs 403, SSRF, XSS).
- **Frontend:** `tsc --noEmit`, lint, pruebas de componentes y de hooks; `axe`; recorrido con teclado.
- **CLI:** servidor falso, tabla de códigos de salida, `--output json` estable.

## 6. Dependencias y ruta crítica

```
P0 ──┬─> P1 ──┐
     └─> P2 ──┴─> P3 ──┬─> P3b-1/2/3 (paralelo)
                       ├─> P4 ──┬─> P5 ──┐
                       │        ├─> P9 <─┤ (también P8)
                       │        └─> P10 ─┘
                       ├─> P6
                       └─> P7
P8 (contrato de P4) ──> P9
P9 + P10 ──> P11
P3 + P4 ──> [fase P] PP1 ──> PP2 ──> PP4 ──> PP5 ──> PP6 (+P8,P10) ; PP1+P7 ──> PP3 ; PP2..PP5 ──> PP7
```

## 7. Esfuerzo

| Bloque | Paquetes | Persona-días |
|---|---|---:|
| Motor base | P0 5, P1 8, P2 7, P3 10, P3b 6, P4 10, P5 8, P6 6, P7 5, P8 8, P9 12, P10 7, P11 2 | **94** |
| Opcional | P12 | 8 |
| Fase P | PP1 8, PP2 10, PP3 6, PP4 12, PP5 6, PP6 6, PP7 4 | **52** |

Ruta crítica del motor base: P0 -> P1 (en paralelo con P2) -> P3 -> P4 -> P9 = 5 + 8 + 10 + 10 + 12 = **45 días**. Con 4 a 5 agentes simultáneos, unas 9 a 10 semanas de calendario incluyendo F2 (7 días de sombra) y F3 (14 días de observación; estos no consumen esfuerzo de agente pero sí calendario). Ruta crítica de la fase P: PP1 -> PP2 -> PP4 -> PP5 -> PP6 = 8 + 10 + 12 + 6 + 6 = **42 días**, con PP3 y PP7 en paralelo. Total con fase P: unos 146 persona-días (sin P12).

## 8. Hitos de entrega

1. M1 (fin de P1, P2): equivalencia verde en CI sobre el motor en memoria y sobre Postgres real.
2. M2 (fin de P3): modo sombra desplegable (por el dueño); sin cambio visible.
3. M3 (F3 estable): motor nuevo decide; arranca P4 en producción, P5-P7.
4. M4 (P8-P10): sidebar por permisos, gestión y CLI.
5. M5 (fase P): repos públicos detrás de la política `forbidden` por defecto; nadie los ve hasta que un owner los permita.
