# P0: notas de implementación y discrepancias SPEC-código

Fecha: 2026-11-04. Paquete P0 (catálogo, plantillas del sistema como datos, oráculo congelado, extractor de rutas). Nada de lo entregado cambia el comportamiento de una ruta ni de `authz.Service`: solo se añadieron archivos (más dos líneas de `Makefile` y un archivo de 3 líneas con `go:embed` en `authz`).

## 1. Qué se entregó y dónde

| Pieza | Ruta |
|---|---|
| Catálogo (99), `All/Has/Get/Bit/Expand/ExpandSet/Match`, `Set` de 128 bits, `Version` | `backend/internal/authz/catalog/` (`catalog.go`, `set.go`, `json.go`) |
| `catalog.json` generado (`make catalog-gen`; el test falla si está viejo) | `backend/internal/authz/catalog/catalog.json` |
| Plantillas del sistema como datos (9) | `backend/internal/authz/systemtemplates.json` |
| Carga y esquema documentado (godoc) | `backend/internal/authz/systemtemplates/` (`Org/Project/Repo/ByID/All/Parse/ID`) y `backend/internal/authz/systemtemplates_embed.go` (`authz.SystemTemplatesJSON`) |
| Oráculo congelado + línea base de rendimiento | `backend/internal/authz/legacy_oracle_test.go` |
| Matriz exhaustiva y pruebas de plantillas | `backend/internal/authz/systemtemplates_test.go` |
| Lector de las tablas de SPEC.md (apoyo de pruebas) | `backend/internal/authz/internal/specdoc/` |
| Extractor ruta -> acción vieja | `backend/tools/routeperms/` (`main.go`, `classes.go`, pruebas) |
| Archivo dorado | `backend/internal/authz/routes_authz.golden` (316 filas) |
| Prueba sobre el router vivo | `backend/internal/server/routes_authz_golden_test.go` |
| Objetivos `catalog-gen`, `catalog-check`, `routes-gen`, `routes-check` | `Makefile` (raíz) |

Decisiones de forma (no contradicen SPEC):

- `catalog.Expand` es genérica (`Expand[A ~string](old A)`) para aceptar `authz.Action` sin que `catalog` importe `authz`. Así `authz` (P3) puede importar `catalog` sin ciclo.
- El bit de cada permiso es su posición en la tabla de `catalog.go`, que es SOLO-AÑADIR (los masks hexadecimales de `/me/permissions` dependen de ello). Orden: 26 de organización, 66 de proyecto/repo/entorno, 7 de plataforma.
- `systemtemplates.json` lleva permisos EXPLÍCITOS (sin comodines): SPEC 4.2 dice que una plantilla del sistema solo gana permisos en una versión nueva, y un comodín los daría por sorpresa. Los UUID son `uuid v5(namespace, "kind/slug")` con `namespace = uuid v5(URL, "urn:capsule:permissions:system-templates")`; el JSON los trae escritos y `Parse` verifica que coincidan. En SQL: `uuid_generate_v5(ns, 'org/owner')`.
- Dirección de importación: `systemtemplates` importa `authz` (solo para los bytes embebidos) y `catalog`; `authz` y `catalog` no deben importarlo. `go:embed` no puede subir de directorio, por eso el archivo de embebido vive en `authz`.
- Las pruebas que leen SPEC.md se saltan solas (`t.Skip`) si `docs/permissions/SPEC.md` no es alcanzable (el `backend` es un submódulo: en un checkout solo del backend no se ejecutan). La garantía completa existe en el checkout de `capsule`.
- El `Resolve` del oráculo se compara con el código vivo (`TestLegacyOracleMatchesLiveCode`); esa prueba puede borrarse cuando se retire `authz.Resolve` (F5).
- El archivo se llama `legacy_oracle_test.go` (WORKBREAKDOWN), no `legacy_test_oracle.go` con build tag (MIGRATION F0): un `_test.go` ya es solo de pruebas.

## 2. Discrepancias SPEC vs código real y decisión tomada

### D1. El techo de `readonly` filtra permisos al alcance de proyecto (decisión de datos; P1 debe usarla)

SPEC 4.1 define `ceiling` de `readonly` como "org(readonly) + conjunto del viewer". `database:create` y `domain:manage` están en las cuatro plantillas de organización (G7) y TAMBIÉN en el `admin` de proyecto. Aplicado tal cual a alcance proyecto, un `readonly` con una fila `admin` en un proyecto tendría `database:create` y `domain:manage` allí, mientras que `Resolve` hoy da `viewer` (nada). Se rompe la garantía de SPEC 3.2 nota 1 (cualquier átomo de `expand(A)` es equivalente).

Decisión: `systemtemplates.json` lleva dos campos para las plantillas de organización con techo: `ceiling` (SPEC, se aplica a alcance org) y `ceiling_project` (= conjunto del viewer, se aplica a alcance proyecto, repo y entorno). `TestReadonlyCeilingNeedsProjectScopeVariant` fija ambos hechos y `TestSystemTemplatesMatchLegacyMatrix` exige además que el conjunto efectivo de las 90 combinaciones sea EXACTAMENTE la unión de las expansiones del rol viejo (no solo que `Can` coincida). Consecuencia para P1/P2: `engine` usa `ceiling_project` fuera de alcance org; el esquema de `role_template_versions` (SPEC 14) no tiene columna para `ceiling_project`: P2 debe añadirla (`text[] null`) o derivarla (es el conjunto de la plantilla de proyecto `viewer`).

