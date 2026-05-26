# Capsule — Feature Specification

## 1. Deployments

### 1.1 Normal Deploy (Container)
**How it works:**
1. User pushes code or clicks "Deploy" in dashboard / runs `capsule deploy`
2. Backend creates Deployment record (status: queued)
3. Builder EC2 receives job via SQS:
   - `git clone` repo (or download uploaded tarball)
   - `docker build -t {ecr_registry}/{project_slug}:{sha} .`
   - `docker push` to ECR
   - Notifies backend: image ready
4. App server pulls image from ECR, stops old container, starts new one
5. ALB health check passes → traffic routed
6. Deployment status → success/failed

**Config per project:**
- replicas: 1–N (auto scaling)
- container_port: 8080 default
- memory/cpu: 256MB / 0.25 vCPU default
- health_check_path: `/health`
- env vars injected at runtime

**Cost preview shown before first deploy:**
```
EC2 t3.small (1 replica):  ~$15/month
ECR storage (1 GB):         ~$0.10/month
ALB:                        ~$22/month (shared)
Data transfer:              ~$0.09/GB
────────────────────────────────────────
Estimated total:            ~$37/month
```

### 1.2 Serverless Deploy (Lambda)
**How it works:**
1. User sets `serverless: true` on project
2. Build step same as above (Docker image OR zip package)
3. Instead of ECS/EC2: deploys to AWS Lambda
   - Lambda function URL exposed (or API Gateway)
   - Cold start: ~200ms, warm: <10ms
4. Scale: 0 → 10,000 concurrent automatically
5. Billing: per-request ($0.0000002/request)

**Supported runtimes for serverless:**
- Node.js (via Lambda runtime)
- Python (via Lambda runtime)
- Go (via Lambda custom runtime or provided.al2)
- Any (via container image Lambda)

**Cost preview:**
```
Lambda (1M requests/month): ~$0.20
API Gateway (1M calls):     ~$3.50
CloudWatch Logs:            ~$0.50
────────────────────────────────────
Estimated total:            ~$4.20/month
(vs $37/month for container)
```

**CLI:**
```bash
capsule deploy --serverless          # deploy as Lambda
capsule deploy --serverless --fn-url # expose with Lambda URL (no API GW cost)
capsule projects create --serverless
```

---

## 2. Logs

### 2.1 Build Logs
- Streamed in real-time during build via Server-Sent Events (SSE)
- Stored in `build_logs` table (already exists)
- API: `GET /api/v1/orgs/{org}/projects/{proj}/deployments/{id}/logs`
- CLI: `capsule logs --build --deployment {id}`
- Frontend: scrollable log viewer, auto-scroll, color coded (INFO=white, ERROR=red, WARN=yellow)

### 2.2 Runtime Logs
- Application logs streamed from CloudWatch Logs
- Log group: `/capsule/{project_slug}`
- API: `GET /api/v1/orgs/{org}/projects/{proj}/logs?tail=100&since=1h`
- Real-time: SSE stream endpoint `/api/v1/orgs/{org}/projects/{proj}/logs/stream`
- CLI: `capsule logs {project}` → tails in terminal, colors, timestamps
- Frontend: log viewer with filter (level, search, time range)

---

## 3. Cloud Build

### 3.1 AWS CodeBuild
- No local Docker required
- Source: GitHub/GitLab webhook OR `capsule deploy --source .` (uploads tarball)
- Build spec auto-generated based on runtime detection:
  - Go → `go build -o app .`
  - Node → `npm ci && npm run build`
  - Python → `pip install -r requirements.txt`
  - Dockerfile → `docker build`
- Compute: BUILD_GENERAL1_SMALL (3 GB RAM, 2 vCPU, ~$0.005/min)
- Build time estimate shown in UI

**Cost preview:**
```
CodeBuild (100 builds/month × 5min avg):
  100 × 5min × $0.005/min = $2.50/month
```

### 3.2 GitHub Integration (future)
- Webhook: auto-deploy on push to main
- Preview deployments on PRs
- Status checks on commits

---

## 4. Databases

### 4.1 PostgreSQL (RDS)
- Engine: PostgreSQL 15.x
- Instance class: db.t3.micro (free tier) → db.t3.small → db.r6g.large
- Storage: 20GB gp3 default, auto-scaling to 1TB
- Multi-AZ: toggle (2× cost, high availability)
- Automated backups: 7 days retention default
- Connection string shown after provisioning (~8 minutes)
- Encryption at rest: AES-256

**Cost preview:**
```
db.t3.micro (Single-AZ):   ~$15/month
Storage 20GB gp3:          ~$2.30/month
Backup storage 20GB:       ~$0.095/month
────────────────────────────────────────
Estimated total:           ~$17.40/month

db.t3.micro (Multi-AZ):    ~$30/month
```

**CLI:**
```bash
capsule db create --name mydb --engine postgres --project my-api
capsule db list --project my-api
capsule db connect mydb  # opens psql session
```

