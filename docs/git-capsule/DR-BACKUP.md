# Git Capsule: recuperación total (DR) y respaldos

Estado: diseño. Nada de esto se ha ejecutado; las cifras de RPO/RTO son **hipótesis** hasta medirlas con el primer simulacro (sección 8). Marcas: (V) verificado en el repo, (?) por verificar.

## 1. Objetivo y alcance

Poder reconstruir **desde cero** el servidor de Capsule (núcleo, Git, proyectos y sus datos) y también un **proyecto aislado**, con un solo comando reproducible, idempotente y verificable, y con un ensayo periódico que demuestre que funciona. Principio ya decidido: los respaldos son de **datos**, no del despliegue completo; los manifiestos permiten volver a montar los contenedores.

## 2. Inventario: qué hay, dónde está y cómo se recupera

| Pieza | Dónde vive hoy | Respaldo | Recuperación |
|---|---|---|---|
| Base de Capsule (usuarios, orgs, proyectos, despliegues, git_*, entornos, alertas, tokens, auditoría) | RDS Postgres (V `deploy/terraform/db.tf`: `backup_retention_period = 7`, `skip_final_snapshot = false`) | Backups automáticos de RDS con restauración a un punto en el tiempo dentro de 7 días (PITR, funcionalidad estándar de RDS (?) confirmar que la instancia lo tiene habilitado: depende de la clase y de `backup_retention_period > 0`) | Restaurar a una instancia nueva (snapshot o PITR) y cambiar el endpoint |
| Fuentes de cada despliegue | Bucket de artefactos S3 `capsule-artifacts-<cuenta>` con versionado (V `s3.tf`) | Versionado S3 | Reconstruir imágenes desde esas fuentes |
| Respaldos de **datos** de proyecto: volcados de bases, volúmenes | Bucket de respaldos S3 (V `backups.tf`, retención 30 días por defecto `backup_s3_retention_days`), tablas 000032: `backup_settings`, `backup_runs`, `backup_snapshots` (`kind IN database, volume, manifest, platform`; `checksum`, `object_key`) | Programados por Capsule por proyecto (`hourly|6h|12h|daily|weekly`, `retention_days >= 1`) | `capsule backups restore` por snapshot; `recover` los orquesta |
| **Manifiestos** (cómo volver a montar cada contenedor: imagen/commit, env cifrado, puertos 000031, red, volúmenes, límites) | `backup_snapshots kind='manifest'` | Cifrados y firmados (sección 7) | Entrada del paso "proyectos" |
| Plataforma: `docker-compose.prod.yml`, `.env` **cifrado**, certificados y estado de Caddy (`capsule-git-caddy`), claves de la plataforma, exportación de registros DNS, inventario | `backup_runs` con `project_id NULL` (V 000032: "server files + inventory") | Respaldo `kind='platform'` cifrado | Paso "núcleo" |
| Git (Forgejo): repos, SQLite, `app.ini`, adjuntos, `custom/` | Volumen `capsule-git-data` | `forgejo dump` diario cifrado AES-256 a S3, prefijo `forgejo/`, versionado, retención 30 días, 03:17 Lima (V `deploy/forgejo/README.md` §9) | `forgejo-restore` (README §9) dentro de `recover` |
| Infraestructura | Terraform en `deploy/terraform` (V). **Estado local** en `terraform.tfstate` dentro del directorio (V al listar) | Git no guarda el estado | Ver sección 11, acción 1 |
| Imágenes | ECR (V `ecr.tf`) y builds del builder | Se reconstruyen de las fuentes; ECR conserva las últimas (?) revisar política de ciclo de vida | Reconstruir si falta |
| Runner de CI | EC2 aparte (V Terraform `runner.tf`) | Sin estado relevante | Recrear con Terraform y registrar con token nuevo |
| Redis | contenedor | Ninguno | Se pierde (sesiones/limites); aceptado |

## 3. Interfaz `recover`

CLI (C3 y CLI.md §3.7) y API (`gitRecoverPlatform`, `recoverProject`, `gitRecoverGet`):

```
capsule recover plan   [--project P | --all] [--snapshot ID|--at 2026-11-01T10:00Z] [--target in_place|ephemeral] [--scope network,core,git,databases,volumes,projects,dns]
capsule recover apply  [mismos flags] [--yes] [--force-overwrite] [--resume RUN_ID]
capsule recover verify [--project P | --all]
capsule recover status RUN_ID
```

