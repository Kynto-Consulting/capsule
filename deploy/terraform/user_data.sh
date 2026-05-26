#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/capsule-init.log | logger -t capsule-init) 2>&1

# Disable firewalld FIRST so SSH is reachable immediately
systemctl disable --now firewalld || true

# ── System setup ──────────────────────────────────────────────
dnf update -y
dnf install -y docker git aws-cli

systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install docker compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# ── Capsule deployment ────────────────────────────────────────
DEPLOY_DIR=/opt/capsule
mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# Clone repo
git clone https://github.com/Kynto-Consulting/capsule.git .

# Pull .env from S3 (instance role has S3 access)
aws s3 cp s3://capsule-artifacts-348973061281/config/.env .env --region us-east-1

# Auth ECR using instance role (no hardcoded credentials needed)
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin 348973061281.dkr.ecr.us-east-1.amazonaws.com

# Build the frontend locally so the browser bundle picks up production URLs
docker compose -f docker-compose.prod.yml build frontend

# Pull images and start
docker compose -f docker-compose.prod.yml pull backend redis
docker compose -f docker-compose.prod.yml up -d

echo "Capsule deployed successfully at $(date)"
