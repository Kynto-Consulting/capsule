# Infrastructure Prompt — AWS & DevOps

You are working on the **Capsule infrastructure**, managing AWS resources, Terraform modules, Docker configurations, and deployment pipelines.

---

## Stack

- **AWS** — EC2, RDS (PostgreSQL), ElastiCache (Redis), S3, IAM, VPC, ALB, Route 53, ACM
- **Terraform** 1.7+ with AWS provider
- **Docker** 24+ with multi-stage builds
- **Docker Compose** for local and production orchestration
- **Traefik** as reverse proxy with automatic TLS
- **GitHub Actions** for CI/CD

---

## Directory Structure

```
deploy/
├── terraform/
│   ├── environments/
│   │   ├── dev/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   ├── outputs.tf
│   │   │   └── terraform.tfvars
│   │   ├── staging/
│   │   └── prod/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── ec2/
│   │   ├── rds/
│   │   ├── elasticache/
│   │   ├── s3/
│   │   ├── iam/
│   │   └── security-groups/
│   └── backend.tf           # S3 remote state config
├── docker/
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   └── traefik/
│       ├── traefik.yml
│       └── dynamic/
└── scripts/
    ├── setup-ec2.sh
    ├── backup-db.sh
    └── rotate-secrets.sh
```

---

## IAM Policies

### Principle of Least Privilege

```hcl
# EC2 instance role — only what the application needs
resource "aws_iam_role_policy" "capsule_app" {
  name = "capsule-app-policy"
  role = aws_iam_role.capsule_ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Access"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.capsule.arn,
          "${aws_s3_bucket.capsule.arn}/*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:log-group:/capsule/*"
      }
    ]
  })
}
```

### IAM Rules

1. **Never use root credentials** in applications
2. **Use instance profiles** for EC2, not access keys
3. **Scope resources narrowly** — use ARNs, not wildcards
4. **Separate roles** for different components (app, CI/CD, admin)
5. **Enable MFA** for human users with console access
6. **Rotate secrets** regularly; use AWS Secrets Manager for app secrets

---

## Terraform Patterns

### Module Structure

```hcl
# modules/ec2/main.tf
resource "aws_instance" "capsule" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = var.security_group_ids
  iam_instance_profile   = var.iam_instance_profile
  key_name               = var.key_name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    encrypted             = true
    delete_on_termination = true
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    docker_compose_content = var.docker_compose_content
    env_file_content       = var.env_file_content
  })

  tags = merge(var.tags, {
    Name = "${var.project}-${var.environment}"
  })

  lifecycle {
    create_before_destroy = true
  }
}
```

### Terraform Rules

1. **Remote state** in S3 with DynamoDB locking
2. **Use modules** for reusable infrastructure components
3. **Environment separation** via directory-based workspaces (`dev/`, `staging/`, `prod/`)
4. **Variable validation:**
   ```hcl
   variable "instance_type" {
     type        = string
     description = "EC2 instance type"
     validation {
       condition     = can(regex("^t3\\.|^t3a\\.|^m6i\\.", var.instance_type))
       error_message = "Instance type must be t3, t3a, or m6i family."
     }
   }
   ```
5. **Tag everything** with `Project`, `Environment`, `ManagedBy = "terraform"`
6. **Use `data` sources** to reference existing resources, not hardcoded IDs
7. **Output important values** (IPs, endpoints, ARNs) for downstream use
8. **Never commit `.tfvars` with secrets** — use environment variables or Secrets Manager

---

## Docker Best Practices

### Multi-stage Build (Backend)

```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath -ldflags="-s -w" \
    -o /capsule-server ./cmd/server

# Runtime stage
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /capsule-server /capsule-server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/capsule-server"]
```

### Multi-stage Build (Frontend)

```dockerfile
# Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

# Runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

### Docker Rules

1. **Use multi-stage builds** to minimize image size
2. **Use distroless or Alpine** base images
3. **Run as non-root** user
4. **Pin base image versions** (use digest or specific tags, not `latest`)
5. **Use `.dockerignore`** to exclude unnecessary files
6. **Order layers** by change frequency (deps first, source last)
7. **Health checks** in Compose or Dockerfile:
   ```dockerfile
   HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
     CMD ["/capsule-server", "healthcheck"]
   ```
8. **No secrets in images** — use environment variables or mounted secrets

---

## Security Checklist

- [ ] All data encrypted at rest (EBS, RDS, S3)
- [ ] All data encrypted in transit (TLS everywhere)
- [ ] Security groups follow least-privilege (no 0.0.0.0/0 on SSH)
- [ ] IAM roles scoped to minimum necessary permissions
- [ ] Secrets stored in AWS Secrets Manager, not environment files
- [ ] Database not publicly accessible
- [ ] SSH key rotation plan in place
- [ ] VPC flow logs enabled
- [ ] CloudTrail enabled for audit
- [ ] Container images scanned for vulnerabilities (Trivy)

---

## Monitoring & Observability

1. **CloudWatch** for logs and metrics
2. **Traefik access logs** for HTTP traffic analysis
3. **Docker health checks** for container liveness
4. **PostgreSQL monitoring** via RDS Performance Insights
5. **Application metrics** exposed on `/metrics` (Prometheus format)
6. **Alerting** via CloudWatch Alarms → SNS → email/Slack
