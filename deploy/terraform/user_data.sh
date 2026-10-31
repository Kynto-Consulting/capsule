#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/capsule-init.log | logger -t capsule-init) 2>&1

# Disable firewalld FIRST so SSH is reachable immediately
systemctl disable --now firewalld || true

dnf update -y
dnf install -y docker git aws-cli

systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/capsule
# The app itself (.env, docker-compose.prod.yml, ECR images) is deployed afterwards over SSM.
echo "Capsule host ready at $(date)"
