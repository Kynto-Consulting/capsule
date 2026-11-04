# Migración al motor de permisos atómicos

Objetivo: pasar de `authz.Resolve` + `project_members` + `org_members.role` + alcances de token al motor de `SPEC.md` SIN cambiar el
comportamiento de nadie, y con marcha atrás en cada fase. Las correcciones de comportamiento (sec. 7) están separadas a propósito: la migración
solo es aceptable si la prueba de equivalencia da cero diferencias.

Siguiente migración libre: **000065** (el directorio llega a 000064). Rangos exactos en `WORKBREAKDOWN.md`.

## 1. Principios

1. Aditiva primero: ninguna fase borra ni reescribe datos existentes hasta la fase 5; el código viejo sigue leyendo lo que siempre leyó.
2. Un solo cambio a la vez: esquema (F1), observación (F2), decisión (F3), superficies (F4), retirada (F5), correcciones (F6).
3. La verdad se prueba, no se afirma: equivalencia exhaustiva en CI y en sombra sobre producción antes de decidir con el motor nuevo.
4. Reversible con un interruptor mientras haya doble escritura (F1-F4).

## 2. Inventario de datos y destino

| Dato actual | Destino | Cómo | Se conserva |
|---|---|---|---|
| `org_members.role` (`owner`,`admin`,`member`,`readonly`) | `org_members.template_id` (plantilla de org del sistema con ese slug) + `template_version` | `UPDATE ... FROM role_templates WHERE kind='org' AND system AND slug = role` | `role` queda como etiqueta heredada, sincronizada por trigger |
| `org_members.role` desconocido | `template_id NULL` | el motor lo trata como "no resuelve" => oculto (igual que `Resolve`) | sí |
| `organizations.owner_id` | propietario principal | sin cambio de datos; invariante: ese usuario debe tener plantilla `owner` | sí |
| `project_members(project_id,user_id,role,created_by,created_at)` | una fila de `access_assignments` por fila (`subject_type='user'`, `scope_type='project'`, plantilla de proyecto del sistema = `role`, `source='migrated'`, `created_by` y `created_at` copiados) | `INSERT ... SELECT` | la tabla se mantiene y se sincroniza (triggers, sec. 3 F1) hasta F5 |
| `organizations.project_access_mode` | política (misma columna) | nada | sí; sigue siendo lo que lee el motor para `open`/`restricted` |
| `api_tokens.scopes` | `permissions IS NULL` => se traduce en ejecución con la tabla de SPEC 9.2 | nada | sí |
| `git_access_tokens` (`scope`, `project_ids`) | sin cambio | el motor traduce `read`/`write` en ejecución | sí |
| `gateway_service_tokens` | sin cambio | `gateway:connect` fijo | sí |
| `users.role` (`admin`/`member`/`suspended`/otros) | `users.platform_role` y `users.status` | `UPDATE users SET platform_role=(role='admin'), status=(role='suspended')` | `role` se mantiene y se sincroniza por trigger hasta F5; valor desconocido => `platform_role='user'`, `status='active'` y se registra en una tabla de anomalías para revisión (hoy esos usuarios no son admin ni suspendidos) |
| Lista de aprobadores de entornos (`environments`) | lectura a través de un adaptador: el motor expone `promotion:approve` en alcance `env` leyendo la tabla actual (usuarios o rol de proyecto) | adaptador de solo lectura en F2-F3; en F4 se materializa como asignaciones `source='approver'` | sí, hasta que el paquete de entornos migre su almacén |
| Equipos de Forgejo `<slug>-viewer/-deployer/-admin` | siguen; se añaden `-read/-write` | doble proyección | sí, hasta F5 |
| Claim `groups` | idéntico | ver SPEC 10.3 | sí |

Cantidades esperadas tras F1 (se verifican con una consulta y se registran en la nota de despliegue):
`count(access_assignments WHERE source='migrated') = count(project_members)`; `count(org_members WHERE template_id IS NOT NULL) + count(role no reconocido) = count(org_members)`; `count(users WHERE status='suspended') = count(users WHERE role='suspended')`.

## 3. Plan por fases

### F0 Preparación (sin esquema ni cambio de comportamiento)

- Catálogo (`authz/catalog`) y plantillas del sistema como DATOS (`systemtemplates.json`), con `expand(A)` para cada acción vieja.
- Extraer la tabla ruta -> acción vieja (`routes_authz.golden`) recorriendo el router y los handlers (script con `go/ast` en `backend/tools/routeperms`); es la base de la equivalencia y se commitea.
- Implementación de referencia del `Resolve` actual congelada dentro de las pruebas (`authz/legacy_test_oracle.go` con build tag de test) para que la prueba de equivalencia no dependa de código que luego se retire.
- Línea base de rendimiento del `Can` actual (benchmark) para comparar.
- Salida: `go test ./internal/authz/...` verde con la prueba exhaustiva sobre el motor en memoria (sec. 5.1).

