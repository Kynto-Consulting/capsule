#!/bin/bash
set -euo pipefail

dnf update -y
dnf install -y docker git aws-cli

systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Install docker buildx plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL https://github.com/docker/buildx/releases/latest/download/buildx-linux-amd64 \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

# Verify installations
docker --version
docker buildx version
aws --version
git --version