- **plan** (solo lectura): resuelve qué respaldo usar de cada pieza, comprueba que existen, que los checksums y firmas valen, que hay credenciales (frase de cifrado, acceso S3) y estima duración; imprime el plan paso a paso y los **riesgos** (p. ej. "proyecto X sin respaldo de volúmenes"). Es determinista: misma entrada, mismo plan.
- **apply** ejecuta el plan; sin `--yes` pide confirmación mostrando lo que sobrescribe; operaciones destructivas (sobrescribir datos existentes) exigen `--force-overwrite` y hacen antes un respaldo previo ("pre-restore").
- **verify** repite solo la verificación (sección 7), sin cambiar nada.
- `--target ephemeral` restaura en una instancia aislada sin tocar DNS ni producción (usado por el simulacro).
- Endpoint de plataforma `POST /git/admin/recover` solo para administradores de plataforma; por proyecto `POST /orgs/{o}/projects/{p}/recover` requiere `project.delete` (admin), porque sobrescribe datos. Ambos aceptan `Idempotency-Key` y devuelven `RecoverRun` (pasos con estado).
- Cuando la base de Capsule aún no existe (arranque desde cero), la API no está disponible: `capsule recover` funciona entonces en **modo bootstrap** desde un host con AWS CLI y Terraform, sin servidor Capsule (usa el diario local, sección 5).

## 4. Orden de operaciones

Cada fase tiene `check` (¿ya está hecho?), `apply`, `verify`. No se pasa a la siguiente sin `verify` OK (o `--continue-on-error` para fases de proyecto).

| Fase | Contenido | Dependencias | Verificación |
|---|---|---|---|
| F0 Preflight | Credenciales, frase de cifrado, versiones de herramientas, listar respaldos candidatos, comprobar checksums/firmas, bloqueo de una sola recuperación a la vez | - | plan sin errores |
| F1 Red | `terraform plan/apply` (VPC, SG, IP elástica, buckets, IAM) usando el estado recuperado; **la ejecución de `apply` de infraestructura requiere `--apply-infra` explícito** | F0 | salidas de Terraform coinciden con lo esperado (IP elástica, endpoints) |
| F2 Núcleo | Restaurar RDS (PITR o snapshot) a instancia nueva; arrancar host (Docker, compose), descifrar `.env` y claves de plataforma; levantar `backend`, `redis`, `frontend` | F1 | `/health` OK, migraciones al día, conteos coinciden con el catálogo del respaldo |
| F3 Git | Volumen de Forgejo desde `forgejo dump` descifrado, `forgejo admin regenerate hooks`, `forgejo doctor check --all`, Caddy con su estado (certificados); registrar runner con token nuevo | F2 | repos en Forgejo == proyectos con `git_core_state.status='ready'`; `git fsck` de una muestra; clonado de prueba; login OIDC |
| F4 Bases de proyectos | Restaurar volcados (`backup_snapshots kind='database'`) en el motor de cada proyecto según manifiesto | F2 | restauración por motor, conteo de tablas, checksum |
| F5 Volúmenes | Restaurar volúmenes de proyecto (`kind='volume'`) | F2 | checksum, tamaño |
| F6 Proyectos | Reconstruir imágenes desde las fuentes de S3 (último despliegue exitoso o el del manifiesto), recrear contenedores desde manifiestos (env, puertos, red, límites) en orden de dependencias, reaplicar reglas de puertos (`netaccess` reconcile), reactivar crons y workers | F4, F5 | contenedor sano y chequeo de salud (000033) |
| F7 DNS y certificados | Reasociar la **misma IP elástica** si es posible; si no, emitir lista de registros DNS a cambiar (el usuario los pone; Namecheap) y verificar resolución; ACM/Caddy | F2, F3 | `dig`, certificado válido (`notAfter`), HTTPS responde |
| F8 Verificación global | Pruebas de humo: login, listar proyectos, un push y un clonado al Git, un despliegue de prueba, un respaldo nuevo y su restauración de prueba | F1-F7 | informe |
| F9 Informe | JSON y Markdown: qué se restauró de qué respaldo, duraciones, fallos, datos perdidos estimados (RPO real) | F8 | guardado en S3 `drills|recoveries/` y en `backup_runs` (`kind='verify'`) |

Recuperación **por proyecto** = F4, F5, F6 (y `verify`) con el núcleo ya sano; `--snapshot` fija el punto. Si el proyecto tiene Git, el repo se recupera con el Git (F3) y no con el proyecto.

## 5. Idempotencia, reanudación y concurrencia

- Cada paso es una función `check/apply/verify` con **resultado registrado** en el diario del run (`recovery_runs.steps`, jsonb) y, en modo bootstrap, en un archivo JSON local con el mismo formato (se vuelca a la base en cuanto existe).
- Reintentar = `--resume RUN_ID`: se saltan los pasos `ok`; el primero no `ok` se vuelve a ejecutar. Un paso destructivo repetido no repite la destrucción: `check` compara checksum del destino con el respaldo.
- Operaciones con nombres deterministas (`restore-<runID>-<paso>`); recursos de AWS etiquetados con `capsule:recovery=<runID>`; una sola recuperación activa (índice único parcial, como `uq_backup_runs_running` de 000032).
- Todo respaldo previo a sobrescribir se conserva 14 días (`kind='backup'`, `trigger='pre-restore'`).

