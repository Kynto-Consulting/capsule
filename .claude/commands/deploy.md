# Deploy Commands — Capsule

## Overview

Instructions for deploying Capsule to an AWS EC2 instance. Capsule runs as Docker containers behind a Traefik reverse proxy with TLS termination.

---

## Prerequisites

| Requirement          | Details                                    |
|----------------------|--------------------------------------------|
| AWS CLI              | Configured with appropriate IAM credentials|
| SSH key              | Access to the target EC2 instance          |
| Docker & Compose     | Installed on the EC2 instance              |
| Domain               | DNS pointing to the EC2 public IP          |
| GitHub PAT           | For pulling images from GHCR               |

---

## Deployment Architecture

```
                    ┌──────────────────────────────────────────┐
                    │            EC2 Instance                   │
Internet ──► :443 ──┤  Traefik (TLS)                           │
                    │    ├── /api/*  → capsule-server:8080     │
                    │    └── /*      → capsule-frontend:3000   │
                    │                                          │
                    │  PostgreSQL :5432                         │
                    │  Redis      :6379                         │
                    └──────────────────────────────────────────┘
```

---

## Step 1: Prepare the EC2 Instance

```bash
# SSH into the instance
ssh -i ~/.ssh/capsule-key.pem ubuntu@<EC2_PUBLIC_IP>

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu

# Install Docker Compose plugin
sudo apt-get update
sudo apt-get install docker-compose-plugin -y

# Create application directory
sudo mkdir -p /opt/capsule
sudo chown ubuntu:ubuntu /opt/capsule
```

---

## Step 2: Configure Environment

```bash
# On the EC2 instance
cat > /opt/capsule/.env << 'EOF'
# Application
CAPSULE_ENV=production
CAPSULE_LOG_LEVEL=info
CAPSULE_SECRET_KEY=<generate-with-openssl-rand-hex-32>

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=capsule
POSTGRES_USER=capsule
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://capsule:<password>@postgres:5432/capsule?sslmode=disable

# Redis
REDIS_URL=redis://redis:6379/0

# Domain & TLS
DOMAIN=capsule.yourdomain.com
ACME_EMAIL=admin@yourdomain.com

# GHCR Auth
GHCR_TOKEN=<github-pat>
EOF

chmod 600 /opt/capsule/.env
```

---

## Step 3: Pull & Deploy

### Option A: Deploy from GHCR (Recommended)

```bash
# Login to GitHub Container Registry
echo $GHCR_TOKEN | docker login ghcr.io -u USERNAME --password-stdin

# Copy production compose file to server
scp docker-compose.prod.yml ubuntu@<EC2_PUBLIC_IP>:/opt/capsule/docker-compose.yml

# On the EC2 instance
cd /opt/capsule
docker compose pull
docker compose up -d
```

### Option B: Build on the Instance

```bash
# Clone the repo
cd /opt/capsule
git clone https://github.com/Kynto/capsule.git .

# Build and start
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Step 4: Run Database Migrations

```bash
docker compose exec backend ./capsule-server migrate up
```

---

## Step 5: Verify Deployment

```bash
# Check all services are running
docker compose ps

# Check backend health
curl -s https://capsule.yourdomain.com/api/health | jq .

# Check logs
docker compose logs -f --tail=100

# Check individual service
docker compose logs backend
docker compose logs frontend
```

---

## Rolling Update (Zero-Downtime)

```bash
cd /opt/capsule

# Pull latest images
docker compose pull

# Recreate only changed services
docker compose up -d --no-deps --build backend
docker compose up -d --no-deps --build frontend

# Verify health
curl -sf https://capsule.yourdomain.com/api/health
```

---

## Rollback

```bash
# List available image tags
docker images ghcr.io/kynto/capsule-server --format "{{.Tag}}"

# Rollback to a specific version
CAPSULE_VERSION=v0.3.1 docker compose up -d

# Or use a specific image digest
docker compose down
# Edit docker-compose.yml to pin the previous image digest
docker compose up -d
```

---

## Database Backup & Restore

```bash
# Backup
docker compose exec postgres pg_dump -U capsule capsule | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Restore
gunzip -c backup_20260526.sql.gz | docker compose exec -T postgres psql -U capsule capsule
```

---

## Monitoring

```bash
# Resource usage
docker stats

# Disk usage
docker system df

# Clean up unused images
docker image prune -f
```

---

## Troubleshooting

| Issue                          | Command / Solution                                              |
|--------------------------------|-----------------------------------------------------------------|
| Container won't start          | `docker compose logs <service>` — check for config errors       |
| TLS certificate not issued     | Verify DNS records, check Traefik ACME logs                     |
| Database connection refused    | Ensure postgres container is healthy: `docker compose ps`       |
| Out of disk space              | `docker system prune -a` and check `/var/lib/docker`            |
| 502 Bad Gateway                | Backend may be starting — wait 10s, check health endpoint       |