### 4.2 Redis (ElastiCache)
- Engine: Redis 7.x
- Node type: cache.t3.micro → cache.r7g.large
- Cluster mode: off (single node) or on (sharding)
- Persistence: AOF optional
- TLS in-transit

**Cost preview:**
```
cache.t3.micro (single):   ~$13/month
cache.t3.small:            ~$27/month
```

**CLI:**
```bash
capsule db create --name mycache --engine redis --project my-api
capsule db connect mycache  # opens redis-cli session
```

### 4.3 MongoDB (DocumentDB)
- AWS DocumentDB 5.0 (MongoDB 5.0 compatible)
- Or external MongoDB Atlas (user provides connection string)
- Instance: db.t3.medium minimum (DocumentDB requirement)
- TLS required

**Cost preview:**
```
db.t3.medium DocumentDB:   ~$60/month
(MongoDB Atlas M10 free tier alternative: $0)
```

### 4.4 S3 Buckets
- Creates a dedicated S3 bucket per request: `capsule-{org_slug}-{name}`
- Configurable: public/private, versioning, CORS, lifecycle rules
- Pre-signed URL generation API for uploads
- Access credentials injected as env vars: `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- Optional: CloudFront CDN in front of bucket

**Cost preview:**
```
S3 storage (10 GB):        ~$0.23/month
Requests (100K GET):       ~$0.04/month
CloudFront (10 GB/month):  ~$0.85/month
```

**CLI:**
```bash
capsule storage create --name assets --project my-app
capsule storage list --project my-app
capsule storage presign s3://capsule-myorg-assets/file.pdf --expires 3600
```

**API routes:**
```
POST   /api/v1/orgs/{org}/projects/{proj}/storage        # create bucket
GET    /api/v1/orgs/{org}/projects/{proj}/storage        # list buckets
GET    /api/v1/orgs/{org}/projects/{proj}/storage/{id}   # get + credentials
DELETE /api/v1/orgs/{org}/projects/{proj}/storage/{id}   # delete
POST   /api/v1/orgs/{org}/projects/{proj}/storage/{id}/presign # presigned URL
```

---

## 5. Domains

### 5.1 Custom Domain Flow
1. User adds domain in UI/CLI
2. Capsule shows: "Add CNAME `app.example.com` → `capsule-alb-xxx.us-east-1.elb.amazonaws.com`"
3. User updates DNS at their registrar
4. User clicks "Verify" → Capsule does DNS lookup
5. If verified: requests ACM certificate (auto-renewed), attaches to ALB listener
6. SSL active: traffic served over HTTPS

### 5.2 Route53 Managed Domains
- If user's domain is in Route53: Capsule creates CNAME automatically
- User just clicks "Add domain" → done in <60 seconds

**CLI:**
```bash
capsule domains add app.example.com --project my-app
capsule domains verify app.example.com
capsule domains list --project my-app
```

---

## 6. AI — Bedrock Integration

### 6.1 API Keys (Bedrock Proxy)
- Users generate Capsule AI keys from settings
- Key format: `csk_live_...` (32 chars)
- Keys stored hashed in `api_tokens` table
- Backend proxies requests to Bedrock on user's behalf
- Rate limits per key: 100 req/min default

**Models available:**
- `claude-sonnet-4` (best quality)
- `claude-haiku-4.5` (fastest, cheapest)
- `claude-opus-4` (most capable)

**Usage API (OpenAI-compatible):**
```
POST /api/v1/ai/chat
Authorization: Bearer csk_live_...
{
  "model": "claude-haiku-4.5",
  "messages": [{"role": "user", "content": "..."}]
}
```

### 6.2 AI Features built-in to Capsule
- **Explain build failure**: button on failed deployment → AI reads logs → natural language explanation + fix suggestion
- **Generate Dockerfile**: `capsule ai dockerfile --runtime node` → generates optimized Dockerfile
- **Cost optimizer**: `capsule ai optimize-costs --project my-app` → suggests cheaper configurations
- **`capsule ai` CLI command**: interactive chat about your infrastructure

**Cost per request:**
```
Claude Haiku 4.5:   ~$0.00025/1K input tokens
Claude Sonnet 4:    ~$0.003/1K input tokens
```

---

## 7. Email (AWS SES)

### 7.1 Capsule Platform Emails
Capsule itself uses SES to send:
- Welcome email on register
- Deployment success/failure notifications
- Database provisioned notification
- Team invite emails
- Billing alerts

**Configuration:**
- From: `noreply@capsule.arubik.dev` (or configured domain)
- Templates: HTML + text fallback, stored in SES templates
- Go service: `pkg/mailer/mailer.go` using AWS SES SDK

### 7.2 User Project Email Access
- Users can enable SES for their projects
- Capsule provisions SMTP credentials (SES SMTP endpoint)
- Verified sending domain: user's custom domain
- Credentials injected as env vars:
  ```
  SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
  SES_SMTP_PORT=587
  SES_SMTP_USER=AKIAXXXXXXXX
  SES_SMTP_PASS=...
  SES_FROM_EMAIL=hello@example.com
  ```

**API routes:**
```
POST /api/v1/orgs/{org}/projects/{proj}/email/setup      # enable SES
GET  /api/v1/orgs/{org}/projects/{proj}/email/status     # verification status
POST /api/v1/orgs/{org}/projects/{proj}/email/test       # send test email
GET  /api/v1/orgs/{org}/projects/{proj}/email/stats      # send/bounce/complaint stats
```

**CLI:**
```bash
capsule email setup --project my-app --domain example.com
capsule email test --project my-app --to test@example.com
capsule email stats --project my-app
```

**Cost preview:**
```
SES (10,000 emails/month): ~$1.00
SES (100,000 emails/month): ~$10.00
(First 62,000/month free if sent from EC2)
```

---

## 8. Auto Scaling

### 8.1 Per-Project Scaling
- Min replicas: 0 (serverless) or 1 (container)
- Max replicas: configurable (default 10)
- Scale trigger: CPU > 70% or memory > 80% or custom CloudWatch metric
- Scale-in cooldown: 5 minutes
- Scale-out: immediate (2 minutes to healthy)

### 8.2 Global / Multi-Region (Phase 2)
- Regions: us-east-1 (primary), eu-west-1, ap-southeast-1
- Route53 latency-based routing → nearest region
- DynamoDB Global Tables for session data
- ECR replication cross-region
- One-click: "Deploy globally" button

**Cost preview per additional region:**
```
ALB per region:    ~$22/month
EC2 t3.small:      ~$15/month
ECR replication:   ~$0.10/GB
────────────────────────────
Per region add:    ~$37/month
3 regions total:   ~$111/month
```

---

## 9. Cost Preview System

Every resource creation shows estimated costs BEFORE confirming:

```
┌─ Cost Estimate ──────────────────────────────┐
│ PostgreSQL db.t3.micro (Single-AZ)           │
│                                              │
│  Compute:      $15.33/month                  │
│  Storage 20GB: $2.30/month                   │
│  Backups 7d:   $0.46/month                   │
│  ─────────────────────────────               │
│  Total:        ~$18.09/month                 │
│  Annual:       ~$217/year                    │
│                                              │
│  [Cancel]                [Provision →]       │
└──────────────────────────────────────────────┘
```

**Backend pricing table** (`internal/pricing/pricing.go`):
- Hardcoded AWS on-demand prices for us-east-1 (updated quarterly)
- `EstimateRDS(engine, instanceClass, storageGB, multiAZ bool) CostEstimate`
- `EstimateEC2(instanceType string, count int) CostEstimate`
- `EstimateS3(storageGB, requestsK int) CostEstimate`
- `EstimateLambda(requestsM int, avgDurationMs int) CostEstimate`

**API route:**
```
POST /api/v1/pricing/estimate
Body: { resource_type, config }
Returns: { monthly_usd, annual_usd, breakdown: [] }
```

---

## 10. CLI Full Capabilities

```bash
# Auth
capsule login
capsule logout
capsule whoami

