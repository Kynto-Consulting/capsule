# Recuperacion total (paquete C3)

Implementa `docs/git-capsule/DR-BACKUP.md`. Codigo en `backend/internal/recovery/`, API en `handlers/recover.go`, CLI en `cli/cmd/capsule/recover.go`, scripts aqui.

## Piezas

| Pieza | Que hace | Donde corre |
|---|---|---|
| `capsule recover plan\|apply\|verify\|status` | Plan determinista, aplicacion paso a paso e idempotente, verificacion sin cambios | CLI contra la API (`POST /git/admin/recover`, `POST /orgs/{o}/projects/{p}/recover`, `GET /git/admin/recover/{runID}`) |
| `git-restore.sh check\|apply\|verify` | F3: valida sha256 del dump, descifra, extrae, coloca en un arbol de staging y lo intercambia | Host de Git o instancia efimera |
| `smoke.sh` | F8: salud y `git fsck` en muestra | Host recuperado |
| `recover.sh plan\|apply [--apply-infra]` | Modo bootstrap (sin API): `terraform plan`, y `apply` solo con `--apply-infra` | Host de operador con AWS CLI y Terraform |
| `drill.sh` | Simulacro mensual contra una instancia efimera | Instancia de `deploy/terraform/recovery_drill.tf` |
| `tests/drill-git-restore.sh` | Simulacro local de `git-restore.sh` con openssl, sha256sum y tar reales | Cualquier maquina con bash |
| `terraform-backend/` | Backend remoto S3 con bloqueo, **preparado y sin activar** | ver abajo |
| `forgejo-backup.cron.example` | Respaldo de Forgejo cada 6 h | crontab del host |

## Contrato de los scripts (`ScriptExec`)

`<script> check|apply|verify`. `check` sale con 0 si ya esta hecho y 10 si no; `apply` y `verify` con 0 si salen bien. El contexto va en variables `RECOVERY_*` (`RECOVERY_RUN_ID`, `RECOVERY_STEP`, `RECOVERY_TARGET`, `RECOVERY_DUMP_KEY`, `RECOVERY_DUMP_SHA256`); las credenciales (`GIT_BACKUP_PASSPHRASE`, `AWS_*`) van solo por entorno, nunca por argumentos ni en el diario.

## Que hace cada modo

- **plan** (solo lectura): carga el catalogo (base de datos o, sin ella, el listado del bucket), verifica el manifiesto MAS NUEVO de cada proyecto (no cae al anterior si el nuevo esta manipulado) y devuelve pasos F0..F9 mas riesgos. Misma entrada, mismo plan y mismo `plan_id` (sha256 del plan canonico).
- **apply**: por paso `check -> apply -> verify`; lo que `check` da por hecho no se repite. Cada transicion se guarda en `recovery_runs.steps` (o en un archivo JSON en modo bootstrap). Un solo `apply` activo (indice unico parcial). Reanudar = volver a ejecutar el mismo run: los pasos `ok` se saltan. Un destino con datos distintos exige `force_overwrite` y se conserva una copia `.pre-restore-<run>`.
- **verify**: solo la mitad de verificacion; no cambia nada.
- Cambios de infraestructura (Terraform, RDS, DNS, Caddy, runner) **nunca** salen de la API: el paso queda `skipped` con la razon; se hacen con `recover.sh` desde un host de operador.

## Integridad (DR-BACKUP.md seccion 7)

1. Etiquetas AES-GCM de cada bloque del sobre: un byte cambiado, un bloque quitado o reordenado falla (`ErrAuth`). Falsificar un manifiesto exige la llave de datos, que va envuelta con `CAPSULE_SECRET_KEY`: cumple el papel del HMAC de manifiesto que pedia el diseno (no se agrego un HMAC aparte porque los manifiestos existentes no lo traen y el sobre ya los autentica).
2. sha256 registrado en `backup_snapshots.checksum`, comparado antes de restaurar. Un respaldo antiguo reinsertado en la ruta del nuevo falla por esto.
3. Estructura: esquema de manifiesto conocido (1), id de proyecto e id de run del manifiesto iguales a los de la ruta del objeto.
4. Dump de Forgejo: sha256 del `.enc` contra su `.sha256` antes de descifrar; sin `.sha256` el plan marca `DUMP_NO_CHECKSUM` (bloqueante).