## 6. Cifrado y claves

- Los respaldos de datos y de plataforma van cifrados (AES-256, `openssl enc -pbkdf2` como `forgejo-backup`, V README §9, o equivalente con sobre de clave por KMS más adelante, según la decisión del proyecto de dejar KMS para después). La **frase** (`GIT_BACKUP_PASSPHRASE` y la de plataforma) debe existir **fuera del servidor** (sobre sellado o gestor de secretos del dueño): sin ella no se recupera nada; `recover plan` pide comprobarla (descifra un bloque de prueba).
- La clave local de la plataforma (usada para cifrar secretos en la base: webhooks, credenciales git, tokens) forma parte del respaldo `platform` cifrado; sin ella los secretos de la base RDS restaurada serían ilegibles. Se prueba en el simulacro (descifrar un secreto real de prueba).
- El usuario IAM de respaldos solo puede escribir/listar (V para Forgejo); extender el mismo principio a los respaldos de datos y evaluar S3 Object Lock en modo gobernanza (?) para resistir borrado malicioso.

## 7. Verificación de integridad

1. **Checksums**: `backup_snapshots.checksum` (sha256) se verifica antes de descifrar y antes de restaurar; fallo = paso `failed`, nunca se restaura a medias.
2. **Firmas de manifiesto**: cada manifiesto lleva HMAC-SHA256 con una clave de plataforma; un manifiesto manipulado se rechaza (evita que un atacante con acceso al bucket cambie imagen o env).
3. **Estructura**: `pg_restore --list` o equivalente por motor antes de aplicar; `forgejo doctor check --all`; `git fsck` en muestra aleatoria (10 % o mínimo 3 repos).
4. **Conteos cruzados**: proyectos en RDS vs contenedores levantados; repos de Forgejo vs `git_core_state='ready'`; tablas por base vs el manifiesto.
5. **Humo funcional** (F8). El informe lista cada verificación con su resultado.

## 8. Simulacro periódico

- **Frecuencia**: mensual y tras cualquier cambio de versión mayor de Forgejo/Postgres/Capsule; disparado por un cron de Capsule o a mano (`capsule recover verify --all --drill`).
- **Cómo**: Terraform `deploy/terraform/recovery_drill.tf` (C3, solo plan en esta fase) lanza una instancia **efímera** (t3.medium puntual) en una subred aislada sin ingreso público y con etiqueta de caducidad (autodestrucción a las 4 h); `recover apply --target ephemeral` restaura F1-F8 desde los respaldos reales, sin tocar DNS, IP elástica ni producción (usa credenciales de solo lectura sobre los buckets); ejecuta humo y compara con el catálogo; genera informe y destruye la instancia.
- **Informe** (JSON + Markdown, en S3 `drills/` y visible en el dashboard): fecha, respaldos usados y su antigüedad (RPO real), duración por fase (RTO real), fallos, datos no recuperables, versión de las herramientas. Falla roja si: algún checksum no coincide, la duración supera el RTO objetivo, hay proyectos sin respaldo, o el simulacro no corrió en 35 días (alerta por correo/Slack).
- **Costo estimado**: unas horas de una instancia pequeña al mes más almacenamiento temporal y transferencia: orden de unos pocos dólares al mes **(?)** a medir con el primer simulacro real.

## 9. RPO y RTO objetivos (realistas con este presupuesto)

El presupuesto actual es un solo host (t3.medio) y una instancia RDS, sin servidores en espera.

| Dato | RPO objetivo | Por qué | Cómo mejorar |
|---|---|---|---|
| Base de Capsule | <= 5 min dentro de 7 días | PITR de RDS (?) verificar | Subir retención a 14-35 días y copiar snapshots a otra región (coste bajo) |
| Fuentes de despliegues | 0 (lo ya subido) | S3 versionado | - |
| Repos Git | **6 h** (propuesta) vs 24 h actual | hoy `forgejo dump` diario | dump cada 6 h; para menos, push mirror a un segundo destino |
| Bases y volúmenes de proyectos | la frecuencia configurada por proyecto (por defecto `daily` = 24 h; volúmenes **desactivados** por defecto) | 000032: `include_volumes` por defecto `false` | `capsule backups set --schedule 6h --volumes` para proyectos críticos; alerta si un proyecto productivo no respalda volúmenes |
| Plataforma (compose, `.env`, claves, certificados) | 24 h (cambia poco) | respaldo `platform` diario y tras cada cambio | disparo en cada despliegue de plataforma |