### D2. SPEC 3.1 omite los permisos de LECTURA de nivel organización (`database:read`, `domain:read`) y las plantillas de organización los necesitan

El párrafo "Además" lista solo `database:create` y `domain:manage`; la nota 2 de 3.2 habla de `*:read`. Las rutas `GET /orgs/{org}/databases` y `/domains` hoy exigen solo pertenecer. Decisión: las cuatro plantillas de organización llevan `database:read`, `database:create`, `domain:read`, `domain:manage` (owner 31 permisos, admin 28, member 9, readonly 9).

### D3. ABIERTO, requiere decisión del dueño: los recursos de organización sin proyecto son más abiertos que lo que SPEC describe

SPEC G7 solo menciona crear bases y dominios de nivel organización. El código también deja a CUALQUIER miembro (readonly incluido) BORRAR una base sin proyecto (`DELETE /orgs/{o}/databases/{dbID}`) y EJECUTAR SQL en ella (`POST /orgs/{o}/databases/{dbID}/query`), y verificar o borrar dominios sin proyecto (`authorizeOptionalProject` + `authorizeResourceProject` con proyecto nulo: solo pertenencia). Con las plantillas de SPEC, `database:delete` y `database:query` no existen a nivel org: al migrar esas dos rutas, un miembro perdería lo que hoy puede hacer (cambio de comportamiento), o hay que concederlos a nivel org como `legacy_gap`. No se decidió: no se tocó el catálogo (99 = SPEC). Opciones: (a) añadir alcance `org` a `database:delete` y `database:query` y concederlos en las cuatro plantillas con `legacy_gap` (equivalencia exacta; el catálogo deja de coincidir con la tabla de SPEC en dos filas); (b) tratarlo como defecto y corregirlo como C2 (`strict_org_resources`) con aviso. P3 no puede cerrar la equivalencia de esas dos rutas hasta que se elija. Las filas dorado de esas rutas llevan `project.databases` / `project.ops` sin distinguir el caso "sin proyecto".

### D4. `404` oculto frente a `403`: cinco rutas del enlace Git responden `403` a un usuario que no ve el proyecto

SPEC 5.3 regla 5 y 13.4 prometen `404` para proyectos no visibles. `GitHandler.scope` (`GET/PUT/DELETE .../git`, `POST .../git/test`, `GET .../previews`) responde `403 "not allowed"` si el autorizador niega, sin distinguir oculto. Es el comportamiento actual (se conserva en equivalencia) y filtra la existencia del proyecto; queda para la corrección de P3b/C-series. Además, sin `SetAuthorizer` el valor por defecto es `OrgRoleAuthorizer` (rol de organización owner/admin/member, sin proyecto); `cmd/server` siempre lo reemplaza por el autorizador por roles de proyecto, y así se registraron las acciones (`project.read` para Get/Previews, `project.ops` para Put/Delete/Test).

### D5. `org:update`, `org:delete` y `org:access-policy` del código no usan el rol "owner"

`org.go` decide por `org.OwnerID == user.ID` (propietario principal), no por `org_members.role = 'owner'`; el administrador (rol exactamente `admin`) solo puede tocar `project_access_mode`. Equivalente para los roles del sistema mientras `owner_id` y la plantilla `owner` coincidan (SPEC 7.5 ya pide mantenerlo sincronizado). Las filas del dorado lo clasifican `org-owner` y `org-admin+owner-fields`.

### D6. `audit:read` y `audit:export` son la misma ruta

`GET /orgs/{o}/audit-log` sirve JSON y CSV (`?format=csv` o `Accept: text/csv`). P3b-2 debe decidir por parámetro cuál de los dos permisos exige cada variante; hoy ambas piden owner/admin.

### D7. Dependencias (`requires`, SPEC 3.4): reglas aplicadas y vacíos

Aplicadas literalmente. Dos precisiones: (1) `project:view` no se exige a permisos válidos también a nivel org (`database:*`, `domain:*`, `assignment:*`), porque las plantillas de organización no llevan `project:view` y no podrían guardarse; (2) el `:read` de un recurso solo se exige si comparte alcance con el permiso (`project:create` es solo org y `project:read` solo proyecto: no hay dependencia). Verbos que SPEC 3.4 no cubre y que no se añadieron para no inventar: `audit:export`, `orgvar:reveal`, `token:revoke-any`, `project:update`, `project:restore`, `deployment:cancel`, `deployment:rollback`, `storage:presign`, `gateway:manage`, `gateway:token`, `network:manage` (este último sí depende de `project:view`). Candidatos a añadir en una versión de catálogo si el dueño lo quiere.

### D8. Recuento "26 de organización"