# Orgs
capsule orgs list
capsule orgs create --name "Acme" --slug acme

# Projects
capsule projects list --org {id}
capsule projects create --name api --slug api --runtime go --org {id}
capsule projects delete {slug}

# Deploy
capsule deploy                          # deploy current dir
capsule deploy --serverless             # deploy as Lambda
capsule deploy --build-only             # build image, don't deploy
capsule deploy --watch                  # stream build + deploy logs

# Logs
capsule logs {project}                  # runtime logs (tail)
capsule logs {project} --build {dep-id} # build logs
capsule logs {project} --since 1h
capsule logs {project} --grep ERROR

# Env vars
capsule env set DATABASE_URL postgres://...
capsule env get DATABASE_URL
capsule env list
capsule env delete KEY

# Databases
capsule db create --engine postgres --name mydb
capsule db create --engine redis --name cache
capsule db create --engine mongodb --name docs
capsule db create --engine s3 --name assets
capsule db list
capsule db connect {name}               # interactive session
capsule db delete {name}

# Domains
capsule domains add example.com
capsule domains verify example.com
capsule domains list
capsule domains delete example.com

# Email
capsule email setup --domain example.com
capsule email test --to me@example.com
capsule email stats

# AI
capsule ai "why did my last deploy fail?"
capsule ai dockerfile --runtime node
capsule ai optimize-costs
capsule ai keys create --name "prod-key"
capsule ai keys list
capsule ai keys revoke {key-id}

# Scaling
capsule scale {project} --replicas 3
capsule scale {project} --min 1 --max 10 --cpu-threshold 70

# Pricing
capsule pricing estimate --resource rds --class db.t3.micro
capsule pricing estimate --resource ec2 --type t3.small --count 2
```
