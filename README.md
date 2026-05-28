<div align="center">

```
  ██████╗ █████╗ ██████╗ ███████╗██╗   ██╗██╗     ███████╗
 ██╔════╝██╔══██╗██╔══██╗██╔════╝██║   ██║██║     ██╔════╝
 ██║     ███████║██████╔╝███████╗██║   ██║██║     █████╗
 ██║     ██╔══██║██╔═══╝ ╚════██║██║   ██║██║     ██╔══╝
 ╚██████╗██║  ██║██║     ███████║╚██████╔╝███████╗███████╗
  ╚═════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝ ╚══════╝╚══════╝
```

**Your infrastructure, encapsulated.**

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?logo=go)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Kynto/capsule/actions/workflows/ci.yml/badge.svg)](https://github.com/Kynto/capsule/actions/workflows/ci.yml)

</div>

---

Capsule is a self-hosted cloud infrastructure management platform that lets teams deploy containerized applications, provision managed databases and S3 storage, configure custom domains, set up transactional email, run background workers and cron jobs, and access AI-assisted tooling — all through a unified web dashboard, REST API, and CLI. It runs on AWS and is designed to be deployed on a single EC2 instance with Docker Compose.

---

## Features

- **Deployments** — Build and deploy Docker containers from source archives; stream build logs in real time; cancel or roll back with one command
- **Databases** — Provision and manage AWS RDS instances per project; connection strings delivered securely
- **Storage** — Create and manage S3 buckets per project with pre-signed URL support
- **Custom Domains** — Attach custom domains to projects with CNAME/A-record verification and ALB routing
- **Email** — Configure AWS SES per project, verify domains, view DNS records, send transactional email, and inspect delivery logs
- **Workers** — Long-running background processes managed alongside deployments
- **Cron Jobs** — Scheduled tasks with execution logs and manual trigger support
- **AI Assistance** — Bedrock-backed chat, Dockerfile generation, failure explanation, and cost-optimization suggestions
- **Billing** — AWS spend and credits tracking dashboard
- **Multi-tenant** — Organizations and projects with JWT-authenticated access
- **Reverse Proxy** — Automatic subdomain and custom-domain routing to deployed apps

---

## Architecture

```
Browser / CLI
      │
      ▼
┌─────────────────┐     ┌──────────────────────┐
│  Next.js 14     │────▶│  Go REST API (Chi)   │
│  Dashboard      │     │  :8080               │
└─────────────────┘     └──────────┬───────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               ▼                   ▼                   ▼
        ┌─────────────┐   ┌───────────────┐   ┌────────────────┐
        │ PostgreSQL  │   │   Redis 7     │   │   AWS          │
        │ 16          │   │   (cache /    │   │   EC2, ECR,    │
        └─────────────┘   │    sessions)  │   │   RDS, S3,     │
                          └───────────────┘   │   SES, ALB,    │
                                              │   Bedrock      │
                                              └────────────────┘
```

| Component    | Technology              | Purpose                                      |
|--------------|-------------------------|----------------------------------------------|
| **Backend**  | Go 1.22+, Chi router    | REST API, business logic, AWS orchestration  |
| **Frontend** | Next.js 14, TypeScript  | Web dashboard, real-time log streaming       |
| **CLI**      | Go 1.22+, Cobra/Viper   | Terminal interface, CI/CD automation         |
| **Database** | PostgreSQL 16           | Persistent application state                 |
| **Cache**    | Redis 7                 | Session storage, rate limiting, pub/sub      |
| **Proxy**    | Traefik (dev) / ALB     | TLS termination, request routing             |

---

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Git

### Run locally

```bash
# 1. Clone the repository
git clone https://github.com/Kynto/capsule.git
cd capsule

# 2. Copy and configure environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 3. Start all services
docker compose up -d

# Dashboard: http://localhost:3000
# API:       http://localhost:8080
# Traefik:   http://localhost:8090
```

### Run services individually (for development)

```bash
# Start only the infrastructure dependencies
docker compose up -d postgres redis

# Run the backend
cd backend && go run ./cmd/server

# Run the frontend (in a separate terminal)
cd frontend && pnpm install && pnpm dev

# Build the CLI
cd cli && go build -o ../bin/capsule ./cmd/capsule
```

---

## Environment Variables

All backend configuration is read from environment variables. Copy `backend/.env.example` to `backend/.env` and fill in the required values.

### Required

| Variable              | Description                                    |
|-----------------------|------------------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection URL                      |
| `CAPSULE_SECRET_KEY`  | JWT signing secret (use a long random string)  |

### Optional — Application

| Variable               | Default                      | Description                                          |
|------------------------|------------------------------|------------------------------------------------------|
| `CAPSULE_ENV`          | `development`                | Environment name (`development` or `production`)     |
| `CAPSULE_PORT`         | `8080`                       | Port the API server listens on                       |
| `CAPSULE_LOG_LEVEL`    | `info`                       | Log verbosity (`debug`, `info`, `warn`, `error`)     |
| `REDIS_URL`            | `redis://localhost:6379/0`   | Redis connection URL                                 |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000`      | Comma-separated list of allowed CORS origins         |
| `RATE_LIMIT_RPS`       | `100`                        | Rate limit — sustained requests per second           |
| `RATE_LIMIT_BURST`     | `200`                        | Rate limit — burst allowance                         |

### Optional — AWS

| Variable                | Default         | Description                                              |
|-------------------------|-----------------|----------------------------------------------------------|
| `AWS_DEFAULT_REGION`    | `us-east-1`     | AWS region for all service calls                         |
| `AWS_ACCOUNT_ID`        | —               | AWS account ID (used in ECR registry URL construction)   |
| `ECR_REGISTRY`          | —               | ECR registry hostname for pushing/pulling images         |
| `ARTIFACTS_BUCKET`      | —               | S3 bucket for build artifact uploads                     |

### Optional — Infrastructure

| Variable                 | Default     | Description                                            |
|--------------------------|-------------|--------------------------------------------------------|
| `ALB_DNS_NAME`           | —           | ALB DNS name used for custom domain CNAME targets      |
| `DB_SUBNET_GROUP`        | `capsule`   | RDS subnet group name for provisioned databases        |
| `RDS_SECURITY_GROUP_ID`  | —           | Security group ID attached to provisioned RDS instances|
| `CAPSULE_PUBLIC_HOST`    | —           | Public hostname or IP of this server (shown to users)  |
| `CAPSULE_APPS_DOMAIN`    | —           | Platform subdomain base for deployed apps              |
| `CAPSULE_STATIC_BUCKET`  | —           | S3 bucket for static asset hosting                     |

### Frontend

| Variable               | Default                    | Description                               |
|------------------------|----------------------------|-------------------------------------------|
| `NEXT_PUBLIC_API_URL`  | `http://localhost:8080`    | Public URL of the backend API             |
| `NEXT_PUBLIC_WS_URL`   | `ws://localhost:8080`      | Public WebSocket URL of the backend       |

---

## Make Targets

```
make build          Build all components (backend, CLI, frontend)
make test           Run all tests
make lint           Run all linters
make dev            Start PostgreSQL and Redis; print instructions for running backend/frontend
make dev-all        Start all services via Docker Compose
make docker-build   Build Docker images
make docker-up      Start all services with Docker Compose
make docker-down    Stop all Docker Compose services
make migrate-up     Run database migrations
make migrate-down   Rollback last database migration
make clean          Remove build artifacts
make help           List all available targets
```

---

## Project Layout

```
capsule/
├── backend/          Go API server (REST API, business logic, AWS orchestration)
├── frontend/         Next.js 14 web dashboard
├── cli/              Go CLI (Cobra-based)
├── deploy/           Terraform modules and production Docker Compose
│   └── terraform/    AWS infrastructure as code
├── demos/            Example applications for testing deployments
├── docs/             Architecture docs, ADRs, API spec
└── scripts/          Automation and helper scripts
```

---

## Documentation

- [Self-Hosting Guide](docs/SELF_HOSTING.md)
- [API Reference](docs/architecture/API_REFERENCE.md)
- [CLI Reference](docs/architecture/CLI_REFERENCE.md)
- [Backend README](backend/README.md)
- [Deploy README](deploy/README.md)
- [Contributing](CONTRIBUTING.md)

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit using Conventional Commits: `feat: add amazing feature`
4. Push and open a Pull Request

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

Built by [Kynto](https://github.com/Kynto)

</div>
