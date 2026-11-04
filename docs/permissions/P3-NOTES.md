# P3: cableado en sombra, decisión y tabla de rutas (notas y discrepancias)

Fecha: 2026-11-04. Con `CAPSULE_AUTHZ_MODE` ausente (= `v1`) el comportamiento visible es el de siempre. `shadow` calcula el motor nuevo fuera de la
petición y nunca cambia la respuesta. `v2` solo se activa por configuración y no se despliega en esta fase.

## 1. Qué se entregó y dónde

| Pieza | Ruta |
|---|---|
| Adaptador `AccessSource` -> `engine.Store` (solo mapeo de tipos) | `backend/internal/repository/access_engine.go` (`EngineStore`, `AccessStore.EngineStore()`, `AccessStore.EnvProjects`) |
| Modos `v1 / shadow / v2`, `Service.Check`, sombra (muestreo, timeout, tope de concurrencia, recover), `authz.WithRoute` | `backend/internal/authz/shadow.go` y `authz.go` (la API de `Service` se mantiene; `Access`, `FilterProjects`, `Visibility` delegan) |
| Adaptador `authz.V2` sobre el motor, caché de modo por organización, arranque (`Start`: `SeedSystemTemplates`, `Listen` -> `Invalidate`), `Attach`, `Gate` | `backend/internal/authz/wire/wire.go` |
| `DecideToken` = `Effective(usuario) ∩ permisos del token` (ruta estricta) | `backend/internal/authz/wire/tokens.go` |
| Motor sobre un `authz.Store` viejo (para correr la suite vieja con `v2`) y su registro solo en binarios de prueba | `authz/wire/legacy.go`, `authz/wire/legacyv2/` y un `authz_mode_test.go` (import en blanco) en cada paquete con pruebas viejas |
| Métricas `authz_shadow_total`, `_mismatch_total`, `_seconds` (+ `authz_shadow_skipped_total`) | `backend/internal/metrics/authz.go` |
| Tabla única ruta -> átomos (358 filas) | `backend/internal/server/routeperms.go` (`routePermissions`, `RouteTable()`) |
| `TokenGate`, `TokenInfo`, `middleware.TokenPerms(ctx)`, `PatternMatcher` | `backend/internal/server/middleware/tokengate.go`; `auth.go` solo llama a la compuerta (`SetTokenGate`) y guarda `TokenInfo` en el contexto |
| `authorize(..., act)` acepta átomos, `authorizePerm`, `TOKEN_SCOPE` | `backend/internal/server/handlers/authz_support.go` |
| `api_tokens.permissions` / `org_id` leídos | `domain.APIToken` (`Permissions`, `OrgID`) y `repository/apitoken_repo.go` (`tokenCols`); sin migración nueva |
| Cableado | `cmd/server/main.go`, bloque `// authz-engine:wiring begin/end` (solo ahí). `server/router.go` NO se tocó: la compuerta se instala por `middleware.SetTokenGate` |
| Pruebas | `server/routeperms_test.go`, `server/tokens_db_test.go`, `authz/wire/legacy_test.go`, `authz/wire/wire_db_test.go` (etiqueta `dbtest`) |

## 2. Decisiones y discrepancias

