# P4: API de plantillas, grupos, asignaciones, /me/permissions, simulador y auditoria (notas y discrepancias)

Servicio: `backend/internal/access/` (sin HTTP). Handlers: `backend/internal/server/handlers/access_*.go`. Montaje: `handlers.WireAccess` (main.go, bloque authz-engine) y `handlers.MountAccess(r)` (una linea en router.go). Migracion nueva: `000072_access_idempotency` (tabla `access_idempotency`).

## Rutas (29, todas con fila en `routePermissions`, ya sin `Planned`)
catalogo, `/me/permissions`, `/me/permissions/explain`, plantillas (7), grupos (8), asignaciones (5), `projects/{p}/access`, `access-override`, `users/{u}/permissions`, `access/simulate`, `members/{u}/template`, `access-audit`.
NO incluidas: invitaciones, propiedad, tokens, `members/{u}/status` (P5/P6), `group-sources` (P12), fase P.

## Decisiones y discrepancias
1. Las rutas nuevas deciden SIEMPRE con el motor, sea cual sea `CAPSULE_AUTHZ_MODE` (no existe equivalente viejo). Las rutas existentes no cambian.
2. SPEC dice `POST .../permissions/explain`; el OpenAPI define `POST /orgs/{o}/access/simulate` y `GET /me/permissions/explain`; se implementa el OpenAPI.
3. `GET /me/permissions?expand=projects` es DISPERSO: `projects` solo lista proyectos cuya mascara difiere de `project_default` o con asignaciones propias (`projects_sparse:true`); ausente = `project_default`. Con uuid como clave, 5 000 proyectos densos no caben en 300 KB. Medido: 4,6 KB (owner) y 34 KB (300 asignaciones propias). Hay que reflejarlo en P8.
4. `me/permissions` en la tabla es `KindSession` (un token acotado no pasa) aunque el OpenAPI dice `tokens: allowed`; se deja la fila de P3.
5. No-escalada: plantillas org se comparan con el conjunto org del actor; plantillas project/repo (y floor/base) con la interseccion de lo que el actor tiene en TODOS los proyectos (proyectos ocultos cuentan vacios). Clonar solo "anade" lo que difiere de la fuente. Owner activo exento. Asignaciones: contencion en el alcance (org-wide = en todos los proyectos), auto-concesion (incluido via grupo propio) = 403 `ESCALATION` salvo owner. Anadir miembros a un grupo con asignaciones exige contencion en cada alcance.
6. Una asignacion de alcance org no llega a proyectos para `assignment:grant` de plantilla org: hace falta `assignment:grant` en el proyecto (SPEC 5.3). Un admin de proyecto sin `template:manage` recibe 403 en plantillas.
7. `access.template.deleted` es un evento nuevo (la SPEC solo lista archived). `access.denied` NO se implementa (no estaba en el alcance).
8. Impacto: personas/grupos/proyectos que siguen la ultima version (asignaciones sin fijar, no caducadas, miembros activos, plantilla de org con version NULL), ganancias/perdidas incluyen floor/base; muestra de 20 personas. `PUT` simultaneos: `409 STALE_VERSION`. Invariante `LAST_GRANTER` al quitar `assignment:grant` de una plantilla org.
9. WOULD_HIDE y `what_if` usan el mismo evaluador sobre un overlay del store (motor desechable); limite 5 000 miembros en la vista previa (422 si se excede).
10. `PUT members/{u}/template`: plantillas personalizadas exigen `access_settings.custom_roles=true`; etiqueta heredada de una personalizada: `member` si contiene la plantilla member, si no `readonly` (nunca admin/owner). `LAST_OWNER` en transaccion con bloqueo de la organizacion.
11. Idempotencia: la fila de clave se guarda en la misma transaccion que el cambio; misma clave + otro cuerpo = 409 `IDEMPOTENCY_CONFLICT`; ventana 24 h; `dry_run` no usa clave.
12. Limites de tamano: cuerpo 1 MiB (413), 200 plantillas, 200 permisos, 500 grupos, 5 000 miembros, 100 000 asignaciones, 100 usuarios por llamada (422 `LIMIT_EXCEEDED`).
13. Validacion de contrato con `kin-openapi`: NO hecha (dependencia ausente); se sustituyo por pruebas de forma y por la comprobacion de `x-permission` vs `routePermissions` vs permiso exigido por cada handler.

## Cómo se prueba
```
cd backend
go test -count=1 ./internal/access ./internal/server -run 'MountedAccess|RoutePermissions'
go test -race -count=1 ./internal/access          # pruebas sin BD
# BD (WSL, base local): compilar con GOOS=linux go test -c -tags dbtest ./internal/access ./internal/server/handlers y ejecutar dentro de WSL
```
