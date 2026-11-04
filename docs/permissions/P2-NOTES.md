# P2 notas: discrepancias y decisiones

1. **Numeracion**: 000066-000071 (000065 ya ocupada). Orden: 066 usuarios/orgs/proyectos + `access_anomalies`; 067 plantillas; 068 grupos y asignaciones; 069 miembros, invitaciones, transferencias, `api_tokens`; 070 siembra de identidad + backfill; 071 triggers.
2. **Siembra**: SQL no puede leer `systemtemplates.json`. 070 inserta las 9 cabeceras con UUID v5 (namespace de P0, `kind/slug`) y hace el backfill; el CONTENIDO de la version 1 lo inserta `repository.SeedSystemTemplates` (usa `authz/systemtemplates`, idempotente, falla cerrado si la BD difiere del JSON). Debe llamarse tras `RunMigrations` (cableado en P3). Sin sembrar, las plantillas no resuelven y el motor cierra.
3. **`ceiling_project`**: columna `text[]` en `role_template_versions` (ademas de `ceiling`), segun P0.
4. **Anti-bucle**: bandera transaccional `capsule.access_sync` en vez de `pg_trigger_depth()=1` (las cascadas FK anidan triggers y una guarda por profundidad se saltaria bajas de proyecto/usuario). Probado con sondas.
5. **Espejo project_members <-> asignaciones**: solo usuario directo, alcance proyecto, plantilla de proyecto del sistema, fuente `migrated`/`legacy-api`, no revocada. Revocar = `revoked_at`. Si ya existe una asignacion viva manual con la misma plantilla no se duplica (unica por plantilla). La caducidad no se espeja: el barrido (P5) debe revocar.
6. **`org_members.template_version`**: NULL = sigue la ultima version (siempre con plantillas del sistema). MIGRATION sec. 2 habla de "template_version"; se interpreta asi.
7. Los triggers de camino viejo (org_members, project_members, users) suben `access_epoch` y hacen NOTIFY; las escrituras nuevas lo hacen via `InTx`. Riesgo teorico de deadlock entre `InTx` (bloquea org y luego pm) y escritura vieja (pm y luego org): Postgres aborta una; no observado.
8. Sin `citext`: `invitations.email` varchar con indice `lower(email)`. `UNIQUE NULLS NOT DISTINCT` sustituido por dos indices parciales (PG < 15).
9. `engine.Store` (P1) no existia: `repository.AccessSource` es el contrato minimo; el adaptador es mapeo de tipos. `LoadUserAssignments` devuelve la forma ligera (sin reason/created_*); `LoadAssignmentDetails` completa por id.
10. Validacion de permisos en el repositorio: solo formato y sin comodines en plantillas propias; existencia en catalogo y dependencias son de P4.