1. **Variable `CAPSULE_AUTHZ_MODE`** (el encargo) y no `CAPSULE_AUTHZ_ENGINE` (MIGRATION F3 / WORKBREAKDOWN). Se lee en `wire.GlobalModeFromEnv`, no en `internal/config` (evita tocar ese paquete; MIGRATION y WORKBREAKDOWN deben renombrarse). Por organización: `organizations.access_settings.engine` (`v1|shadow|v2`) pisa el global; caché de 10 s expulsada por el `NOTIFY`. Ajustes de sombra: `CAPSULE_AUTHZ_SHADOW_SAMPLE` (0..1, def. 1), `CAPSULE_AUTHZ_SHADOW_TIMEOUT_MS` (500), `CAPSULE_AUTHZ_SHADOW_MAX_INFLIGHT` (64; el exceso se descarta y se cuenta `skipped{reason=busy}`, nunca se encola).
2. **`authz` no puede importar el motor** (`engine` -> `systemtemplates` -> `authz`): `authz` define la interfaz `V2` y el paquete `authz/wire` la implementa. Por la misma razón los tests en el paquete `authz` (`authz_test.go`, `git_actions_test.go`, `gateway_actions_test.go`, `legacy_oracle_test.go`) NO pueden correr con `v2` (ciclo de importación en prueba); esa cobertura se sustituye por `TestServiceV1VersusV2Exhaustive` (en `authz/wire`): 90 combinaciones x las 23 acciones viejas x los 99 átomos, `Access`, `Can`, `Check`, `FilterProjects` y `Visibility`, viejo contra nuevo, 0 diferencias. El resto de la suite vieja (handlers, gittokens, gitsync, gateway, environments, gitreview, forgejo, server) corre sin tocar con `v2` gracias a `authz.New` + `legacyv2` (solo binarios de prueba).
3. **Signatura de `authorize`.** Se mantiene `authorize(w, r, orgs, orgID, projectID, act authz.Action)`: `authz.Action` es un `string` y una constante sin tipo (`"deployment:create"`) se convierte sola, así P3b cambia el argumento sin tocar la firma (hay además `authorizePerm(..., perm string)`). `Service.Check` evalúa UNA vez (miembro, oculto, permitido); un átomo en `v1` se decide con "alguna acción vieja que el rol tiene lo contiene" (exacto para los roles del sistema).
4. **El techo del token se aplica en dos sitios.** `TokenGate` (antes del handler, por ruta, tabla `routePermissions`) y `authorize` con átomos (`TOKEN_SCOPE` si el átomo, la organización o el proyecto no son los del token). Para acciones VIEJAS `authorize` no mira el token: la traducción de `deploy`/`security:write` es por ruta (SPEC 9.2) y la hace la compuerta. Un token con `*`/vacío no limita nada (`TokenPerms` devuelve `ok=false`).
5. **La compuerta en `v1` y `shadow` decide con `TokenAllows`** (nada cambia); `shadow` calcula además la decisión por tabla y registra diferencias (`kind=token`). Los tokens con `permissions` explícito (P6 aún no los crea) usan siempre la tabla. En `v2` decide la tabla: cerrada por defecto (ruta sin fila, fila `member`/`session`/`public`, sin átomos => 403 a un token acotado).
6. **Tabla ruta -> átomo.** Generada desde `routes_authz.golden` (316 filas) y mantenida a mano. Más 42 filas "Planned" de `API.openapi.yaml` (P4-P6, átomos del catálogo 99); las operaciones de la fase P (`public-repos`, `git/visibility`, `git/contributions`, `/public/*`, `git-public-auth`) NO están (átomos fuera del catálogo 99). Elecciones donde el handler decide en ejecución (la fila lleva el MÍNIMO y el handler puede pedir más): `GET .../env` `envvar:read` (`?reveal` pide `envvar:reveal`); alertas de seguridad `security:read` (triage/admin según severidad); `promotions/{id}/approve|reject` `promotion:approve` (la lista de aprobadores decide) y `.../cancel` `environment:manage`; logs de un despliegue `deployment:read` (SPEC 9.2 los incluye en el alcance `deploy`; `logs/*` es `log:read`); `GET security/sarif/{id}` `security:upload` (estado de la propia subida; es lo que permite `securityWriteRouteAllowed`); `DELETE/POST git/tags` `git:protect`+`git:write` (la acción vieja exigía `git.admin` y `git.write`); `POST git/pulls/{n}/reviewers` `git:review`+`git:write`; `DELETE members/{u}` `member:remove` (el caso "uno mismo" es `member:leave`, lo decide el handler); `PATCH /orgs/{o}` `org:update` (`project_access_mode` es `org:access-policy`); audit-log `audit:read` (CSV `audit:export`, D6 de P0). Las filas `member`/`session` no llevan átomos (membresía o sesión).
7. **D3 de P0 se conserva por equivalencia.** Las rutas de bases/dominios SIN proyecto siguen siendo "miembro" en el handler (`authorizeOptionalProject`/`authorizeResourceProject` no se tocaron) y la tabla les asigna `database:delete/query`, `domain:manage` solo para tokens acotados (que no los tienen). Ningún miembro pierde nada.
8. **Usuarios suspendidos.** El motor (SPEC 5.3) deja sin acceso al usuario con `users.status != active`; el código viejo (`authz.Resolve`) no mira la cuenta (la suspensión actual se aplica en el login/token). Con `v2` un suspendido pierde acceso a nivel de autorización (más estricto, coherente con SPEC); con `shadow` NO se generan diferencias de este tipo en las pruebas porque el generador no crea suspendidos. En tráfico real de sombra aparecería como diferencia legítima `suspended`; conviene decidir si se acepta (recomendado) o se filtra en el comparador.
9. **`Visibility` en sombra** compara el predicado nuevo con el viejo solo para los 8 primeros proyectos por los que se le pregunta (el predicado no es enumerable); `FilterProjects` compara la lista completa.
10. **Aprobadores de entorno** (`promotion:approve` por alcance `env`) no se materializan en el adaptador (MIGRATION sec. 2: F4); hoy ningún rol del sistema lo tiene y el aprobador lo decide el almacén de entornos como siempre.
11. **`ProjectGroups`** (claim `groups`, `UserGrants`) no delega al motor: es de P7. Sigue la ruta vieja en todos los modos.
12. `EnvProjects` (consulta nueva en `AccessStore`) existe porque una asignación de alcance `env` no trae el proyecto padre.

## 3. Cómo se prueba

