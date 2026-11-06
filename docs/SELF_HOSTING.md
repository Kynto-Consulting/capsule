# Capsule — Self-Hosting Setup Guide

This document covers everything you need to configure when deploying Capsule on your own infrastructure. Follow each section in order.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| AWS account | EC2 + S3 + Lambda + SES + ACM + ALB |
| Domain name | You control DNS (e.g. via Namecheap, Route53, Cloudflare) |
| EC2 instance | t3.medium+ recommended, Amazon Linux 2 |
| PostgreSQL | Neon serverless or RDS — set `DATABASE_URL` |
| Redis | Docker on EC2 or ElastiCache — set `REDIS_URL` |

---

## 2. AWS Resources to Create

### 2a. S3 Buckets

```bash
# Artifacts bucket (private — stores deployment source archives)
aws s3 mb s3://capsule-artifacts-<YOUR_ACCOUNT_ID>

# Static hosting bucket (public — serves static site deployments)
aws s3 mb s3://capsule-static-<YOUR_ACCOUNT_ID>
aws s3 website s3://capsule-static-<YOUR_ACCOUNT_ID> \
  --index-document index.html --error-document 404.html
```

Set bucket policy on static bucket to allow public reads:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::capsule-static-<YOUR_ACCOUNT_ID>/*"
  }]
}
```

### 2b. IAM Roles

**EC2 instance role** (`capsule-builder`) — attach to your EC2:
- `AmazonS3FullAccess` (scoped to your buckets)
- `AWSLambdaFullAccess`
- `AmazonSESFullAccess`
- `iam:PassRole` to `capsule-lambda-role`

**Lambda execution role** (`capsule-lambda-role`):
- Trust: `lambda.amazonaws.com`
- Policy: `AWSLambdaBasicExecutionRole`

### 2c. ACM Certificate

Request a wildcard cert for your apps subdomain:
```bash
aws acm request-certificate \
  --domain-name "*.apps.yourdomain.com" \
  --subject-alternative-names "apps.yourdomain.com" \
  --validation-method DNS \
  --region us-east-1
```

Add the DNS validation CNAME records to your DNS provider. Wait for status `ISSUED`.

### 2d. Application Load Balancer

Create an ALB that:
- Listens on HTTPS:443 using the ACM cert above
- Forwards to the Capsule backend (port 8080) or frontend (port 3000)
- Has a security group allowing 443 inbound from 0.0.0.0/0

Note the ALB DNS name — you'll need it for DNS configuration.

---

## 3. DNS Configuration

In your DNS provider, add:

| Type | Name | Value |
|---|---|---|
| CNAME | `*.apps` | `<your-alb-dns>.us-east-1.elb.amazonaws.com` |
| CNAME | `app` | `<your-alb-dns>.us-east-1.elb.amazonaws.com` (optional, for dashboard) |

Example for `yourdomain.com`:
- `*.apps.yourdomain.com` → ALB DNS

This means every deployed project gets `{project-slug}.apps.yourdomain.com` automatically.

---

## 4. Environment Variables

### Backend (`.env.production` or docker-compose env)

```env
# Required
DATABASE_URL=postgresql://user:pass@host/capsule
CAPSULE_SECRET_KEY=<random-256-bit-hex>
REDIS_URL=redis://localhost:6379/0

# AWS
AWS_DEFAULT_REGION=us-east-1
AWS_ACCOUNT_ID=<your-12-digit-account-id>
ARTIFACTS_BUCKET=capsule-artifacts-<YOUR_ACCOUNT_ID>

# Platform domain — CHANGE THIS to your domain
CAPSULE_APPS_DOMAIN=apps.yourdomain.com
CAPSULE_STATIC_BUCKET=capsule-static-<YOUR_ACCOUNT_ID>

# Infrastructure
ALB_DNS_NAME=<your-alb>.us-east-1.elb.amazonaws.com
DB_SUBNET_GROUP=capsule          # only if using RDS
RDS_SECURITY_GROUP_ID=sg-xxx     # only if using RDS

# Optional
CAPSULE_PORT=8080
CAPSULE_ENV=production
CAPSULE_LOG_LEVEL=info
CORS_ALLOWED_ORIGINS=https://app.yourdomain.com
```

> **No AWS keys needed** — the backend uses the EC2 instance role automatically.
> Never set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in production.

### CLI (`~/.capsule/config.yaml` or env)

```yaml
api_url: https://api.yourdomain.com
```

Or set `CAPSULE_API_URL=https://api.yourdomain.com` before running CLI commands.

---

## 5. Custom Domains for Projects

Every project gets a default URL at deployment:
```
https://{project-slug}.apps.yourdomain.com
```

To map your own domain (e.g. `myapp.com`) to a project:

### Step 1 — Add CNAME in your DNS provider
```
CNAME  myapp.com  →  {project-slug}.apps.yourdomain.com
```

### Step 2 — Register the domain in Capsule
```bash
capsule domains add \
  --org <org-id> \
  --project <project-id> \
  --domain myapp.com
```

### Step 3 — Verify ownership
```bash
# Get the TXT record value
capsule domains list --org <org-id> --project <project-id>

# Add the TXT record to your DNS, then verify:
capsule domains verify \
  --org <org-id> \
  --project <project-id> \
  --domain-id <domain-id>
```

Once verified, `myapp.com` routes to your project through Capsule's proxy.

---

## 6. Deploy Types & Default URLs

| Deploy Type | Default URL | How it works |
|---|---|---|
| **Docker** | `{slug}.apps.yourdomain.com` | Container runs on EC2, proxied via ALB → backend |
| **Lambda** | `{slug}.apps.yourdomain.com` | Lambda Function URL proxied through backend |
| **Static** | `{slug}.apps.yourdomain.com` | Files on S3, served via backend redirect |

All three types support custom domains via `capsule domains`.

---

## 7. Workers & Cron Jobs

Workers and cron jobs run as Docker containers sharing the project's image.

```bash
# Create a background worker (runs continuously)
capsule workers create \
  --org <org-id> \
  --project <project-id> \
  --name "queue-processor" \
  --command "node worker.js"

# Start/stop
capsule workers start --org <org-id> --project <project-id> <worker-id>
capsule workers stop  --org <org-id> --project <project-id> <worker-id>

# Create a cron job (standard cron syntax)
capsule crons create \
  --org <org-id> \
  --project <project-id> \
  --name "nightly-cleanup" \
  --schedule "0 2 * * *" \
  --command "node scripts/cleanup.js" \
  --timezone "America/New_York"

# Trigger immediately
capsule crons trigger --org <org-id> --project <project-id> <cron-id>
```

---

## 8. Docker Compose (Production)

```bash
# On your EC2 instance
git pull origin main
docker build -t capsule-backend:latest ./backend
docker compose -f docker-compose.prod.yml up -d
```

The `docker-compose.prod.yml` starts:
- `capsule-backend` — Go API server on port 8080
- `capsule-frontend` — Next.js dashboard on port 3000
- `redis` — Cache and session store

---

## 9. Verifying the Setup

```bash
# Health check
curl https://api.yourdomain.com/health

# Should return: {"status":"ok","version":"..."}

# Test deploy
cd my-app
capsule deploy
# → interactive setup → deploys → shows URL
```

---

## 10. Troubleshooting

### `dial tcp: lookup capsule-app-... no such host`
The container network isn't connected. Ensure the backend container and deployed app containers share the same Docker network (`capsule-prod_capsule-net`).

### Lambda returns 403
Check that:
1. `capsule-lambda-role` trust policy includes `lambda.amazonaws.com`
2. No account-level SCP blocks `lambda:InvokeFunctionUrl`
3. Run: `aws lambda get-policy --function-name capsule-{shortID}` to verify the resource policy exists

### Static site shows wrong content / 404
Verify the static bucket has website hosting enabled and the bucket policy allows public reads. Check that `CAPSULE_STATIC_BUCKET` matches the actual bucket name.

### DNS not resolving
- `*.apps.yourdomain.com` CNAME must point to the ALB, not to the EC2 IP
- ACM cert must be in `us-east-1` (even if ALB is in another region for some setups)
- Cert must cover `*.apps.yourdomain.com`

---

## 11. Despliegues y salud

Aplica a apps **docker en el host** (el camino de ECS Fargate ya tiene el chequeo de salud del ALB y no se toca; Lambda y estáticos no aplican).

### Chequeo de salud y despliegue azul-verde

Ajustes por proyecto (`PATCH /orgs/{o}/projects/{p}`, necesita rol con operaciones de proyecto; un token `deploy` NO puede cambiarlos):

| Campo | Defecto | Validación |
|---|---|---|
| `health_path` | `""` (HTTP desactivado) | empieza por `/`, sin esquema ni host, sin espacios ni `#`, máx. 200 |
| `health_timeout_seconds` | `60` | 5..600 |
| `health_interval_seconds` | `3` | 1..30 y no mayor que el timeout |
| `health_expected_status` | `200-399` | `200`, `200-399` o lista `200,204,301-302` |

`GET /orgs/{o}/projects/{p}` y el `PATCH` devuelven esos campos.

Flujo de un deploy:

1. Se construye la imagen (ver límites más abajo).
2. El contenedor **nuevo** arranca con nombre temporal `capsule-app-<id>-next` y puerto de host propio (el que el viejo no usa: `base`, `base+10000` o `base+20000`).
3. Se verifica: con `health_path`, `GET` a `http://capsule-app-<id>-next:<puerto>/<path>` cada `health_interval_seconds` hasta recibir un estado esperado o agotar `health_timeout_seconds` (no sigue redirecciones: un 302 cuenta como vivo con el defecto `200-399`). Sin `health_path`, el contenedor debe seguir vivo `CAPSULE_DEPLOY_MIN_UPTIME_SECONDS` (5). En ambos casos un contenedor que sale, está `restarting` o tiene `RestartCount>0` (crash loop, p. ej. `Cannot find module`) falla de inmediato.
4. Si pasa: se elimina el contenedor viejo y el nuevo se renombra a `capsule-app-<id>`. El proxy resuelve por nombre, así que el cambio de tráfico ocurre ahí. El hueco es el tiempo entre `docker rm` y `docker rename` (milisegundos, no cero literal).
5. Si falla: se retira el nuevo, **el viejo sigue sirviendo sin interrupción**, el deployment queda `failed` con el motivo en `error_message` (incluye las últimas líneas de log, sin secretos) y los últimos 50 logs del contenedor fallido quedan en los logs del deployment. Los secretos se ocultan por valor (variables del proyecto) y por patrón (`PASSWORD=`, `TOKEN=`, `API_KEY=`, `scheme://user:pass@`, etc.).

Excepción: si el proyecto publica **puertos extra** (puertos fijos de host), el viejo y el nuevo no pueden convivir; el viejo se retira antes de arrancar el nuevo y, si el nuevo falla, no hay a qué volver (se avisa en el log).

JSON en `GET .../deployments/{id}` y en la lista (se omite si nunca hubo chequeo):

```json
"health": {"status":"healthy","path":"/healthz","last_check":"2026-11-02T10:00:00Z","detail":"HTTP 200"},
"error_message": "health check GET /healthz did not succeed within 60s (last: HTTP 500). Last logs: ... . The previous deployment keeps serving traffic (automatic rollback)."
```

`status` es `unknown`, `checking`, `healthy` o `unhealthy`; `path` y `detail` se omiten si están vacíos. ECS: el estado de salud del ALB no se refleja en este objeto (no se hizo).

### Rollback

* Automático: lo anterior (el deployment que no pasa salud no reemplaza al vigente).
* Manual: `POST /orgs/{o}/projects/{p}/deployments/{id}/rollback` (permiso `project.deploy`, permitido a tokens `deploy`) crea un deployment nuevo (`trigger: "rollback"`, `meta.rollback_to`) con el código de `{id}`, que debe estar en `success` y tener fuente guardada. Responde `202` con el deployment. **Reconstruye** la imagen desde la fuente (no es un cambio instantáneo de imagen) y pasa por el mismo chequeo de salud. `capsule deployments rollback` del CLI crea un deployment con la misma fuente a través de `POST .../deployments` y también funciona con un token `deploy`.

### Límites de recursos de los builds

Los builds corren con `docker build` en el mismo servidor. Variables (todas opcionales):

| Variable | Defecto | Efecto |
|---|---|---|
| `CAPSULE_BUILD_MEMORY` | vacío | p. ej. `1500m` |
| `CAPSULE_BUILD_MEMORY_SWAP` | = memoria (sin swap) | |
| `CAPSULE_BUILD_CPUS` | vacío | p. ej. `1.5` (cuota de CPU) |
| `CAPSULE_BUILD_TIMEOUT_MINUTES` | 30 | cancela el build |
| `CAPSULE_BUILD_MAX_CONCURRENT` | 1 | compuerta de builds simultáneos |
| `CAPSULE_BUILD_BUILDER` | vacío | builder `buildx` (driver docker-container creado con `--driver-opt memory=...`) para todos los builds |

Estrategia y qué queda garantizado:

* **Dockerfile sin sintaxis BuildKit** y límites configurados: builder clásico (`DOCKER_BUILDKIT=0`) con `--memory`, `--memory-swap`, `--cpu-period/--cpu-quota`. Docker aplica esos límites al contenedor de **cada paso `RUN`**: un paso que se pasa del límite muere por OOM (exit 137), el build falla con un mensaje claro y los demás contenedores no se ven afectados.
* **Dockerfile con sintaxis BuildKit** (`# syntax=`, `RUN --mount`, `COPY --link`, heredocs, `BUILDPLATFORM`/`TARGETARCH`...) sin `CAPSULE_BUILD_BUILDER`: BuildKit dentro de dockerd **ignora** `--memory`/`--cpu`; **no hay límite de memoria**, solo timeout y compuerta, y el log del build lo advierte.
* Con `CAPSULE_BUILD_BUILDER` el límite es el del contenedor de ese builder (todo el daemon BuildKit); Capsule no crea ese builder.
* Siempre se aplican el timeout y la compuerta de concurrencia. El worker procesa un deployment a la vez; `CAPSULE_BUILD_MAX_CONCURRENT>1` solo importa si hay builds de otras rutas en paralelo.
* **No está garantizado:** la memoria de dockerd (transferencia de contexto, commit/descompresión de capas), del cliente docker y de la caché de página queda fuera del límite del paso `RUN`; el límite tampoco evita llenar el disco. El builder clásico está deprecado en Docker recientes. Nada de esto se verificó contra un Docker real.
* Los builds de Fargate/Lambda en el host usan la misma estrategia (el clásico solo si la plataforma pedida coincide con el host).

### Limpieza programada y alerta de disco

Cada `CAPSULE_CLEANUP_INTERVAL_HOURS` (6; 0 la desactiva; primera pasada 2 min después de arrancar) se ejecuta: `docker image prune -f` (huérfanas sin etiqueta), `docker builder prune -f --filter until=<CAPSULE_CLEANUP_CACHE_MAX_AGE_HOURS=168>h --keep-storage <CAPSULE_CLEANUP_KEEP_STORAGE=4GB>` y borrado (`docker rmi`, sin `-f`) de imágenes `capsule-app-*` que **no** usa ningún contenedor (ni detenido) y cuyo proyecto no tiene un deployment exitoso (la imagen del último exitoso de cada proyecto existente se conserva); de las copias locales de ECR solo se conserva la más reciente por repositorio. Si hay un deployment en `building`/`deploying` se omite el borrado de imágenes. Con uso de disco >= 80% se registra `DISK ALERT` en los logs; con >= `CAPSULE_DISK_MAX_PERCENT` (85) la caché se recorta a 1 GB. `CAPSULE_DISK_PATH` (defecto `/`) es el sistema de archivos que mide `df`; dentro del contenedor del backend `/` suele reflejar el disco del host por overlay, pero conviene comprobarlo.


## 11. Backups

Capsule backs up **data**, not everything deployed: database dumps, project data volumes, and small
manifests that describe how to re-create the containers. Images, layers and build cache are never
backed up (they are rebuilt from the source archive referenced in the manifest). There are no disk
snapshots by default.

### What is stored

Every object is encrypted client-side (AES-256-GCM, a random data key per backup, wrapped with a key derived
from `CAPSULE_SECRET_KEY` and stored in the object metadata) on top of the bucket's SSE. Losing
`CAPSULE_SECRET_KEY` makes the backups unreadable: keep a copy of it outside the server.

| Prefix / key | Content |
| --- | --- |
| `projects/<projectID>/database/<RFC3339>-<runID>.<dbid8>.<ext>.enc` | one dump per project database container: postgres `pg_dump --format=custom` (`pgdump`), mysql/mariadb `mysqldump --single-transaction` (`sql`), mongodb `mongodump --archive --gzip` (`archive.gz`), redis RDB (`rdb`). Streamed with `docker exec` to S3 multipart; the dump never touches the host disk |
| `projects/<projectID>/volume/<RFC3339>-<runID>.tar.gz.enc` | the project data volume (`capsule-data-<projectID>`, mounted at `/data`) as tar.gz from an ephemeral helper container with the volume read-only |
| `projects/<projectID>/manifest/<RFC3339>-<runID>.json.enc` | the project manifest (format: `docs/BACKUPS_MANIFEST.md`) |
| `projects/<projectID>/objects/<RFC3339>-<runID>.tar.gz.enc` | the project's object-store buckets (`docs/OBJECT_STORAGE.md`) as tar.gz, written in-process (no helper container); included with `--volumes`; snapshot kind `objects` |
| `platform/<RFC3339>-<runID>.files.tar.gz.enc` | compose file(s), `.env` and `certs/` of the install dir, and Docker `daemon.json` |
| `platform/<RFC3339>-<runID>.inventory.json.enc` | `docker volume ls`, `docker ps -a`, and a summarized `docker inspect` of every container (env var names only) |

Engines other than postgres, mysql, mariadb, mongodb and redis (cassandra, clickhouse, elasticsearch,
cockroachdb, ...) are reported as "not supported" in the run result; RDS-managed databases are skipped
(use RDS snapshots). Restoring a Redis backup through Capsule is not supported (download the `.rdb` and load it
yourself). Restoring a volume stops the project containers, swaps the data and starts them again, rolling
the previous data back if the swap fails.

SQLite files (`*.db`, `*.sqlite`, `*.sqlite3`) inside a volume are copied with `sqlite3 .backup` when the helper
image has `sqlite3`; otherwise they are copied as they are (a hot copy). The helper image must provide GNU `tar`
and `gzip`; the default `debian:bookworm-slim` does, but not `sqlite3`. For consistent SQLite copies build one:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 && rm -rf /var/lib/apt/lists/*
```

and set `CAPSULE_BACKUPS_HELPER_IMAGE` to it.

### Platform backup: how the host files are read

The backend runs in a container, so it cannot read `/opt/capsule` directly. Capsule starts a throw-away helper
container (`--network none --read-only`, no Docker socket) that mounts **only** `CAPSULE_BACKUPS_PLATFORM_DIR`
(default `/opt/capsule`) and `CAPSULE_BACKUPS_DOCKER_CONFIG_DIR` (default `/etc/docker`) **read-only**, and streams
a tar of the few files listed above to the backend, which encrypts it before it leaves the process. The `.env`
is therefore never written anywhere unencrypted. This was chosen over bind-mounting the host paths into the
backend because the backend would otherwise hold the platform secrets mounted for its whole life. The
paths are host paths (the Docker daemon resolves them), so they must match where the install lives.

### Installation

1. **Terraform** (`deploy/terraform/backups.tf`): `backups_enabled = true` (default) creates the bucket
   `capsule-backups-<account>` with versioning, SSE and a lifecycle, and lets the API user put/get/list and
   delete **only under `projects/*`**. `backup_s3_retention_days` (default 30) is the bucket hard expiration
   and the upper bound for a project `retention_days`. `backups_enabled = false` creates nothing.
   `backup_ebs_enabled` (default false) adds optional whole-host EBS snapshots; it is not needed for recovery.
2. **Environment** (backend service, already wired in `docker-compose.prod.yml`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CAPSULE_BACKUPS_BUCKET` | none | bucket name (`terraform output backups_bucket`) |
| `CAPSULE_BACKUPS_ENABLED` | true only if the bucket is set | platform switch. `false` disables the API writes (409 `BACKUPS_DISABLED`) and the scheduler |
| `CAPSULE_BACKUPS_DEFAULT_SCHEDULE` | `daily` | `hourly`, `6h`, `12h`, `daily` or `weekly`; also the platform backup schedule |
| `CAPSULE_BACKUPS_DEFAULT_ON` | `true` | projects with databases and no explicit setting are backed up (databases only) on the default schedule |
| `CAPSULE_BACKUPS_DEFAULT_RETENTION_DAYS` | `14` | retention for projects without an explicit setting |
| `CAPSULE_BACKUPS_BUCKET_RETENTION_DAYS` | `30` | must equal Terraform `backup_s3_retention_days`; maximum `retention_days` |
| `CAPSULE_BACKUPS_HELPER_IMAGE` | `debian:bookworm-slim` | helper for volumes and platform files |
| `CAPSULE_BACKUPS_PLATFORM_DIR` | `/opt/capsule` | host dir with compose, `.env`, `certs/` |
| `CAPSULE_BACKUPS_DOCKER_CONFIG_DIR` | `/etc/docker` | host dir with `daemon.json` |

   The backend also needs `CAPSULE_SECRET_KEY` and AWS credentials with the policy above.
3. Apply Terraform, set the variables, redeploy the backend. `GET /api/v1/platform/capabilities` then reports
   `"backups": {"enabled": true, "default_schedule": "daily"}`.

To opt out of everything: `backups_enabled = false` in Terraform and leave `CAPSULE_BACKUPS_BUCKET` unset (or set
`CAPSULE_BACKUPS_ENABLED=false`).

### Operations

- Per project (`ProjectRead` to see, `ProjectOps` to configure/run/verify, `ProjectDatabases` to restore):
  `GET|PUT /orgs/{o}/projects/{p}/backups`, `POST .../backups/run`, `GET .../backups/snapshots`,
  `POST .../backups/restore {"snapshot_id","target"}` (`target` restores a database dump into a new database),
  `POST .../backups/verify`.
- Platform (platform admins): `GET /platform/backups`, `POST /platform/backups/run`, `POST /platform/backups/verify`.
- `verify` downloads the latest backup of every source, decrypts it, checks its stored SHA-256 and, for Postgres,
  runs `pg_restore --list` on the dump, without touching any data. The result appears in the run history.
- One job runs per project at a time and one job at a time per backend (global cap 1); a failed run is retried
  once. Runs left "running" by a crash or restart are marked failed on startup. The scheduler holds a Postgres
  advisory lock so only one backend instance schedules.
- Retention deletes a project objects older than its `retention_days`; platform objects expire with the bucket
  lifecycle (the API user cannot delete under `platform/`).
- Limits: a single object up to about 80 GB (8 MiB parts, 10 000 parts); a run times out after 4 hours; helper
  containers run with 512 MiB of memory and 1 CPU.