La tabla 3.1 tiene 28 filas; `assignment:read` y `assignment:grant` están también en 3.2 (una sola entrada, alcance org y proyecto). 28 - 2 = 26 solo de organización, 66 de proyecto/repo/entorno (con esas dos) y 7 de plataforma = 99. El test lo verifica contra SPEC.md.

### D9. `platform` se decide en cinco sitios sueltos con `users.role == "admin"`

`handlers/admin.go` (`requireAdmin`), `handlers/backups.go` (`platformAdmin`), `handlers/recover.go` (`platformAdmin`), `gitsync/http.go` (`reconcile`) y `handlers/oidc.go` (`isPlatformAdmin`, también para clientes OIDC de primera parte). Las rutas `/git/admin/reconcile`, `/git/admin/recover*`, `/platform/backups*` y `/admin/users*` quedan como clase `platform-admin`. `gitsync/http.go` es de P7 y no figura en la lista de archivos de P3b: asignarlo.

### D10. `oauthclient:manage` (SPEC: "verificar el chequeo actual en P1")

Verificado: crear, listar, borrar y editar clientes OIDC exige ser admin de plataforma, u owner/admin de la organización del cliente; los clientes `first_party` solo los crea un admin de plataforma. El dorado los clasifica `org-admin-or-platform-admin`.

### D11. Rutas con más de una acción vieja

La columna `OLD_ACTIONS` lista TODAS las acciones que referencia el handler (y las funciones del módulo que llama, a profundidad 3, sin `go func` ni el paquete `authz`). Cuando hay varias, el handler escoge según la petición, no son alternativas equivalentes: `GET .../env` (`project.read`; `project.env_reveal` con `?reveal`), alertas de seguridad (leer / triage / admin según severidad), `tags` (escribir / admin), rutas de base de datos y red (`project.network` + `project.read`), etc. P3b debe leer el handler para asignar el átomo de cada caso; el dorado delimita el conjunto posible.

### D12. Endpoints internos y alta de tokens

`/internal/git-auth` (`git.read`/`git.write`) y `/internal/gateway/authorize` (`project.connect`) llevan acción pero van detrás de un secreto compartido (columna AUTH = `secret`). `POST /user/tokens` lleva `project.deploy` y `security.triage`: son las acciones que se exigen para acuñar un token acotado a un proyecto (las rutas de gestión de tokens propios son clase `self`). `POST /user/git-tokens` y `/user/git-credentials` lo mismo con `git.read`/`git.write`.

### D13. Otras observaciones

- `Resolve` trata cualquier modo distinto de `restricted` como `open` (incluida la cadena vacía); SPEC solo conoce `open|restricted` con CHECK. La matriz exhaustiva incluye `""` como pide MIGRATION 5.1.
- `GET /orgs/{o}/projects/{p}/git/activity|insights` se registran dos veces (B1 y C2); chi se queda con la última (C2) y el dorado refleja la efectiva.
- `/aws/billing` no tiene comprobación de rol (G8, confirmado): clase `no-check`.
- `gofmt -l` marca `backend/internal/authz/authz.go` por formato previo a este trabajo; no se tocó (P0 no modifica el código de `authz`). Todos los archivos nuevos pasan `gofmt`.
- `Service.Can` actual cuesta ~326 ns/op y 0 asignaciones (`BenchmarkLegacyServiceCan`, Ryzen 5 5600H): el objetivo de 200 ns/op de P1 es MÁS ESTRICTO que la línea base; conviene confirmar que se quiere comparar `Can` del motor con ese número y no con la pura `Resolve` (76 ns/op).

## 3. Cómo se prueba (reproducible)

```
cd backend
go test -race -count=1 ./internal/authz/...                  # catálogo, plantillas, matriz de 2 070 casos, oráculo
go test -count=1 ./internal/authz/catalog -run TestCatalogMatchesSpec -v
go test -count=1 ./internal/authz -run 'TestSystemTemplatesMatchLegacyMatrix|TestEveryOldActionExpands' -v
go run ./tools/routeperms -check                              # el dorado coincide con el router
go test -count=1 ./internal/server -run TestEveryMountedRouteHasAGoldenRow -v
go test -bench Legacy -benchtime 2000000x ./internal/authz -run xxx
```

Para regenerar: `make catalog-gen` (catalog.json) y `make routes-gen` (dorado). Si se añade una ruta sin fila en `classes.go` ni acción de `authz`, el extractor falla.

## 4. Lo que el extractor NO puede ver (y cómo se cubrió)

- Decisiones por una interfaz (`ProjectAuthorizer` del enlace Git): se registran a mano en `classes.go` con sus acciones (D4).
- Rutas montadas solo si hay una dependencia opcional (`deps.Git`, `deps.GitCore`, `deps.Backups`, OIDC, tokens Git, C2): el extractor recorre el código fuente, así que las incluye; la prueba del router vivo (`Deps{}` vacío) solo monta 258 pares método-ruta y comprueba que TODOS tengan fila; las 316 filas incluyen además las condicionales.
- Acciones elegidas por código en tiempo de ejecución (tablas o mapas de acciones): no hay ninguna hoy; si aparece una, la ruta saldrá sin acción y el extractor fallará hasta clasificarla.
