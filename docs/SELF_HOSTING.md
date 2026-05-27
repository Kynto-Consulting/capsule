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
