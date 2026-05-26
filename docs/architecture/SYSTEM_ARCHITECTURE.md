# Capsule — System Architecture

> **Version:** 1.0.0-draft  
> **Last Updated:** 2026-05-26  
> **Status:** Living Document  
> **Audience:** Core team, contributors, DevOps engineers

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [High-Level System Overview](#3-high-level-system-overview)
4. [Component Breakdown](#4-component-breakdown)
5. [Network Architecture](#5-network-architecture)
6. [Container Orchestration](#6-container-orchestration)
7. [Data Flow by Operation](#7-data-flow-by-operation)
8. [Auto-Scaling Architecture](#8-auto-scaling-architecture)
9. [Serverless vs Dedicated Mode](#9-serverless-vs-dedicated-mode)
10. [Observability & Monitoring](#10-observability--monitoring)
11. [Failure Modes & Recovery](#11-failure-modes--recovery)
12. [Glossary](#12-glossary)

---

## 1. Overview

**Capsule** is a self-hosted Platform-as-a-Service (PaaS) that transforms a single AWS account into a fully managed deployment platform. It provides:

- **One-command deployments** from Git repositories or local source
- **Managed databases** (PostgreSQL) and caches (Redis)
- **Automatic SSL/TLS** via Let's Encrypt
- **Custom domain management** with Route 53 integration
- **Zero-downtime deploys** with rolling updates
- **Full backup/restore** with AES-256 encryption
- **CLI + Dashboard** dual-interface access

Capsule targets indie developers, small teams, and startups who want Heroku-like simplicity on their own AWS infrastructure.

---

## 2. Design Principles

| Principle | Description |
|---|---|
| **Self-Contained** | A single binary + Docker image runs the entire platform |
| **AWS-Native** | Leverages AWS primitives (EC2, ALB, Route 53, S3, Lambda) directly |
| **Security-First** | TLS everywhere, encrypted secrets, least-privilege IAM |
| **Opinionated Defaults** | Works out of the box; configurability where it matters |
| **Portable State** | `capsule package --everything` creates a complete portable backup |
| **Minimal Overhead** | Runs on a single t3.medium or scales to multi-node ASG |

---

## 3. High-Level System Overview

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI["Capsule CLI<br/>(Go binary)"]
        DASH["Dashboard<br/>(React SPA)"]
    end

    subgraph "Capsule Platform"
        API["Backend API<br/>(Go / Fiber)"]
        WORKER["Background Workers<br/>(Go routines)"]
        PROXY["Traefik<br/>(Reverse Proxy)"]
        BUILDER["Build Engine<br/>(Docker / Buildpacks)"]
    end

    subgraph "Data Stores"
        PG["PostgreSQL<br/>(Platform DB)"]
        REDIS_INT["Redis<br/>(Internal Cache)"]
    end

    subgraph "AWS Services"
        EC2["EC2 Instances"]
        ALB["Application Load Balancer"]
        R53["Route 53"]
        S3["S3 Buckets"]
        LAMBDA["Lambda Functions"]
        ASG["Auto Scaling Groups"]
        ACM["ACM Certificates"]
        CW["CloudWatch"]
    end

    CLI -->|HTTPS REST/WS| API
    DASH -->|HTTPS REST/WS| API

    API --> PG
    API --> REDIS_INT
    API --> WORKER
    API --> BUILDER
    API --> PROXY

    WORKER --> EC2
    WORKER --> R53
    WORKER --> S3
    WORKER --> LAMBDA
    WORKER --> ALB
    WORKER --> ASG
    WORKER --> ACM

    PROXY --> EC2
    ALB --> PROXY

    BUILDER -->|"docker build"| EC2

    CW -.->|metrics| API
```

### Interaction Summary

| Interface | Transport | Auth |
|---|---|---|
| CLI → API | HTTPS + WebSocket | Bearer JWT or API Key |
| Dashboard → API | HTTPS + WebSocket | Bearer JWT (HttpOnly cookie) |
| API → AWS | AWS SDK v2 | IAM Role / Instance Profile |
| Traefik → Containers | HTTP (internal) | Docker network isolation |

---

## 4. Component Breakdown

### 4.1 Backend API (Go / Fiber)

The API server is the central control plane. It is built with the [Fiber](https://gofiber.io/) framework (v2) for high-throughput request handling.

```
cmd/
  api/            ← API entrypoint (main.go)
  cli/            ← CLI entrypoint (main.go)
  worker/         ← Background worker entrypoint
internal/
  api/
    handlers/     ← HTTP handlers per resource
    middleware/   ← Auth, rate-limit, CORS, logging
    routes/       ← Route registration
  auth/           ← JWT, API key, session management
  aws/            ← AWS SDK wrappers (EC2, R53, S3, Lambda, ALB, ASG)
  build/          ← Buildpack detection, Dockerfile generation
  config/         ← Configuration loading (env, files)
  db/             ← PostgreSQL repository layer (sqlc)
  deploy/         ← Deployment orchestrator
  domain/         ← Domain binding, DNS verification
  encryption/     ← AES-256 encrypt/decrypt helpers
  models/         ← Domain models and DTOs
  proxy/          ← Traefik dynamic config generation
  redis/          ← Redis management
  backup/         ← Backup/restore engine
  worker/         ← Worker and cron job management
  ws/             ← WebSocket hub for real-time log streaming
```

**Key Design Decisions:**

- **Fiber over net/http**: Raw performance for concurrent deploys; request-level timeouts
- **sqlc over GORM**: Type-safe SQL, no runtime reflection, explicit queries
- **AWS SDK v2**: Context-aware, modular service clients, paginated results
- **golang-migrate**: Version-controlled schema migrations as SQL files

### 4.2 CLI (Go / Cobra)

A single statically-linked binary distributed via `curl | sh`, Homebrew, and GitHub Releases.

```
capsule login           → OAuth / token-based auth
capsule init            → Link local directory to a project
capsule deploy          → Push code, trigger build, deploy
capsule logs            → Stream real-time logs via WebSocket
capsule db create       → Provision a PostgreSQL database
capsule redis create    → Provision a Redis instance
capsule domains add     → Bind custom domain
capsule env set         → Set environment variables
capsule backup create   → Create encrypted backup
capsule package         → Export full platform state
```

### 4.3 Dashboard (React + TypeScript)

A single-page application served by the API server or a CDN.

| Technology | Purpose |
|---|---|
| React 18+ | UI framework |
| TypeScript | Type safety |
| TanStack Query | Server-state management and caching |
| Tailwind CSS | Utility-first styling |
| Recharts | Metrics and usage charts |
| xterm.js | Terminal-in-browser for real-time logs |

### 4.4 Traefik Reverse Proxy

Traefik acts as the edge router for all deployed applications.

```mermaid
graph LR
    INTERNET["Internet"] --> ALB["AWS ALB<br/>:443"]
    ALB --> TRAEFIK["Traefik<br/>:80 / :443"]
    TRAEFIK --> APP1["app-1<br/>:8080"]
    TRAEFIK --> APP2["app-2<br/>:3000"]
    TRAEFIK --> APP3["app-3<br/>:5000"]
    TRAEFIK --> DASHBOARD["Dashboard<br/>:3001"]
    TRAEFIK --> API_INTERNAL["API<br/>:4000"]
```

**Traefik Configuration:**

- **Provider:** Docker (label-based routing)
- **Entrypoints:** `web` (:80 → redirect to :443), `websecure` (:443)
- **Certificate Resolvers:** Let's Encrypt (HTTP-01 or DNS-01 challenge via Route 53)
- **Middleware:** Rate limiting, headers, compression, circuit breaker

### 4.5 Build Engine

```mermaid
flowchart TD
    SRC["Source Code<br/>(git push / upload)"] --> DETECT{"Detect<br/>Build Strategy"}
    DETECT -->|Dockerfile found| DOCKER["Docker Build"]
    DETECT -->|Buildpack match| PACK["Cloud Native Buildpacks<br/>(pack build)"]
    DETECT -->|Static files| STATIC["Nginx Static Container"]

    DOCKER --> IMAGE["Container Image<br/>tagged: project:sha"]
    PACK --> IMAGE
    STATIC --> IMAGE

    IMAGE --> REGISTRY["Local Registry<br/>or ECR"]
    REGISTRY --> DEPLOY["Rolling Deploy"]
```

---

## 5. Network Architecture

### 5.1 VPC Layout

```mermaid
graph TB
    subgraph "VPC 10.0.0.0/16"
        subgraph "Public Subnets"
            PUB_A["10.0.1.0/24<br/>us-east-1a<br/>ALB, NAT GW"]
            PUB_B["10.0.2.0/24<br/>us-east-1b<br/>ALB"]
        end

        subgraph "Private Subnets"
            PRIV_A["10.0.10.0/24<br/>us-east-1a<br/>EC2 Instances"]
            PRIV_B["10.0.11.0/24<br/>us-east-1b<br/>EC2 Instances"]
        end

        subgraph "Data Subnets"
            DATA_A["10.0.20.0/24<br/>us-east-1a<br/>RDS, ElastiCache"]
            DATA_B["10.0.21.0/24<br/>us-east-1b<br/>RDS, ElastiCache"]
        end

        IGW["Internet Gateway"]
        NAT["NAT Gateway"]

        IGW --> PUB_A
        IGW --> PUB_B
        PUB_A --> NAT
        NAT --> PRIV_A
        NAT --> PRIV_B
    end
```

### 5.2 Security Groups

| Security Group | Inbound | Outbound | Attached To |
|---|---|---|---|
| `sg-alb` | 80, 443 from 0.0.0.0/0 | All to `sg-app` | Application Load Balancer |
| `sg-app` | 80, 443 from `sg-alb`; 22 from bastion | All outbound | EC2 instances (Capsule + apps) |
| `sg-db` | 5432 from `sg-app` | None | PostgreSQL (RDS or container) |
| `sg-redis` | 6379 from `sg-app` | None | Redis (ElastiCache or container) |
| `sg-bastion` | 22 from admin CIDR | All outbound | Bastion host (optional) |

### 5.3 DNS Architecture

```mermaid
sequenceDiagram
    participant User
    participant CLI as Capsule CLI
    participant API as Capsule API
    participant R53 as Route 53
    participant Traefik

    User->>CLI: capsule domains add myapp.com
    CLI->>API: POST /v1/domains {name: "myapp.com", project_id: "..."}
    API->>R53: Create CNAME record → ALB DNS
    API->>R53: Create TXT _capsule-verify.myapp.com
    API-->>CLI: Pending verification
    Note over API: Background worker polls DNS
    API->>R53: Verify TXT record resolves
    API->>Traefik: Add routing rule for myapp.com
    API->>Traefik: Request Let's Encrypt certificate
    Traefik-->>API: Certificate issued
    API-->>User: Domain active with SSL
```

---

## 6. Container Orchestration

### 6.1 Docker Architecture

Capsule uses Docker directly (not Kubernetes) for container orchestration. This keeps complexity low while providing production-grade container management.

```mermaid
graph TB
    subgraph "Host OS (Amazon Linux 2 / Ubuntu)"
        DOCKER["Docker Engine"]

        subgraph "capsule-network (bridge)"
            TRAEFIK_C["traefik<br/>:80, :443, :8080"]
            API_C["capsule-api<br/>:4000"]
            DASH_C["capsule-dashboard<br/>:3001"]
            PG_C["capsule-postgres<br/>:5432"]
            REDIS_C["capsule-redis<br/>:6379"]
        end

        subgraph "app-network (per-project)"
            APP1_C["myapp-v3<br/>:8080"]
            APP1_OLD["myapp-v2<br/>(draining)"]
            APP2_C["api-prod<br/>:3000"]
            DB1_C["myapp-db<br/>(postgres:15)"]
            REDIS1_C["myapp-cache<br/>(redis:7)"]
        end

        TRAEFIK_C --> APP1_C
        TRAEFIK_C --> APP2_C
        TRAEFIK_C --> DASH_C
        TRAEFIK_C --> API_C

        APP1_C --> DB1_C
        APP1_C --> REDIS1_C
    end
```

### 6.2 Container Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Building: deploy triggered
    Building --> ImageReady: build success
    Building --> Failed: build error
    ImageReady --> Starting: container create & start
    Starting --> HealthChecking: container running
    HealthChecking --> Active: health check pass
    HealthChecking --> Failed: health check timeout
    Active --> Draining: new version deploying
    Draining --> Stopped: connections drained
    Stopped --> [*]: container removed
    Failed --> [*]: cleanup
```

### 6.3 Rolling Deployment Strategy

1. Build new container image with tag `project:git-sha`
2. Start new container on the same Docker network
3. Wait for health check (`GET /health` returns 200)
4. Update Traefik routing to include new container
5. Mark old container as draining (stop accepting new connections)
6. Wait for drain timeout (default: 30 s)
7. Remove old container
8. Update deployment record in database

---

## 7. Data Flow by Operation

### 7.1 Deploy

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as Capsule CLI
    participant API as API Server
    participant Builder as Build Engine
    participant Docker
    participant Traefik
    participant DB as Platform DB

    Dev->>CLI: capsule deploy
    CLI->>CLI: tar source code (exclude .gitignore)
    CLI->>API: POST /v1/deployments (multipart upload)
    API->>DB: Create deployment record (status: building)
    API->>Builder: Trigger async build
    Builder->>Builder: Detect build strategy
    Builder->>Docker: docker build -t project:sha .
    Docker-->>Builder: Image built
    Builder->>DB: Update deployment (status: deploying)
    Builder->>Docker: docker run project:sha
    Docker-->>Builder: Container started
    Builder->>Builder: Health check loop
    Builder->>Traefik: Update routing config
    Builder->>Docker: Stop old container (drain)
    Builder->>DB: Update deployment (status: active)
    API-->>CLI: Deployment complete ✓
    CLI-->>Dev: ✓ https://myapp.capsule.dev
```

### 7.2 Create Database

```mermaid
sequenceDiagram
    participant CLI as CLI / Dashboard
    participant API as API Server
    participant Docker
    participant DB as Platform DB

    CLI->>API: POST /v1/databases {engine: "postgres", version: "15"}
    API->>API: Generate credentials (32-byte random password)
    API->>API: Encrypt credentials (AES-256-GCM)
    API->>Docker: docker run postgres:15 (with volume)
    Docker-->>API: Container started on :5432 (internal)
    API->>DB: Store database record + encrypted credentials
    API-->>CLI: {host, port, user, db_name, connection_string}
```

### 7.3 Manage Domains

```mermaid
sequenceDiagram
    participant CLI as CLI / Dashboard
    participant API as API Server
    participant R53 as Route 53
    participant Traefik
    participant LE as Let's Encrypt

    CLI->>API: POST /v1/domains {name: "app.example.com"}
    API->>R53: Upsert CNAME → ALB DNS
    API->>API: Store domain (status: pending_verification)
    Note over API: Background verification loop
    API->>R53: Query TXT record
    R53-->>API: Record found
    API->>Traefik: Add Host rule + TLS config
    Traefik->>LE: ACME HTTP-01 challenge
    LE-->>Traefik: Certificate issued
    API->>API: Update domain (status: active, ssl: true)
    API-->>CLI: Domain active with SSL ✓
```

### 7.4 Backup / Package

```mermaid
sequenceDiagram
    participant CLI
    participant API
    participant Docker
    participant S3

    CLI->>API: POST /v1/backups {type: "full"}
    API->>Docker: pg_dump for each database
    API->>Docker: redis-cli BGSAVE + copy RDB
    API->>API: Export platform DB
    API->>API: Export env vars (encrypted)
    API->>API: Export Traefik config
    API->>API: Export docker-compose configs
    API->>API: tar + AES-256-GCM encrypt
    API->>S3: Upload capsule-backup-2026-05-26.tar.enc
    API-->>CLI: Backup complete (152 MB, encrypted)
```

### 7.5 Auto-Scaling (Scale-Out)

```mermaid
sequenceDiagram
    participant CW as CloudWatch
    participant ASG as Auto Scaling Group
    participant EC2 as New EC2 Instance
    participant API as Capsule API
    participant Docker

    CW->>ASG: CPU > 70% for 5 min
    ASG->>EC2: Launch new instance (from AMI)
    EC2->>EC2: User-data: install Docker, join cluster
    EC2->>API: POST /v1/internal/nodes/register
    API->>Docker: Deploy app containers to new node
    API->>API: Update ALB target group
    Note over ASG: Scale-in after CPU < 30% for 15 min
```

---

## 8. Auto-Scaling Architecture

### 8.1 Components

```mermaid
graph TB
    subgraph "Auto-Scaling Group"
        LAUNCH["Launch Template<br/>AMI: capsule-node-v1<br/>Instance: t3.medium"]
        ASG["ASG<br/>min: 1, max: 10<br/>desired: 2"]
        POLICY["Scaling Policies<br/>Target Tracking: CPU 70%<br/>Step: +2 at CPU 90%"]
    end

    subgraph "Load Balancing"
        ALB["Application Load Balancer"]
        TG["Target Group<br/>Health: /health, 30s interval"]
        LISTENER["Listeners<br/>:80 → redirect :443<br/>:443 → TG"]
    end

    subgraph "Instances"
        I1["Instance 1<br/>Traefik + Apps"]
        I2["Instance 2<br/>Traefik + Apps"]
        I3["Instance N<br/>Traefik + Apps"]
    end

    ASG --> LAUNCH
    ASG --> POLICY
    ALB --> LISTENER
    LISTENER --> TG
    TG --> I1
    TG --> I2
    TG --> I3
```

### 8.2 Scaling Policies

| Metric | Threshold | Action | Cooldown |
|---|---|---|---|
| Average CPU | > 70% for 5 min | Add 1 instance | 300 s |
| Average CPU | > 90% for 2 min | Add 2 instances | 180 s |
| Average CPU | < 30% for 15 min | Remove 1 instance | 600 s |
| Request Count | > 10,000/min | Add 1 instance | 300 s |
| Memory Utilization | > 85% for 5 min | Add 1 instance | 300 s |

### 8.3 Node Bootstrap Sequence

1. ASG launches new EC2 instance from Launch Template
2. User-data script installs Docker, pulls Capsule node agent
3. Node agent contacts the Capsule API: `POST /v1/internal/nodes/register`
4. API assigns application containers to the new node
5. Node pulls and starts containers
6. Node registers with ALB target group
7. ALB starts routing traffic after health check passes

---

## 9. Serverless vs Dedicated Mode

Capsule supports two deployment modes per project:

```mermaid
graph LR
    subgraph "Dedicated Mode (default)"
        D_CONTAINER["Always-On Container<br/>1+ replicas"]
        D_ALB["ALB → Traefik → Container"]
    end

    subgraph "Serverless Mode"
        S_LAMBDA["AWS Lambda<br/>(custom runtime)"]
        S_APIGW["API Gateway → Lambda"]
        S_COLD["Cold Start: ~500ms"]
    end

    PROJECT["capsule deploy<br/>--serverless"] --> S_LAMBDA
    PROJECT2["capsule deploy"] --> D_CONTAINER
```

### Comparison

| Aspect | Dedicated | Serverless |
|---|---|---|
| **Latency** | ~5 ms (warm) | ~500 ms (cold start) |
| **Cost at idle** | EC2 hourly rate | $0 when idle |
| **Scaling** | ASG (minutes) | Instant (per-request) |
| **Max request duration** | Unlimited | 15 min (Lambda limit) |
| **WebSocket support** | ✅ Full support | ❌ Not supported |
| **Persistent volumes** | ✅ Docker volumes | ❌ Ephemeral only |
| **Best for** | APIs, dashboards, stateful apps | Webhooks, crons, low-traffic sites |
| **Languages** | Any (Docker) | Go, Node, Python, Ruby (custom runtime) |

### Serverless Build Pipeline

```mermaid
flowchart TD
    SRC["Source Code"] --> DETECT{"Runtime<br/>Detection"}
    DETECT -->|Go| GO_BUILD["go build -o bootstrap"]
    DETECT -->|Node| NODE_BUILD["Bundle with esbuild"]
    DETECT -->|Python| PY_BUILD["Package with pip"]

    GO_BUILD --> ZIP["Create deployment.zip"]
    NODE_BUILD --> ZIP
    PY_BUILD --> ZIP

    ZIP --> S3["Upload to S3"]
    S3 --> LAMBDA["Update Lambda function code"]
    LAMBDA --> APIGW["Configure API Gateway routes"]
    APIGW --> LIVE["Live: https://app.capsule.dev"]
```

---

## 10. Observability & Monitoring

### 10.1 Metrics Pipeline

```mermaid
graph LR
    APPS["App Containers"] -->|stdout/stderr| DOCKER_LOG["Docker Log Driver"]
    DOCKER_LOG --> LOKI["Loki<br/>(optional)"]
    DOCKER_LOG --> CW_LOGS["CloudWatch Logs"]

    APPS -->|/metrics| PROM["Prometheus<br/>(optional)"]
    PROM --> GRAFANA["Grafana<br/>(optional)"]

    API["Capsule API"] -->|structured JSON| CW_LOGS
    API -->|custom metrics| CW_METRICS["CloudWatch Metrics"]

    CW_METRICS --> ALARM["CloudWatch Alarms"]
    ALARM --> SNS["SNS → Email/Slack"]
```

### 10.2 Health Check Strategy

| Component | Endpoint | Interval | Timeout | Healthy After | Unhealthy After |
|---|---|---|---|---|---|
| ALB → Traefik | `GET /ping` | 15 s | 5 s | 2 checks | 3 checks |
| Traefik → App | `GET /health` | 10 s | 3 s | 1 check | 3 checks |
| API self-check | `GET /v1/health` | 30 s | 10 s | 1 check | 2 checks |

---

## 11. Failure Modes & Recovery

| Failure | Detection | Recovery |
|---|---|---|
| App container crash | Docker restart policy + health check | Auto-restart (max 5 retries) then alert |
| Build failure | Non-zero exit code | Keep previous deployment active; notify user |
| EC2 instance failure | ALB health check / ASG | ASG replaces instance; ALB re-routes |
| Database corruption | Automated pg_dump verification | Restore from latest S3 backup |
| Traefik crash | Docker restart: always | Auto-restart; ALB routes to healthy nodes |
| API crash | systemd / Docker restart | Auto-restart; CLI retries with backoff |
| DNS propagation delay | Background polling (60 s) | Retry for up to 48 hours then fail |
| SSL certificate renewal failure | 30-day expiry check | Alert at 14 days; manual renewal fallback |
| S3 backup upload failure | Upload checksum verification | Retry 3x with exponential backoff |

---

## 12. Glossary

| Term | Definition |
|---|---|
| **Project** | A logical unit representing a deployable application |
| **Deployment** | A specific version of a project pushed to the platform |
| **Build** | The process of creating a container image from source code |
| **Node** | An EC2 instance running Docker and Capsule agent |
| **Service** | A running container (app, database, or cache) |
| **Domain** | A custom domain bound to a project with SSL |
| **Package** | An encrypted backup of the entire platform state |
| **Worker** | A long-running background process tied to a project |
| **Cron Job** | A scheduled task with cron expression |
| **Platform DB** | The PostgreSQL database storing Capsule's own state |

---

> **Resumen (ES):** Este documento describe la arquitectura completa de Capsule: una PaaS auto-alojada sobre AWS. Cubre las interfaces de usuario (CLI y Dashboard), el API backend en Go/Fiber, la orquestación de contenedores con Docker y Traefik, la arquitectura de red con VPC y security groups, el auto-escalamiento con ASG/ALB, y los modos serverless vs dedicado. Incluye diagramas de flujo de datos para cada operación principal (deploy, bases de datos, dominios, backups) y estrategias de recuperación ante fallos.