En modo bootstrap no hay checksums guardados: la integridad descansa en las etiquetas GCM y el plan lo avisa (`NO_CHECKSUM_CATALOG`).

## Variables del servidor

`CAPSULE_RECOVERY_ENABLED=true` (apagado por defecto), `CAPSULE_RECOVERY_WORKDIR`, `CAPSULE_RECOVERY_SCRIPTS_DIR`, `CAPSULE_RECOVERY_SCRIPTS=true` (permite que el servidor ejecute `git-restore.sh` y `smoke.sh`), `CAPSULE_RECOVERY_FORGEJO_BUCKET`, `CAPSULE_RECOVERY_TIMEOUT_HOURS` (8). Reutiliza `CAPSULE_BACKUPS_BUCKET` y `CAPSULE_SECRET_KEY`. La restauracion en el sitio de bases y volumenes por la API necesita `Service.SetInPlace(...)` (ServiceRestorer sobre `backup.Service`), que el integrador debe cablear despues de `wireBackups`; sin eso esos pasos salen `skipped`, no simulados.

## Respaldo de Forgejo cada 6 horas

`forgejo-backup.sh` (de `deploy/forgejo/`) no cambia: solo el cron. Sustituye la linea diaria de `deploy/forgejo/README.md` seccion 9 por la de `forgejo-backup.cron.example` (`17 */6 * * *`) y mueve la alerta de 26 h a 8 h. Ese README no se edito en este paquete (no es de C3): queda pendiente actualizarlo.

## Terraform: backend remoto S3 con bloqueo (preparado, NO migrado)

El estado sigue siendo local (`deploy/terraform/terraform.tfstate`). Nada de esto se ejecuto. Para migrar:

1. Crear el bucket de estado (`terraform-backend/state-bucket.tf.example`, en un directorio aparte o con la AWS CLI; versionado, SSE, TLS obligatorio, sin acceso publico, `prevent_destroy`).
2. Subir `required_version` a `>= 1.10` en `main.tf` (bloqueo nativo con `use_lockfile`; con una version anterior usa `dynamodb_table`).
3. Copiar `terraform-backend/backend.s3.tf.example` a `deploy/terraform/backend.s3.tf` y poner el nombre real del bucket.
4. `cd deploy/terraform && cp terraform.tfstate ../terraform.tfstate.premigration && terraform init -migrate-state` (responde que si a copiar el estado).
5. `terraform plan` debe salir sin cambios. Despues, sacar `terraform.tfstate*` del repositorio (`git rm --cached` y `.gitignore`) y anadir el estado al respaldo `platform`.

## Simulacro

`recovery_drill.tf` crea (solo con `recovery_drill_enabled = true`) un t3.medium sin ingreso, con rol de solo lectura sobre los buckets de respaldo y escritura solo en `drills/`, que se apaga solo (`recovery_drill_ttl_hours`, 4 por defecto). Limite honesto: usa la VPC por defecto con IP publica solo para salida; una subred aislada con endpoint de S3 es mejor pero cambia tablas de rutas de la VPC de produccion, asi que no se aplico a ciegas. En esta fase solo se valido con `terraform validate`; `terraform plan` necesita credenciales de AWS y no se corrio.

El informe (`drills/<fecha>-<run>.json|md`) lista respaldos usados con su antiguedad (RPO real), duracion por fase (RTO real) y condiciones rojas: checksum que no coincide, duracion mayor al RTO de 4 h, proyectos sin respaldo, simulacro anterior de mas de 35 dias, pasos fallidos.
