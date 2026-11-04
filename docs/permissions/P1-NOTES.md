# P1: notas de implementación y discrepancias SPEC-código

Fecha: 2026-11-04. Paquete P1 (evaluador, snapshot, caché) en `backend/internal/authz/engine/`. Solo se añadieron archivos; ninguna ruta ni `authz.Service` cambió.

## 1. Entregado

`engine.go` (Engine, Effective, Can, CanAll, CanStrict, FilterProjects, Visibility, Invalidate), `snapshot.go` (Scope, Access, compilación y resolución), `cache.go` (presupuesto de bytes, LRU, TTL 30 s), `explain.go` (Decision con causa), `legacyrole.go` (`LegacyRole(Set)`), `store.go` (interfaz `Store` y tipos de datos), `memstore_test.go`, `equivalence_test.go`, `bench_test.go`. Archivo adicional fuera de `engine/`: `backend/internal/authz/engine_oracle_test.go` (paquete `authz_test`): corre la matriz de 2 070 casos contra el oráculo CONGELADO de P0 (que es privado del paquete de pruebas `authz_test` y no se puede importar desde `engine`); `engine/equivalence_test.go` corre la misma matriz contra `authz.Resolve` vivo.

## 2. Interfaz `engine.Store` (la que implementa `repository.AccessStore`, P2)

```go
type Store interface {
    LoadAccess(ctx, user, org uuid.UUID) (*AccessData, error)   // una consulta (UNION por subject), todo lo necesario
    Epochs(ctx, user, org uuid.UUID) (Epochs, error)            // organizations.access_epoch y users.access_epoch, por PK
}
type Epochs struct{ Org, User int64 }
type AccessData struct {
    Member, UserActive, MemberActive bool          // Member=false: no es miembro (no es error)
    Template *OrgTemplate                           // nil: la plantilla de org no resuelve (el motor cierra)
    Policy   string                                 // organizations.project_access_mode; solo "restricted" restringe
    ProjectOverrides map[uuid.UUID]string           // projects.access_override no nulos ("open"|"restricted")
    Assignments []Assignment                        // usuario directo + grupos del usuario, todos los alcances de la org
    Epochs Epochs                                   // leídas ANTES que las filas
}
type OrgTemplate struct {
    ID uuid.UUID; Slug string; Version int
    Permissions catalog.Set
    FloorID, BaseID uuid.UUID; Floor, Base catalog.Set        // ya expandidos desde la plantilla de proyecto
    HasCeiling bool; Ceiling, CeilingProject catalog.Set      // D1 de P0; sin ceiling_project propio: CeilingProject = Ceiling
}
type Assignment struct {
    ID uuid.UUID; SubjectKind SubjectKind("user"|"group"); SubjectID uuid.UUID
    Scope ScopeType(ScopeOrg|ScopeProject|ScopeRepo|ScopeEnv); ScopeID, ProjectID uuid.UUID
    TemplateID uuid.UUID; TemplateSlug string; TemplateVersion int
    Permissions catalog.Set          // contenido de la versión vigente (fijada o última)
    Source string                    // manual|migrated|legacy-api|approver|oidc|temporary
    ExpiresAt time.Time              // cero = no caduca; por grupo: min(asignación, membresía del grupo)
}
```

Obligaciones del store: no devolver filas revocadas, de membresía no activa, de grupos archivados ni membresías de grupo caducadas; SÍ puede devolver asignaciones ya caducadas (el motor las ignora y `Explain` las nombra). Resolver `pin_version` y la última versión, y expandir `floor`/`base` a conjuntos. Aprobadores de entorno: asignación `Scope=ScopeEnv`, `Source="approver"`, `Permissions={promotion:approve}` (más `project:view` si se quiere que ver el entorno baste). Las épocas deben leerse antes que las filas (una escritura concurrente solo puede hacer que el snapshot parezca más viejo, nunca más nuevo; el siguiente chequeo estricto lo recompila). `Invalidate(Target{Org|User})` lo llama el oyente de `NOTIFY capsule_access` y el proceso que escribe.

## 3. Decisiones y discrepancias