| Escenario | RTO objetivo | Estimación (a confirmar) |
|---|---|---|
| Un proyecto | 30 min | descargar y restaurar datos, reconstruir imagen, levantar |
| Git solamente | 1 h | descifrar y restaurar dump, regenerar hooks, doctor |
| Plataforma completa (~10 proyectos) | **4 h** objetivo, 8 h peor caso | Terraform 30-45 min, RDS 30-60 min, Git 30 min, bases y volúmenes 30-60 min, reconstrucciones de imagen en serie 5-15 min cada una, DNS (propagación) |

Condición para que el RTO se cumpla: el simulacro mensual debe haberlo demostrado; mientras no, el RTO oficial es "no medido" y se informa como 8 h.

## 10. Qué NO está cubierto

| No cubierto | Consecuencia | Qué se hace al respecto |
|---|---|---|
| Datos desde el último respaldo (RPO) | Pérdida de hasta el RPO de cada dato | Frecuencias configurables; informe muestra el RPO real; alerta si un proyecto productivo no respalda |
| Volúmenes de proyectos sin `include_volumes` (por defecto desactivado) | Archivos subidos por usuarios se pierden | `recover plan` los lista como riesgo; banner en el dashboard; activar por defecto en proyectos con volúmenes (decisión de producto en `backups set`) |
| Pérdida de la frase de cifrado o de la clave de plataforma | Respaldos y secretos ilegibles: **irrecuperable** | Copia fuera del servidor y verificación en cada simulacro |
| Estado de Terraform local (hoy en `deploy/terraform/*.tfstate`) | Sin él, F1 no puede reconciliar | Pasar a backend remoto S3 con bloqueo (acción 1, sección 11) |
| Compromiso malicioso del bucket (borrado/alteración) | Pérdida de respaldos | Firma de manifiestos, IAM solo escritura, evaluar Object Lock y copia en otra cuenta |
| Caída de toda la región de AWS | Sin recuperación hasta que vuelva la región | Copia de snapshots RDS y de los buckets a otra región como mejora opcional; plan documentado de F1 en otra región |
| Redis (sesiones, límites de tasa) | Los usuarios vuelven a iniciar sesión | Aceptado |
| Imágenes cuya construcción ya no es reproducible (dependencias retiradas del registro) | F6 falla para ese proyecto | Conservar las últimas imágenes en ECR (política de ciclo de vida a revisar); manifiestos guardan el digest |
| Estado interno del runner de CI | Se recrea; cachés se pierden | Terraform + token de registro nuevo; sin datos únicos |
| Registros DNS de Namecheap y el registro del dominio | Si se pierde la cuenta, no hay recuperación técnica | Exportación de registros en el respaldo `platform` y copia de seguridad de acceso a la cuenta (responsabilidad del dueño) |
| Let's Encrypt (límites de emisión) | Certificado nuevo puede tardar | Respaldar el estado de Caddy y restaurarlo; probar en simulacro |
| Logs de ejecución y métricas históricas | Se pierden | Aceptado salvo `audit_logs`, que viven en RDS |
| Recuperación de un instante dentro de un proyecto fuera de los snapshots retenidos | No hay datos | Retención configurable; informar al crear el proyecto |

## 11. Cambios necesarios para cumplir este diseño (acciones)

1. Mover el estado de Terraform a un backend remoto (S3 con versionado y bloqueo (DynamoDB o bloqueo nativo (?))) y excluirlo del repositorio; incluir su copia en el respaldo `platform`.
2. Subir la frecuencia del `forgejo dump` a cada 6 h (cron `17 */6 * * *`) y sacar el volcado fuera de horas de build; añadir restauración probada al simulacro (hoy `NO se ha ejecutado`, README §9).
3. Respaldo `platform` cifrado con: compose, `.env`, claves de plataforma, estado de Caddy, exportación DNS, inventario de proyectos, versión de cada imagen/servicio.
4. Incluir `capsule-git-caddy` y `deploy/forgejo/custom/` en el respaldo de plataforma.
5. Política de alerta: sin respaldo reciente (> 26 h para Forgejo, > 2x la frecuencia para cada proyecto), checksum fallido, simulacro vencido.
6. `include_volumes` por defecto `true` para proyectos que declaran volúmenes (cambio de producto en 000032/CLI; coordinar con el agente de respaldos).
7. Retención de RDS a 14 días mínimo y copia de snapshots a otra región (decisión de costo, DR-BACKUP no la impone).
8. Paquete C3 de `WORKBREAKDOWN.md` implementa `recover`, el diario de pasos y el módulo del simulacro.