### F1 Esquema aditivo, sembrado y backfill (migraciones 000065-000070)

- Crear tablas y columnas de SPEC 14. Sembrar plantillas del sistema con UUID deterministas. Backfill de la sec. 2.
- Triggers de sincronización (con `pg_trigger_depth() = 1` para evitar bucles): `project_members` <-> `access_assignments` (solo filas directas, de usuario, alcance proyecto, plantilla del sistema), `org_members.role` <-> `template_id`, `users.role` <-> `platform_role/status`. Mientras el código viejo escriba las tablas viejas, las nuevas se mantienen solas.
- Nada lee las tablas nuevas. Salida: `up` y `down` ejecutados en Postgres real (dos veces `up`, `down`, `up`), recuentos de la sec. 2 correctos, `go test ./internal/repository/...` verde.

### F2 Modo sombra

- El motor nuevo se cablea tras `authz.Service` con la interfaz `Store` actual ampliada. En cada `Access`, `Can`, `FilterProjects`, `Visibility`, `ProjectGroups` y en el estado deseado del reconciliador, se calcula también la respuesta nueva y se compara. Se APLICA la vieja.
- Métricas: `authz_shadow_total{kind}`, `authz_shadow_mismatch_total{kind}`, `authz_shadow_seconds` (histograma). Cada diferencia escribe un log estructurado con (usuario, org, proyecto, acción, vieja, nueva, `explain`) sin datos personales más allá de los ids.
- Coste máximo permitido: +1 ms p99 por petición (la comparación usa el snapshot ya en caché).
- Salida: 0 diferencias durante 7 días de tráfico real o 100 000 decisiones (lo que tarde más) y la prueba exhaustiva de CI verde.

### F3 Decisión con el motor nuevo, por organización

- Interruptor global `CAPSULE_AUTHZ_ENGINE=v1|shadow|v2` y por org `organizations.access_settings.engine`. Orden de despliegue: orgs internas -> 10 % -> 100 %; el motor viejo sigue en el binario como respaldo.
- La doble escritura sigue activa (los triggers de F1), por lo que volver a `v1` es cambiar el interruptor y expulsar la caché (segundos); no hay datos que reconstruir.
- Salida: 14 días en `v2` sin diferencias de la comparación continua (se mantiene la sombra inversa por muestreo 1 %), p99 dentro del presupuesto de SPEC 12.3, sin incidentes.

### F4 Superficies nuevas

- API de plantillas, grupos, asignaciones, `GET /me/permissions`, simulador, invitaciones, transferencia de propiedad (rutas de `API.openapi.yaml`); sidebar por permisos; CLI nuevo; tokens con `permissions`; proyección Forgejo `-read/-write` (doble proyección).
- Las plantillas personalizadas, los grupos y los permisos explícitos de token se activan por org con `access_settings.custom_roles=true` (por defecto false hasta que F3 esté estable). Mientras sea false, el motor solo contiene asignaciones expresables en el modelo antiguo y la reversa es exacta.
- Salida: pruebas de aceptación de cada paquete de `WORKBREAKDOWN.md`; la skill y la documentación actualizadas.

### F5 Retirada del legado (anuncio previo y dos versiones de aviso)

- `Deprecation`/`Sunset` solo aquí y solo en lo que se retira: `users.role` como fuente (pasa a derivada), lectura de `project_members` como fuente (queda como vista de compatibilidad sobre `access_assignments`), equipos `-viewer/-deployer/-admin`, ruta por path de `TokenAllows` (la tabla de equivalencia se conserva para los `scopes` heredados).
- Los roles viejos (`admin|deployer|viewer`, `admin|member|readonly`) y los alcances (`deploy`, `security:write`) NO se retiran de la API de entrada: siguen aceptados como alias de plantillas del sistema.
- Irreversible sin restaurar copia; por eso exige anuncio, versión de transición y confirmación del dueño.

### F6 Correcciones de comportamiento (sec. 7)

Una a una, cada una detrás de su bandera por organización, con aviso en la UI y en el CLI.

## 4. Compatibilidad de la API

Regla: ningún campo, ruta, código HTTP ni mensaje actual cambia en F0-F4. Todo lo nuevo es aditivo.