1. **Firma de `Can`.** WORKBREAKDOWN dice `Can(ctx, user, scope, perm)`; la organización hace falta para el snapshot, así que es `Can(ctx, user, org, scope, perm)` (igual que `Effective`). `Scope` es una estructura con constructores `OrgScope()`, `ProjectScope(p)`, `RepoScope(p, r)`, `EnvScope(p, e)`; en repo y entorno lleva el proyecto padre (el llamador ya verificó que pertenece a la org, como hoy).
2. **Monotonía (SPEC 5.5) no es literal.** SPEC 5.5 dice que añadir una asignación nunca quita nada, pero SPEC 5.3 regla 2 dice que la PRIMERA asignación propia de un proyecto SUSTITUYE al respaldo (member con fila viewer baja de deployer a viewer; es el comportamiento heredado que la matriz exige). Ambas no pueden ser ciertas a la vez. Decisión: se conserva la sustitución (equivalencia) y la propiedad se prueba así: añadir una asignación nunca quita permisos en ningún alcance salvo en el proyecto (y sus repos y entornos) donde esa asignación es la primera propia viva; en esos casos solo se exige que el techo y el floor sigan aplicados. Añadir una segunda fila al mismo proyecto, una de alcance org, repo o entorno, o una pertenencia a grupo con filas en proyectos que ya tienen propias, siempre es monótono. SPEC 5.5 debería reformularse en ese sentido.
3. **Suspendido y plantilla que no resuelve en alcance de proyecto: `Hidden=true`.** SPEC 5.3 solo dice `Member=true, set=vacío, motivo=suspended`. Para no revelar la existencia de proyectos a un suspendido (403 frente a 404), `Access.Hidden` es true en alcance proyecto, repo y entorno; en alcance org es false. `Access.Reason` distingue `suspended`, `template_unresolved`, `hidden`, `not_member`. Es coherente con el oráculo para el rol de org desconocido (`Hidden=true`).
3b. **Visibilidad de lista y repo/entorno.** `FilterProjects` y `Visibility` evalúan solo el alcance proyecto: quien tiene únicamente una asignación de repo o entorno ve ese repo/entorno pero no aparece en el listado de proyectos. SPEC 5.3 solo habla de visibilidad por repo/entorno al abrirlos; si se quiere listar esos proyectos hay que decidirlo (no afecta a la equivalencia).
4. **`Source` del acceso** (rol viejo `Source`): `org` si el floor contiene todo el conjunto efectivo, `explicit` si hay asignaciones propias (o de repo/entorno), si no `inherited`. Reproduce el oráculo (owner/admin con fila: `org`; readonly con fila: `explicit`).
5. **`LegacyRole(Set) string`**: `admin` si el conjunto contiene la plantilla de proyecto `admin` del sistema, si no `deployer` si contiene `deployer`, si no `viewer` si hay `project:view`, si no vacío. Nunca sobrestima. Devuelve `string` (no `authz.Role`) para que `engine` no dependa de los tipos viejos; `engine` importa `systemtemplates` (y este a `authz`), `authz` no importa `engine`.
6. **`Can` y permisos `sensitive`** toman la ruta estricta automáticamente (una llamada a `Store.Epochs`, recompila si cambió). `CanStrict`/`EffectiveStrict` fuerzan la estricta (tokens `cap_`). `Effective` no es estricto. Un fallo del store en cualquier camino da `false` y el error (cierra). `CanAll` con lista vacía o con un permiso desconocido devuelve `false`.
7. **Invalidación a prueba de carreras.** Un contador de generación impide cachear una compilación que se solapó con un `Invalidate`; los cargadores concurrentes de la misma clave comparten una sola carga (singleflight) y `Invalidate` descarta las cargas en vuelo para que los llamadores nuevos no se unan a datos viejos. Una petición que ya estaba en vuelo puede ver el dato anterior (lo mismo que hoy con cualquier lectura concurrente a una escritura).
8. **Caducidad:** el snapshot guarda `validUntil = min(compilación + 30 s, próxima caducidad)`; al pasar ese instante se recompila solo (sin barrido ni `NOTIFY`). El barrido de un minuto (`access.expired`) sigue siendo de P2/P3.
9. **No hecho (fuera de la lista de archivos de P1):** el adaptador `AsLegacy` mencionado en WORKBREAKDOWN no se escribió (el cableado es P3 y la lista de archivos del encargo no lo incluía); los permisos de plataforma (`platform-user:*`, `platform-backup:*`) no los evalúa `Effective` (dependen de `users.platform_role`, no de la organización); no hay máscara de alcance por permiso (un conjunto de plantilla con permisos fuera del alcance se rechaza al guardar, SPEC 5.1).
10. **Calidad de las pruebas aleatorias:** semilla fija `20261104`; el generador produce 4 681 casos concedidos de 20 000; en monotonía, 2 590 de 10 000 casos con techo y 7 545 comparaciones exentas por sustitución legítima (sobre unas 85 000 comparaciones por alcance), el resto exige superconjunto estricto.

## 4. Cómo se prueba

```
cd backend
go test -race -count=1 -cover ./internal/authz/...
go test -run xxx -bench 'Can|Effective|Explain' -benchtime 2000000x ./internal/authz/engine
go test -run xxx -bench Compile10k -benchtime 50x ./internal/authz/engine   # no usar -bench . con -benchtime Nx alto: Compile10k tarda ms por iteración
```