```
cd backend
go test -count=1 ./internal/server -run 'RoutePermissions|RouteTable|TokenGate|MountedRoute'        # (b) toda ruta tiene fila; tabla = golden = x-permission; gate v2 == TokenAllows
go test -race -count=1 ./internal/authz/... ./internal/server/middleware/                           # exhaustiva v1 vs v2, sombra (panic, timeout, tope, muestreo)
CAPSULE_AUTHZ_MODE=v1 go test -count=1 ./internal/server/... ./internal/gittokens/... ./internal/gitsync/... ./internal/gateway/... ./internal/environments ./internal/gitreview ./internal/forgejo
CAPSULE_AUTHZ_MODE=v2 go test -count=1 <lo mismo>
# dbtest (WSL; base local, nunca producción)
wsl -d Ubuntu -u root -- pg_ctlcluster 18 main start
GOOS=linux go test -c -tags dbtest -o /d/tmp_wire.test ./internal/authz/wire && GOOS=linux go test -c -tags dbtest -o /d/tmp_server.test ./internal/server
# dentro de WSL, como postgres, con TEST_DATABASE_URL="postgres:///p3test?host=/var/run/postgresql"
```

## 4. Resultados medidos (2026-11-04, WSL Ubuntu, Postgres 18 local, socket Unix; maquina compartida y con carga)

- (b) `go test ./internal/server -run 'RoutePermissions|RouteTable|TokenGate|MountedRoute'`: PASS. 258 pares ruta-metodo montados, todos con fila (358 filas); los 316 del dorado cubiertos; 43 operaciones de `API.openapi.yaml` iguales, 23 quedan para la fase P/fuera del catalogo 99; la compuerta en `v2` == `TokenAllows` en 8 592 casos (ruta x alcance x proyecto).
- Exhaustiva `TestServiceV1VersusV2Exhaustive` (90 combinaciones x 23 acciones viejas + 99 atomos): 0 diferencias. `-race` de `authz`, `authz/wire`, `middleware`: verde.
- (c) sombra: 100 000 decisiones aleatorias (30 orgs x 24 miembros x 6 proyectos, 16 goroutines, semilla 20261104, ruta vieja sobre `project_members` real contra el motor sobre `access_*` reales): comparadas 100 000, diferencias 0, omitidas 0 (15,8 s).
- (d) decision con cache (1 000 llamadas): p50 7,8 us, p99 40-145 us (objetivo < 5 ms: cumple). Carga fria del snapshot con la base real: usuario normal p50 4,7 ms / p99 17-30 ms; usuario con 500 asignaciones p50 8-12 ms / p99 17-37 ms (un valor aislado de 76 ms con otro proceso de pruebas en paralelo). NO CUMPLE el objetivo de la ruta estricta (+1,5 ms p99): p50 0,49-0,55 ms (cumple) pero p99 3,3-9 ms y maximo 14-17 ms en todas las corridas, tambien tras vaciar el backlog de NOTIFY; la causa no se aisló (una consulta por clave primaria no tarda eso; sospecha: granularidad de planificacion de WSL). `TestDecisionTimingsAgainstPostgres` falla por esa aserción; se deja asi para no ocultarlo.
- (e) revocacion: otra conexion borra la fila y el motor la ve por `LISTEN/NOTIFY` real: p50 11-20 ms, p99 21-90 ms, maximo 167 ms en 7 corridas de 20 (< 1 s). La ruta estricta niega en la misma peticion sin NOTIFY.
- (f) `TestTokenNeverExceedsUser`: 20 736 casos de tokens heredados (`deploy`, `security:write`, ambos, `*`) x 9 formas de usuario x 3 proyectos x rutas con proyecto + 10 000 tokens explicitos aleatorios: 0 casos donde el token supere al usuario o al propio token, y expectativas dirigidas (viewer+deploy no crea despliegues, admin+deploy no escribe env ni borra el proyecto, security:write solo sube SARIF, proyecto de otro token = denegado).
- (a) suite vieja: con `CAPSULE_AUTHZ_MODE=v1` y `v2` pasan authz (v1), server, middleware, gittokens, gitsync, gateway/*, environments, gitreview, forgejo y handlers (171 pruebas), con UNA excepcion identica en ambos modos y ajena a esta entrega: `TestSecuritySuppressionEndpoints` (fixture con `expires_at` 2026-11-04T12:00Z: falla desde que el reloj paso del mediodia de hoy). En `v2` `TestConcurrentReadsAndInvalidations` del motor (P1) fallo una vez bajo carga de CPU ("too few decisions: 66") y paso en las demas corridas. Los tests en el paquete `authz` no pueden correr con `v2` (ciclo de importacion): cubiertos por la exhaustiva de arriba.
- `go vet ./...` limpio; `gofmt -l` limpio en los archivos de P3.

No ejecutado: `go test -count=1 ./...` completo en una sola pasada (las suites se corrieron por paquete); regeneracion de `TestRevocation` entre dos procesos del SO (se usaron dos conexiones/pools); despliegue.