| Ruta/formato actual | Comportamiento durante la migración |
|---|---|
| `POST /orgs/{org}/members` `{email, role}` (`admin\|member\|readonly`; por defecto `member`) | igual; el usuario ya existente entra de inmediato; responde con los campos de hoy más `template`, `status`. `owner` sigue sin poder invitarse (422). |
| `PATCH /orgs/{org}/members/{u}` `{role}` | igual; acepta además `template` (slug, solo con `custom_roles`). El rol `owner` no cambia (403) salvo la nueva transferencia. |
| `DELETE /orgs/{org}/members/{u}` | igual; ahora también limpia asignaciones y grupos (SPEC 7.3). El owner no se puede quitar (hoy 403; con varios owners, `409 LAST_OWNER` solo para el último). |
| `GET/PUT/DELETE /orgs/{org}/projects/{p}/members[/{u}]` `{role: admin\|deployer\|viewer}` | igual; `GET` conserva `user_id,email,name,org_role,role,source` y añade `template`, `via_groups[]`. `PUT` con asignaciones personalizadas preexistentes del usuario en ese proyecto: `409 MIXED_ASSIGNMENTS` salvo `?replace=all` (D15); sin ellas, idéntico. `role` en la respuesta es `LegacyRole`. |
| `PATCH /orgs/{org}` `{project_access_mode}` | igual; añade `access_override` por proyecto en otra ruta. |
| `POST /user/tokens` `{scopes, project_id}` | igual; acepta además `permissions[]` y `org_id`. `scopes` y `permissions` a la vez => 422. |
| Autorización de rutas | mismos códigos: no miembro 403, oculto 404, sin permiso 403. `details` es aditivo. |
| `GET /orgs/{org}/audit-log`, CSV | igual; columnas nuevas al final. |
| `PATCH /admin/users/{id}/{suspend,unsuspend,role}` | igual (traduce a `status`/`platform_role`); un valor de `role` inválido sigue aceptándose hasta C4 (sec. 7). |
| OIDC `groups`, equipos Forgejo, tokens Git y de gateway | idénticos para datos sin plantillas ni grupos personalizados (prueba byte a byte). |
| CLI antiguo | `capsule members list/set/remove`, `capsule org access-mode`, `capsule tokens create --scope`: sin cambios. |

## 5. Pruebas de equivalencia

Todas corren en CI. Las de base de datos usan Postgres real local en WSL:
`wsl -d Ubuntu -u root -- pg_ctlcluster 18 main start` y el helper `backend/internal/repository/dbtest_helpers_db_test.go`.

### 5.1 Matriz exhaustiva de decisión (viejo vs nuevo)

Dimensiones: rol de org `{owner, admin, member, readonly, "" (no miembro), "bogus"}` (6) x modo `{open, restricted, ""}` (3; `""` se comporta como open en `Resolve`) x fila explícita `{"", viewer, deployer, admin, "bogus"}` (5) x acción vieja (9 `AllActions` + 13 `GitActions` + `project.connect` = 23) = **2 070 casos**.

Aserciones por caso: `Old.Can(A) == New.CanAll(expand(A))`; y, por combinación (90): `Old.Member == New.Member`, `Old.Hidden == New.Hidden`, `Old.Source == New.Source`, `Old.Role == LegacyRole(New.set)`; `EnvApprove` es falso en los 90 casos para cualquier plantilla del sistema.

Más: `TestSystemTemplatesMatchLegacyMatrix`: para cada rol viejo, `template(role).permissions == ⋃ expand(A) para A en matrix[role]` EXACTAMENTE (no solo incluye: detecta permisos regalados); para los cuatro roles de org, `permissions`, `floor`, `base`, `ceiling` reproducen la tabla de decisión de `TestResolveDecisionTable`.

### 5.2 Suite vieja bajo motor nuevo

`authz_test.go`, `git_actions_test.go`, `gateway_actions_test.go`, `handlers/*_authz_test.go`, `project_members_test.go`, `gittokens/*_test.go` y los de `gitsync` se ejecutan sin tocar con `CAPSULE_AUTHZ_ENGINE=v2` (tabla de pruebas con ambos). Cualquier fallo es un bloqueo.

### 5.3 Listado y visibilidad

Propiedad-based (`rapid` o `testing/quick`, semilla fija registrada): 1 000 organizaciones aleatorias (hasta 50 miembros, 30 proyectos, filas explícitas, modos mixtos) cargadas en Postgres real: `FilterProjects`, `Visibility`, `ProjectGroups` y `CountEffectiveAdmins` iguales en ambos motores.

### 5.4 Tokens

- Tabla de rutas: para cada ruta de `routes_authz.golden` x método x alcance de token `{*, "", deploy, security:write, deploy+security:write, desconocido}` x proyecto del token `{coincide, otro, ninguno}`: `TokenAllows(old) == (permisos exigidos por la ruta ⊆ traducción(scopes)) && alcance de recurso ok`.
- Tokens Git: `read/write` x `project_ids` x rol -> misma decisión que `gittokens.roleAllows` actual.
- `cgs_`: mismo resultado de `Authorize` del gateway.
- Regla de no-exceso: 10 000 casos aleatorios donde `decision_token ⊆ decision_usuario` (propiedad).

### 5.5 Proyecciones

- Estado deseado del reconciliador: para las 1 000 organizaciones anteriores, `desired(old) == desired(new)` como mapa `login -> rol/nivel` (viewer->read, deployer/admin->write).
- Claim `groups` byte a byte (incluido el orden `sort.Strings`) para datos sin elementos nuevos.

### 5.6 Explicación

`Explain(x).allowed == Can(x)` sobre 20 000 casos aleatorios (incluidas caducidades, suspensiones, techo, repos y entornos).

### 5.7 Datos reales (F1 y F2)

Antes de F3 se ejecuta, solo lectura, sobre una copia de producción: recorrer TODAS las filas `(org_members x proyectos de su org)` y comparar los dos motores para las 23 acciones. Cero diferencias o no se avanza. En producción, la sombra de F2.

### 5.8 Migración de esquema

`up`, `down`, `up` en base vacía y en base sembrada con datos de prueba (orgs de cada rol, `project_members` en los tres roles, usuarios admin/suspendidos/raros); `down` deja intactas las tablas viejas; idempotencia de `up`; los triggers no entran en bucle (prueba de profundidad); el sembrado produce los mismos UUID dos veces.

## 6. Reversa

| Fase | Cómo se vuelve | Qué se pierde |
|---|---|---|
| F1 | `*.down.sql` en orden inverso | solo las tablas nuevas (nada leía de ellas) |
| F2 | quitar la bandera de sombra | nada |
| F3 | `CAPSULE_AUTHZ_ENGINE=v1` (o por org) y expulsar la caché | nada: la doble escritura mantuvo `project_members` y `org_members.role` |
| F4 con `custom_roles=false` | desactivar superficies; nada personalizado existe | nada |
| F4 con plantillas o grupos personalizados ya en uso | `capsule-admin authz export-legacy --org X` materializa para cada persona la etiqueta heredada (`LegacyRole`, que nunca sube) en las tablas viejas; luego `v1` | los permisos finos de las plantillas personalizadas se degradan a la etiqueta; se informa y se audita. Nunca se escala. |
| F5 | restaurar copia previa | irreversible por diseño |

Regla: no se activa `custom_roles` en ninguna org hasta que su F3 esté estable, y se avisa en la UI de que la reversa de ese estado es degradante.

## 7. Correcciones de comportamiento (fuera de la migración, opt-in por organización)

Cada una cambia lo que alguien puede hacer hoy. Se activan con `access_settings.strict_*` por org, con aviso previo (UI + CLI + correo a owners), luego por defecto en orgs nuevas, y por último (decisión del dueño) en las existentes. Cada una tiene prueba antes/después y se audita (`access.mode.changed` con el nombre de la bandera).

| # | Hoy | Corrección | Bandera |
|---|---|---|---|
| C1 | cualquier miembro, incluido `readonly`, crea proyectos | `project:create` solo `member` o superior; `readonly` (plantilla `readonly` v2) no | `strict_project_create` |
| C2 | cualquier miembro crea bases y dominios de organización sin proyecto | `database:create`/`domain:manage` a nivel org solo `member` o superior (y no `readonly`) | `strict_org_resources` |
| C3 | `/aws/billing` sin comprobación de rol en el handler | exigir `billing:read` (owner/admin) o admin de plataforma, según lo que P1 confirme del endpoint | `strict_billing` |
| C4 | `SetUserRole` acepta cualquier cadena | validar contra `{admin, member, suspended}` (`422`) | global (corrección de validación) |
| C5 | tokens `*` sin caducidad | los nuevos exigen `--allow-all` y caducidad <= 90 d; los existentes avisan en `tokens list` | `strict_wide_tokens` |
| C6 | auditoría de `project_members` en un paso aparte | misma transacción que el cambio | global (invisible) |

## 8. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Un handler elige un átomo distinto del que le corresponde y se concede de más o de menos a una plantilla personalizada | los roles del sistema no se ven afectados (SPEC 3.2 nota 1); la tabla ruta -> átomo se revisa por pares y se valida contra `API.openapi.yaml` y el router |
| Ruta nueva sin permiso registrada por un tercero | test de CI "toda ruta tiene fila" y `TokenGate` cierra por defecto |
| Divergencia entre triggers y código | la sombra de F2 compara de verdad; contadores en alerta |
| Caché que no se invalida | ruta estricta para sensibles, TTL 30 s, pruebas de dos procesos |
| Orgs con datos raros (rol desconocido) | tratados igual que hoy (ocultas); se listan en el informe de F1 |
| Aprobadores de entornos | adaptador de solo lectura en F2-F3; materializar en F4 con prueba de paridad |
