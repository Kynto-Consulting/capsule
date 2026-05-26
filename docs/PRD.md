# Capsule — Product Requirements Document (PRD)

| Field             | Value                                      |
| ----------------- | ------------------------------------------ |
| **Document ID**   | PRD-CAPSULE-001                            |
| **Version**       | 1.0.0                                      |
| **Status**        | Draft                                      |
| **Author**        | Kynto Engineering                          |
| **Created**       | 2026-05-26                                 |
| **Last Updated**  | 2026-05-26                                 |
| **Classification**| Internal — Confidential                    |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Product Vision & Goals](#3-product-vision--goals)
4. [Target Users (Personas)](#4-target-users-personas)
5. [Core Features](#5-core-features)
6. [User Stories & Use Cases](#6-user-stories--use-cases)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [System Architecture Overview](#9-system-architecture-overview)
10. [Technology Stack](#10-technology-stack)
11. [Security Requirements](#11-security-requirements)
12. [Success Metrics / KPIs](#12-success-metrics--kpis)
13. [Release Phases](#13-release-phases)
14. [Risks & Mitigations](#14-risks--mitigations)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

**Capsule** is a self-hosted Platform-as-a-Service (PaaS) designed to run entirely within a customer's own AWS account. It delivers a unified experience — through both a **web dashboard** and a **CLI tool** — for provisioning and managing databases, caches, domain names, serverless functions, and persistent servers.

The platform targets development teams and solo developers who want the simplicity of Vercel or Heroku but demand full ownership of their infrastructure, data sovereignty, and predictable AWS-native pricing. Capsule abstracts the operational complexity of AWS while preserving escape hatches and transparency: every resource it creates is a standard AWS resource that the user can inspect, audit, and migrate away from.

### Key Differentiators

| Differentiator               | Description                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **Self-hosted on your AWS**  | All resources live in the user's account — no vendor lock-in, no data leaves the perimeter.       |
| **Unified resource model**   | Databases, caches, domains, functions, and servers share one API surface and one CLI.             |
| **`--serverless` flag**      | A single flag switches any resource between containerised (Docker) and AWS-managed serverless.    |
| **Cloud builds**             | Code is built remotely (AWS CodeBuild / internal build worker); nothing is built on the laptop.   |
| **Full portability**         | `capsule package --everything` exports the entire infrastructure to an AES-256 encrypted archive. |
| **IAM least-privilege**      | Every operation runs under a scoped IAM sub-profile; the root key is never used at runtime.       |

---

## 2. Problem Statement

### 2.1 Current Pain Points

Modern developers face a **fragmentation problem** when deploying applications on AWS:

1. **Tool sprawl** — Different tools for databases (RDS Console), caching (ElastiCache Console), domains (Route 53), compute (ECS/Lambda Console), and CI/CD (CodePipeline). Each requires its own mental model.
2. **Steep learning curve** — AWS has 200+ services. A developer who "just wants to deploy a Next.js app with a database" must learn VPCs, Security Groups, IAM policies, Target Groups, Listener Rules, ACM, and more.
3. **Vendor lock-in with managed PaaS** — Platforms like Heroku, Render, and Railway abstract AWS but own the data. Migrating away means re-engineering infrastructure from scratch.
4. **No unified backup/export** — There is no single command to snapshot an entire project (code + data + secrets + DNS) and restore it elsewhere.
5. **Secret sprawl** — Environment variables end up in `.env` files, CI/CD dashboards, and AWS Systems Manager with no single source of truth.
6. **No rollback story** — Teams deploy via `git push` but have no one-click rollback for infrastructure changes, database schemas, or domain configurations.

### 2.2 Opportunity

A self-hosted PaaS that:

- Runs **inside** the developer's AWS account (data sovereignty).
- Presents a **Vercel-like UX** (dashboard + CLI).
- Manages **all five resource types** (DB, Cache, Domain, Serverless, Server) through one interface.
- Offers **one-command portability** (`package` / `import`).

…closes the gap between "deploy in 30 seconds" convenience and "I own everything" control.

---

## 3. Product Vision & Goals

### 3.1 Vision Statement

> *"Give every developer team the power of a dedicated DevOps engineer — without hiring one — while keeping 100 % ownership of their infrastructure, data, and destiny."*

### 3.2 Strategic Goals

| #   | Goal                              | Metric                                                                   | Target          |
| --- | --------------------------------- | ------------------------------------------------------------------------ | --------------- |
| G-1 | Reduce deploy friction            | Time from `git push` to live URL                                         | ≤ 90 seconds    |
| G-2 | Eliminate tool sprawl             | Number of UIs a developer must use for a standard full-stack deploy      | 1 (Capsule)     |
| G-3 | Guarantee data sovereignty        | % of data stored outside the user's AWS account                          | 0 %             |
| G-4 | Enable full portability           | Time to export + import a full project to a new AWS account              | ≤ 15 minutes    |
| G-5 | Minimise blast radius             | Number of IAM permissions granted beyond the minimum needed              | 0               |
| G-6 | Support serverless & traditional  | % of resource types that support `--serverless` flag                     | 100 % (5 of 5)  |

### 3.3 Design Principles

1. **Convention over configuration** — Sane defaults, override when needed.
2. **Transparency** — Every AWS resource is tagged with `capsule:project`, `capsule:resource-type`, and `capsule:version`.
3. **Idempotency** — Every CLI command and API call can be safely retried.
4. **Graceful degradation** — If a non-critical subsystem fails (e.g., log streaming), the deploy still completes.
5. **Escape hatch** — Users can always access underlying AWS resources directly via the AWS Console.

---

## 4. Target Users (Personas)

### Persona 1 — **Indie Developer ("Ana")**

| Attribute       | Detail                                                                                 |
| --------------- | -------------------------------------------------------------------------------------- |
| Role            | Full-stack solo developer, freelancer                                                  |
| Experience      | 3–5 years; comfortable with CLI, limited AWS experience                                |
| Goals           | Deploy side projects fast, keep costs near zero, own data                              |
| Frustrations    | Heroku is expensive for hobby tier; Vercel doesn't do databases; AWS Console is scary  |
| Capsule value   | One CLI to deploy a Next.js app + PostgreSQL + Redis, pay only AWS usage               |

### Persona 2 — **Startup CTO ("Marco")**

| Attribute       | Detail                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Role            | Technical co-founder, team of 3–10 engineers                                                    |
| Experience      | 8+ years; AWS-literate, wants to avoid dedicated DevOps hire                                    |
| Goals           | Ship fast, keep infra auditable, SOC 2 readiness, no vendor lock-in                            |
| Frustrations    | Terraform is powerful but slow for iteration; PaaS vendors own the data                         |
| Capsule value   | Dashboard for team visibility, IAM sub-profiles for compliance, `package` for disaster recovery |

### Persona 3 — **Platform Engineer ("Lucía")**

| Attribute       | Detail                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Role            | DevOps / Platform engineer at a mid-size company (50–200 employees)                                  |
| Experience      | 10+ years; deep AWS, Kubernetes, Terraform expertise                                                 |
| Goals           | Provide internal developer platform for her org without building from scratch                        |
| Frustrations    | Building internal tooling takes 6+ months; Kubernetes is overkill for most teams                     |
| Capsule value   | Pre-built PaaS she can deploy, customise, and hand to dev teams; escape hatches for edge cases       |

### Persona 4 — **Agency Developer ("Carlos")**

| Attribute       | Detail                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Role            | Developer at a digital agency managing 10–50 client projects                                               |
| Experience      | 5+ years; needs repeatable deploy workflows across multiple AWS accounts                                   |
| Goals           | Deploy client projects quickly, hand over infrastructure cleanly, maintain separation between clients      |
| Frustrations    | Each client has different AWS accounts; no tool unifies multi-account management                           |
| Capsule value   | `capsule package` + `capsule import` for client handoff; project-level isolation with IAM sub-profiles     |

---

## 5. Core Features

### 5.1 Feature Map (Overview)

```mermaid
mindmap
  root((Capsule))
    Databases
      PostgreSQL
      MySQL
      MongoDB
      --serverless flag
    Redis
      Cache mode
      Key-value mode
      --serverless flag
    Domains
      IP / CNAME management
      Auto SSL via Let's Encrypt
      Route 53 integration
    Serverless
      Lambda functions
      API Gateway
      --serverless deploy
    Servers 24/7
      Persistent containers
      Workers & daemons
      Cron jobs
      ASG + ALB
    Dashboard
      Project overview
      Real-time logs
      Deploy history
      Env var management
      Rollback UI
    CLI
      capsule login
      capsule deploy
      capsule db
      capsule srv
      capsule domain
      capsule env
      capsule logs
      capsule package
      capsule import
      capsule link
```

---

### 5.2 Feature 1 — Database Management

Capsule provisions and manages relational and document databases on the user's AWS account.

#### 5.2.1 Supported Engines

| Engine     | Default Mode (Docker)                    | Serverless Mode (`--serverless`)          |
| ---------- | ---------------------------------------- | ----------------------------------------- |
| PostgreSQL | Docker container on EC2 (EBS volume)     | Amazon Aurora Serverless v2 (PostgreSQL)  |
| MySQL      | Docker container on EC2 (EBS volume)     | Amazon Aurora Serverless v2 (MySQL)       |
| MongoDB    | Docker container on EC2 (EBS volume)     | Amazon DocumentDB Elastic Clusters        |

#### 5.2.2 CLI Interface

```bash
# Create a PostgreSQL database (Docker mode)
capsule db create --engine postgres --name mydb --version 16

# Create an Aurora Serverless v2 PostgreSQL database
capsule db create --engine postgres --name mydb --version 16 --serverless

# List all databases in the current project
capsule db list

# Show connection string (masked by default)
capsule db info mydb
capsule db info mydb --show-credentials

# Create a point-in-time snapshot
capsule db snapshot mydb --name pre-migration

# Restore from snapshot
capsule db restore mydb --snapshot pre-migration

# Delete database (requires confirmation)
capsule db delete mydb

# Open interactive shell
capsule db shell mydb

# Resize (Docker mode)
capsule db scale mydb --cpu 2 --memory 4096

# Resize (Serverless mode — set min/max ACU)
capsule db scale mydb --min-acu 0.5 --max-acu 16
```

#### 5.2.3 Dashboard Capabilities

- Visual list of all databases with status badges (Running, Stopped, Provisioning, Error).
- One-click snapshot creation and restore.
- Connection string copy-to-clipboard (with masked/reveal toggle).
- Metrics panel: CPU, memory, storage, connections, IOPS (CloudWatch).
- Version upgrade wizard.
- Schema browser (read-only) for relational engines.

#### 5.2.4 Data Model

| Field              | Type      | Description                                         |
| ------------------ | --------- | --------------------------------------------------- |
| `id`               | UUID      | Internal Capsule resource ID                        |
| `project_id`       | UUID      | Parent project                                      |
| `engine`           | ENUM      | `postgres`, `mysql`, `mongodb`                      |
| `version`          | STRING    | Engine version (e.g., `16`, `8.0`, `7.0`)           |
| `mode`             | ENUM      | `container`, `serverless`                           |
| `name`             | STRING    | User-defined name, unique within project            |
| `status`           | ENUM      | `provisioning`, `running`, `stopped`, `error`, `deleted` |
| `host`             | STRING    | Internal hostname or endpoint                       |
| `port`             | INT       | Connection port                                     |
| `credentials_ref`  | STRING    | Reference to secret in AWS Secrets Manager          |
| `storage_gb`       | INT       | Allocated storage (container mode)                  |
| `min_acu`          | FLOAT     | Minimum Aurora Capacity Units (serverless mode)     |
| `max_acu`          | FLOAT     | Maximum Aurora Capacity Units (serverless mode)     |
| `aws_resource_arn` | STRING    | ARN of the underlying AWS resource                  |
| `created_at`       | TIMESTAMP | Creation timestamp                                  |
| `updated_at`       | TIMESTAMP | Last modification timestamp                         |

---

### 5.3 Feature 2 — Redis (Cache / Key-Value Store)

#### 5.3.1 Modes

| Mode          | Default (Docker)                    | Serverless (`--serverless`)               |
| ------------- | ----------------------------------- | ----------------------------------------- |
| Cache         | Redis container on EC2              | Amazon ElastiCache Serverless for Redis   |
| Key-value     | Redis container on EC2              | Amazon ElastiCache Serverless for Redis   |

#### 5.3.2 CLI Interface

```bash
# Create a Redis instance (Docker mode)
capsule redis create --name mycache --maxmemory 512mb

# Create an ElastiCache Serverless instance
capsule redis create --name mycache --serverless

# List all Redis instances
capsule redis list

# Show connection details
capsule redis info mycache

# Open redis-cli shell
capsule redis shell mycache

# Flush all keys (requires --confirm)
capsule redis flush mycache --confirm

# Delete instance
capsule redis delete mycache

# Scale (Docker mode)
capsule redis scale mycache --memory 1024mb

# Scale (Serverless mode — set ECPU limits)
capsule redis scale mycache --max-ecpu 5000
```

#### 5.3.3 Dashboard Capabilities

- Instance list with status, memory usage, and hit/miss ratio.
- Key browser (paginated, search by pattern).
- TTL management.
- Memory usage graph (CloudWatch).
- One-click flush with confirmation modal.

---

### 5.4 Feature 3 — Domain / IP / CNAME Management

#### 5.4.1 Capabilities

| Capability              | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| Custom domain binding   | Map `example.com` or `api.example.com` to any Capsule resource         |
| Auto SSL                | Automatic TLS certificate via Let's Encrypt (ACME DNS-01 challenge)    |
| Route 53 integration    | Create/update A, AAAA, CNAME records in the user's hosted zone        |
| Wildcard SSL            | Support `*.example.com` with DNS-01 validation                         |
| SSL auto-renewal        | Background job renews certificates 30 days before expiry               |
| Health checks           | Route 53 health checks for failover configurations                     |

#### 5.4.2 CLI Interface

```bash
# Add a custom domain to a project
capsule domain add example.com --target my-server

# Add a subdomain
capsule domain add api.example.com --target my-api-server

# List all domains
capsule domain list

# Check DNS propagation status
capsule domain status example.com

# Force SSL certificate renewal
capsule domain renew-ssl example.com

# Remove a domain binding
capsule domain remove example.com

# Show DNS records that need to be created (for external DNS providers)
capsule domain dns-instructions example.com
```

#### 5.4.3 SSL Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as Capsule CLI
    participant API as Capsule API
    participant R53 as Route 53
    participant LE as Let's Encrypt
    participant Traefik

    User->>CLI: capsule domain add example.com
    CLI->>API: POST /domains
    API->>R53: Create TXT record for ACME challenge
    API->>LE: Request certificate (DNS-01)
    LE->>R53: Verify TXT record
    LE-->>API: Issue certificate
    API->>Traefik: Hot-reload certificate
    API->>R53: Create A/CNAME record
    API-->>CLI: Domain active ✓
    CLI-->>User: ✅ example.com → https://...
```

---

### 5.5 Feature 4 — Serverless Deployments

Capsule provides a Vercel/Cloudflare Workers-like experience for deploying serverless functions backed by AWS Lambda.

#### 5.5.1 Supported Runtimes

| Runtime    | Version(s)          | Build System         |
| ---------- | ------------------- | -------------------- |
| Node.js    | 18.x, 20.x, 22.x   | esbuild / webpack    |
| Python     | 3.11, 3.12, 3.13    | pip + zip            |
| Go         | 1.22+               | `go build`           |
| Rust       | stable              | `cargo lambda`       |
| Docker     | Any                 | Custom Dockerfile    |

#### 5.5.2 CLI Interface

```bash
# Deploy current directory as a serverless function
capsule deploy --serverless

# Deploy with specific runtime
capsule deploy --serverless --runtime node20

# Deploy with custom handler
capsule deploy --serverless --handler src/index.handler

# Deploy with environment variables
capsule deploy --serverless --env API_KEY=xxx --env DB_URL=yyy

# List serverless deployments
capsule deploy list --type serverless

# Rollback to previous deployment
capsule deploy rollback --to v3

# View function URL
capsule deploy info my-function
```

#### 5.5.3 Architecture (Serverless)

```mermaid
graph LR
    subgraph User's AWS Account
        APIGW[API Gateway v2] --> Lambda[AWS Lambda]
        Lambda --> VPC[VPC - Private Subnet]
        VPC --> Aurora[Aurora Serverless v2]
        VPC --> EC[ElastiCache Serverless]
        CW[CloudWatch Logs] -.-> Lambda
    end
    
    Client[Internet Client] --> CF[CloudFront CDN]
    CF --> APIGW
```

#### 5.5.4 Build Pipeline (Serverless)

1. Developer runs `capsule deploy --serverless`.
2. CLI compresses source code and uploads to S3 build bucket.
3. API triggers AWS CodeBuild (or internal build worker).
4. Build worker installs dependencies, compiles, and produces a deployment artifact.
5. Artifact is uploaded to S3 and deployed to AWS Lambda.
6. API Gateway route is created/updated.
7. CloudFront distribution is updated (if CDN is enabled).
8. Deploy metadata (version, commit SHA, timestamp, build logs) is recorded.
9. CLI receives the live URL and deploy ID.

---

### 5.6 Feature 5 — 24/7 Servers (Persistent Compute)

For workloads that must run continuously — web servers, API backends, background workers, daemons, and cron jobs.

#### 5.6.1 Compute Modes

| Mode       | Implementation                        | Use Case                               |
| ---------- | ------------------------------------- | -------------------------------------- |
| `server`   | Docker container on EC2 (ASG + ALB)   | Web servers, APIs                      |
| `worker`   | Docker container on EC2 (no ALB)      | Queue consumers, background processors |
| `daemon`   | Docker container with restart policy   | Long-running services, watchers        |
| `cron`     | Docker container + CloudWatch Events   | Scheduled tasks                        |

#### 5.6.2 CLI Interface

```bash
# Deploy a web server (default: Dockerfile in project root)
capsule deploy --type server

# Deploy a background worker
capsule deploy --type worker --command "node worker.js"

# Deploy a daemon
capsule deploy --type daemon --command "./my-daemon"

# Deploy a cron job
capsule deploy --type cron --schedule "0 */6 * * *" --command "python cleanup.py"

# Scale a server
capsule srv scale my-server --replicas 3 --instance-type t3.medium

# View running instances
capsule srv list

# SSH into a container (via SSM Session Manager)
capsule srv ssh my-server

# Restart all instances
capsule srv restart my-server

# View auto-scaling configuration
capsule srv autoscale my-server --show

# Configure auto-scaling
capsule srv autoscale my-server --min 2 --max 10 --cpu-target 70
```

#### 5.6.3 Server Architecture

```mermaid
graph TB
    Internet[Internet Traffic] --> ALB[Application Load Balancer]
    ALB --> TG[Target Group]
    
    subgraph ASG[Auto Scaling Group]
        EC2_1[EC2 Instance 1<br/>Docker Container]
        EC2_2[EC2 Instance 2<br/>Docker Container]
        EC2_3[EC2 Instance N<br/>Docker Container]
    end
    
    TG --> EC2_1
    TG --> EC2_2
    TG --> EC2_3
    
    EC2_1 --> ECR[ECR Registry]
    EC2_2 --> ECR
    EC2_3 --> ECR
    
    CW[CloudWatch Alarms] -.->|Scale triggers| ASG
    
    subgraph Data Layer
        DB[(Database)]
        Redis[(Redis)]
    end
    
    EC2_1 --> DB
    EC2_1 --> Redis
```

#### 5.6.4 Deployment Strategy

| Strategy       | Description                                                      | Default |
| -------------- | ---------------------------------------------------------------- | ------- |
| Rolling update | Replace instances one by one, health-check gated                 | ✅      |
| Blue/Green     | Deploy to new ASG, swap ALB target group, drain old              |         |
| Canary         | Route % of traffic to new version, promote after validation      |         |

---

### 5.7 Feature 6 — Web Dashboard

#### 5.7.1 Pages & Views

| Page                   | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| **Login / Register**   | Email + password, OAuth (GitHub, Google), MFA (TOTP)                 |
| **Projects**           | Grid/list of all projects with status, last deploy, resource counts  |
| **Project Detail**     | Overview with resource cards, deploy timeline, quick actions         |
| **Databases**          | List, create, snapshot, restore, metrics, schema browser             |
| **Redis**              | List, create, key browser, metrics, flush                            |
| **Domains**            | List, add, SSL status, DNS records, propagation check                |
| **Deployments**        | History table with status, commit, duration, logs link, rollback btn |
| **Servers**            | Instance list, scaling config, SSH button, restart, resource metrics |
| **Environment Vars**   | Key-value editor, bulk import, visibility toggle (masked/revealed)   |
| **Logs**               | Real-time log viewer with filters (resource, severity, time range)   |
| **Settings**           | Project settings, danger zone (delete), team management              |
| **Backup / Export**    | Generate package, download, import from file                         |

#### 5.7.2 Real-Time Features

| Feature           | Technology          | Description                                      |
| ----------------- | ------------------- | ------------------------------------------------ |
| Live logs          | WebSocket (primary) | Bi-directional streaming from log aggregator     |
| Deploy progress    | SSE (fallback)      | Server-sent events for build/deploy status       |
| Resource status    | WebSocket           | Real-time status transitions (e.g., Provisioning → Running) |
| Notifications      | WebSocket           | Toast notifications for completed operations     |

---

### 5.8 Feature 7 — CLI Tool (`capsule`)

#### 5.8.1 Command Tree

```
capsule
├── login              # Authenticate with Capsule API
├── logout             # Clear local session
├── init               # Initialize a new project
├── link               # Link current directory to existing project
├── deploy             # Deploy code (--serverless, --type server/worker/daemon/cron)
│   ├── list           # List deploy history
│   ├── info <id>      # Show deploy details
│   └── rollback       # Rollback to a previous version
├── db                 # Database management
│   ├── create         # Create a new database
│   ├── list           # List all databases
│   ├── info <name>    # Show database details
│   ├── shell <name>   # Open interactive database shell
│   ├── snapshot       # Create a point-in-time snapshot
│   ├── restore        # Restore from snapshot
│   ├── scale          # Resize compute/storage
│   └── delete         # Delete a database
├── redis              # Redis management
│   ├── create         # Create a new Redis instance
│   ├── list           # List all instances
│   ├── info <name>    # Show instance details
│   ├── shell <name>   # Open redis-cli
│   ├── flush          # Flush all keys
│   ├── scale          # Resize memory/ECPU
│   └── delete         # Delete an instance
├── srv                # Server management
│   ├── list           # List all servers
│   ├── scale          # Scale replicas/instance type
│   ├── autoscale      # Configure auto-scaling
│   ├── ssh            # SSH into container (via SSM)
│   ├── restart        # Restart all instances
│   └── delete         # Delete a server
├── domain             # Domain management
│   ├── add            # Add custom domain
│   ├── list           # List all domains
│   ├── status         # Check DNS/SSL status
│   ├── renew-ssl      # Force SSL renewal
│   ├── dns-instructions # Show required DNS records
│   └── remove         # Remove domain binding
├── env                # Environment variable management
│   ├── set            # Set a variable
│   ├── get            # Get a variable's value
│   ├── list           # List all variables
│   ├── import         # Import from .env file
│   ├── export         # Export to .env file
│   └── unset          # Remove a variable
├── logs               # Log streaming
│   ├── (default)      # Stream logs in real-time
│   ├── --resource     # Filter by resource name
│   ├── --severity     # Filter by log level
│   └── --since        # Start time filter
├── package            # Export project infrastructure
│   ├── --everything   # Include code, data, secrets, config
│   ├── --config-only  # Export only configuration
│   └── --data-only    # Export only data snapshots
├── import             # Restore from package
│   ├── --file         # Path to .zip archive
│   └── --dry-run      # Preview what will be created
├── status             # Show project status summary
├── whoami             # Show current user and project
└── version            # Show CLI version
```

#### 5.8.2 Configuration File

The CLI stores project linkage in `.capsule/config.json`:

```json
{
  "projectId": "proj_a1b2c3d4e5f6",
  "apiEndpoint": "https://capsule.example.com/api",
  "region": "us-east-1",
  "defaultDeployType": "server",
  "createdAt": "2026-05-26T08:00:00Z"
}
```

This file is auto-generated by `capsule init` or `capsule link` and **should be committed to version control** so that all team members target the same project.

#### 5.8.3 Authentication Flow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as capsule CLI
    participant Browser
    participant API as Capsule API

    Dev->>CLI: capsule login
    CLI->>Browser: Open https://capsule.example.com/auth/device
    Browser->>API: POST /auth/device/code
    API-->>Browser: Display code: ABCD-1234
    Dev->>Browser: Confirm code
    Browser->>API: POST /auth/device/confirm
    API-->>CLI: Return JWT (via polling)
    CLI->>CLI: Store token in ~/.capsule/credentials
    CLI-->>Dev: ✅ Authenticated as user@example.com
```

---

### 5.9 Feature 8 — Cloud Builds

#### 5.9.1 Design Principle

> **Nothing is built on the developer's machine.** Source code is uploaded, built in the cloud, and deployed from there. This guarantees reproducibility and eliminates "works on my machine" issues.

#### 5.9.2 Build Pipeline

```mermaid
graph LR
    A[capsule deploy] --> B[Upload Source to S3]
    B --> C{Build Backend}
    C -->|CodeBuild| D[AWS CodeBuild]
    C -->|Internal| E[Capsule Build Worker]
    D --> F[Build Artifact in S3]
    E --> F
    F --> G{Deploy Target}
    G -->|Serverless| H[AWS Lambda]
    G -->|Server| I[ECR → EC2 / ASG]
    G -->|Worker| J[ECR → EC2]
    G -->|Cron| K[ECR → EC2 + CW Events]
```

#### 5.9.3 Build Configuration

Users can provide a `capsule.yaml` (or `capsule.json`) at the project root:

```yaml
# capsule.yaml
version: "1"
name: my-project

build:
  runtime: node20
  command: "npm run build"
  output: ".next"
  dockerfile: "Dockerfile"       # optional, overrides runtime-based build
  build_args:
    NODE_ENV: production
  cache:
    paths:
      - "node_modules"
      - ".next/cache"

deploy:
  type: server                   # server | worker | daemon | cron | serverless
  port: 3000
  health_check: "/api/health"
  replicas: 2
  instance_type: t3.small

env:
  - DATABASE_URL                 # pulled from Capsule env vars
  - REDIS_URL
  - API_SECRET

domains:
  - example.com
  - api.example.com
```

---

### 5.10 Feature 9 — Environment Variables

#### 5.10.1 Design

- Environment variables are stored in **Capsule's internal PostgreSQL** and synced to **AWS Secrets Manager**.
- They are **injected at deploy time** (baked into Lambda config or Docker container env).
- The dashboard and CLI provide full CRUD.
- Sensitive values are **never logged** and displayed as `••••••••` by default.

#### 5.10.2 CLI

```bash
# Set a single variable
capsule env set DATABASE_URL "postgres://user:pass@host:5432/db"

# Set multiple variables
capsule env set API_KEY=xxx SECRET=yyy

# List all variables (values masked)
capsule env list

# List with values revealed
capsule env list --show-values

# Get a single variable
capsule env get DATABASE_URL

# Import from .env file
capsule env import .env.production

# Export to file
capsule env export --output .env.local

# Unset a variable
capsule env unset OLD_VARIABLE
```

#### 5.10.3 Variable Scoping

| Scope              | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| Project-global      | Available to all resources within the project                       |
| Resource-specific   | Overrides project-global for a specific resource (e.g., `my-worker`)|
| Build-only          | Available during build but not at runtime (`CAPSULE_BUILD_*`)       |

---

### 5.11 Feature 10 — Package / Export & Import / Restore

#### 5.11.1 Package Command

```bash
# Export everything (config + data + code + secrets)
capsule package --everything --output backup-2026-05-26.zip

# Export only configuration (no data dumps)
capsule package --config-only

# Export only data (database snapshots + Redis RDB)
capsule package --data-only
```

#### 5.11.2 Archive Structure

```
backup-2026-05-26.zip (AES-256 encrypted)
├── manifest.json              # Archive metadata, version, checksums
├── config/
│   ├── project.json           # Project configuration
│   ├── databases.json         # Database definitions
│   ├── redis.json             # Redis instances
│   ├── domains.json           # Domain bindings
│   ├── servers.json           # Server configurations
│   ├── env_vars.json.enc      # Encrypted environment variables
│   └── capsule.yaml           # Build/deploy configuration
├── data/
│   ├── postgres_mydb.sql.gz   # pg_dump compressed
│   ├── mysql_mydb.sql.gz      # mysqldump compressed
│   ├── mongo_mydb.bson.gz     # mongodump compressed
│   └── redis_mycache.rdb      # Redis RDB snapshot
├── code/
│   └── source.tar.gz          # Latest deployed source code
└── iam/
    └── policies.json          # IAM policy documents for re-creation
```

#### 5.11.3 Import Command

```bash
# Import and restore (interactive)
capsule import --file backup-2026-05-26.zip

# Dry run — preview what will be created
capsule import --file backup-2026-05-26.zip --dry-run

# Import to a different region
capsule import --file backup-2026-05-26.zip --region eu-west-1
```

#### 5.11.4 Import Flow

```mermaid
graph TD
    A[capsule import --file backup.zip] --> B[Decrypt Archive]
    B --> C[Parse manifest.json]
    C --> D[Validate checksums]
    D --> E{Dry run?}
    E -->|Yes| F[Print plan & exit]
    E -->|No| G[Create Project]
    G --> H[Provision Databases]
    H --> I[Restore Data Dumps]
    I --> J[Provision Redis]
    J --> K[Restore RDB Snapshots]
    K --> L[Configure Domains]
    L --> M[Set Environment Variables]
    M --> N[Deploy Code]
    N --> O[Provision Servers/Lambda]
    O --> P[Apply IAM Policies]
    P --> Q[Verify Health Checks]
    Q --> R[✅ Import Complete]
```

---

### 5.12 Feature 11 — Deploy History & Rollback

#### 5.12.1 Deploy Record

Every deployment creates an immutable record:

| Field             | Type       | Description                                    |
| ----------------- | ---------- | ---------------------------------------------- |
| `deploy_id`       | UUID       | Unique deploy identifier                       |
| `project_id`      | UUID       | Parent project                                 |
| `version`         | INT        | Monotonically increasing version number        |
| `commit_sha`      | STRING     | Git commit SHA (if available)                  |
| `commit_message`  | STRING     | Git commit message                             |
| `trigger`         | ENUM       | `cli`, `dashboard`, `webhook`, `rollback`      |
| `status`          | ENUM       | `building`, `deploying`, `live`, `failed`, `rolled_back` |
| `deploy_type`     | ENUM       | `serverless`, `server`, `worker`, `daemon`, `cron` |
| `build_logs_url`  | STRING     | S3 URL to build logs                           |
| `artifact_url`    | STRING     | S3 URL to build artifact                       |
| `duration_ms`     | INT        | Total deploy duration in milliseconds          |
| `created_at`      | TIMESTAMP  | Deployment start time                          |
| `promoted_at`     | TIMESTAMP  | Time the deploy became live                    |

#### 5.12.2 Rollback

```bash
# Rollback to the previous version
capsule deploy rollback

# Rollback to a specific version
capsule deploy rollback --to v5

# Rollback to a specific deploy ID
capsule deploy rollback --to deploy_abc123
```

Rollback re-deploys the **exact artifact** from the target version. No rebuild occurs. For serverless deploys, this updates the Lambda function's code pointer. For server deploys, this updates the ECR image tag in the ASG launch template and performs a rolling update.

---

### 5.13 Feature 12 — Real-Time Logs

#### 5.13.1 Architecture

```mermaid
graph LR
    subgraph Sources
        Lambda[Lambda Functions]
        Docker[Docker Containers]
        Build[Build Workers]
    end
    
    subgraph Collection
        FB[Fluent Bit / Vector]
    end
    
    subgraph Storage
        CWL[CloudWatch Logs]
        S3L[S3 Long-term Archive]
    end
    
    subgraph Delivery
        WS[WebSocket Server]
        SSE[SSE Endpoint]
    end
    
    Lambda --> FB
    Docker --> FB
    Build --> FB
    
    FB --> CWL
    FB --> S3L
    FB --> WS
    FB --> SSE
    
    WS --> Dashboard
    SSE --> CLI[CLI Streaming]
```

#### 5.13.2 CLI Log Streaming

```bash
# Stream all project logs
capsule logs

# Stream logs from a specific resource
capsule logs --resource my-server

# Filter by severity
capsule logs --severity error

# Historical logs (last 1 hour)
capsule logs --since 1h

# Follow mode with grep
capsule logs --resource my-worker | grep "payment"
```

#### 5.13.3 Log Retention

| Tier      | Retention           | Storage       |
| --------- | ------------------- | ------------- |
| Hot       | 7 days              | CloudWatch    |
| Warm      | 30 days             | S3 Standard   |
| Cold      | 90 days             | S3 Glacier    |
| Archive   | 1 year (optional)   | S3 Deep Archive|

---

## 6. User Stories & Use Cases

### 6.1 Epic 1 — Project Setup & Deployment

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-001 | As a developer, I want to initialize a Capsule project in my directory so that I can link my code to the platform.                       | P0       |
| US-002 | As a developer, I want to deploy my application with a single command so that I can iterate quickly.                                     | P0       |
| US-003 | As a developer, I want Capsule to build my code in the cloud so that I don't need Docker or build tools installed locally.               | P0       |
| US-004 | As a developer, I want to see a live URL after deploying so that I can share it immediately.                                             | P0       |
| US-005 | As a developer, I want to rollback to a previous deployment in under 30 seconds so that I can recover from bad deploys.                  | P0       |

### 6.2 Epic 2 — Database Management

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-010 | As a developer, I want to create a PostgreSQL database with one command so that I don't need to configure RDS manually.                  | P0       |
| US-011 | As a developer, I want to choose between Docker and Aurora Serverless mode so that I can optimize for cost or performance.               | P0       |
| US-012 | As a developer, I want the database connection string auto-injected as an environment variable so that I don't manage it manually.       | P1       |
| US-013 | As a developer, I want to create snapshots and restore from them so that I can protect against data loss.                                | P1       |
| US-014 | As a developer, I want to open a database shell from the CLI so that I can run queries without configuring a client.                     | P1       |

### 6.3 Epic 3 — Redis Management

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-020 | As a developer, I want to provision a Redis instance with one command so that I can add caching to my application immediately.           | P0       |
| US-021 | As a developer, I want to switch between Docker Redis and ElastiCache Serverless so that I can scale transparently.                      | P1       |
| US-022 | As a developer, I want to browse Redis keys from the dashboard so that I can debug caching issues visually.                              | P2       |

### 6.4 Epic 4 — Domain & SSL

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-030 | As a developer, I want to add a custom domain and get automatic HTTPS so that my application is secure from day one.                     | P0       |
| US-031 | As a developer, I want SSL certificates to auto-renew so that I never experience downtime from expired certs.                            | P0       |
| US-032 | As a developer, I want to see DNS propagation status so that I know when my domain changes are live.                                     | P1       |

### 6.5 Epic 5 — Environment Variables & Secrets

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-040 | As a developer, I want to manage environment variables from the CLI so that I don't store secrets in code.                               | P0       |
| US-041 | As a developer, I want variables auto-injected at deploy time so that my application picks them up without extra configuration.          | P0       |
| US-042 | As a developer, I want to import/export `.env` files so that I can easily migrate existing configuration.                                | P1       |

### 6.6 Epic 6 — Observability

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-050 | As a developer, I want to stream logs in real-time from the CLI so that I can debug production issues quickly.                           | P0       |
| US-051 | As a developer, I want to view logs in the dashboard with filters so that I can isolate specific error events.                           | P1       |
| US-052 | As a developer, I want to see resource metrics (CPU, memory, requests) in the dashboard so that I can monitor performance.               | P1       |

### 6.7 Epic 7 — Portability

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-060 | As a developer, I want to export my entire project as an encrypted archive so that I have a complete backup.                             | P1       |
| US-061 | As a developer, I want to import an archive to a new AWS account so that I can migrate or restore my infrastructure.                     | P1       |
| US-062 | As a developer, I want to run a dry-run import so that I can preview what will be created before committing.                             | P2       |

### 6.8 Epic 8 — Team & Security

| ID     | User Story                                                                                                                               | Priority |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| US-070 | As a team lead, I want each team member to have scoped IAM credentials so that no one has more access than needed.                       | P0       |
| US-071 | As a team lead, I want to see an audit log of all actions so that I can track who changed what.                                          | P1       |
| US-072 | As an admin, I want to enable MFA for the dashboard so that accounts are protected even if passwords are compromised.                    | P1       |

---

## 7. Functional Requirements

### 7.1 Authentication & Authorization

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-001  | The system SHALL support user registration with email and password.                                      | P0       |
| FR-002  | The system SHALL support OAuth 2.0 login via GitHub and Google.                                          | P1       |
| FR-003  | The system SHALL issue JWT access tokens (15 min TTL) and refresh tokens (7 day TTL).                    | P0       |
| FR-004  | The CLI SHALL implement device authorization flow (RFC 8628) for login.                                  | P0       |
| FR-005  | The system SHALL support TOTP-based multi-factor authentication.                                         | P1       |
| FR-006  | The system SHALL enforce role-based access control (RBAC) with roles: Owner, Admin, Developer, Viewer.   | P1       |
| FR-007  | The system SHALL generate scoped IAM sub-profiles for each project with least-privilege policies.        | P0       |

### 7.2 Project Management

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-010  | The system SHALL allow creating projects with a unique name and optional description.                    | P0       |
| FR-011  | The system SHALL generate a unique `projectId` (prefixed `proj_`) for each project.                      | P0       |
| FR-012  | The CLI SHALL store the `projectId` in `.capsule/config.json` upon `init` or `link`.                     | P0       |
| FR-013  | The system SHALL support multiple projects per user account.                                             | P0       |
| FR-014  | The system SHALL tag all AWS resources with `capsule:project-id` and `capsule:resource-type`.            | P0       |
| FR-015  | The system SHALL provide a project status summary showing all resources and their states.                | P0       |

### 7.3 Database Management

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-020  | The system SHALL support provisioning PostgreSQL 14–16, MySQL 8.0–8.4, and MongoDB 6.0–7.0 databases.   | P0       |
| FR-021  | The system SHALL support `--serverless` flag to provision Aurora Serverless v2 or DocumentDB Elastic.    | P0       |
| FR-022  | Without `--serverless`, the system SHALL provision databases as Docker containers on EC2 with EBS.       | P0       |
| FR-023  | The system SHALL store database credentials in AWS Secrets Manager.                                      | P0       |
| FR-024  | The system SHALL auto-inject `DATABASE_URL` into the project's environment variables.                    | P1       |
| FR-025  | The system SHALL support point-in-time snapshots (pg_dump / mysqldump / mongodump for containers; RDS snapshots for serverless). | P1 |
| FR-026  | The system SHALL support restoring databases from snapshots.                                              | P1       |
| FR-027  | The system SHALL support scaling CPU, memory (container mode) and min/max ACU (serverless mode).         | P1       |
| FR-028  | The system SHALL support opening interactive database shells through the CLI via SSM port forwarding.    | P1       |
| FR-029  | The system SHALL display database metrics from CloudWatch in the dashboard.                              | P1       |

### 7.4 Redis Management

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-030  | The system SHALL support provisioning Redis instances in Docker container mode.                           | P0       |
| FR-031  | The system SHALL support `--serverless` flag to provision ElastiCache Serverless for Redis.               | P0       |
| FR-032  | The system SHALL auto-inject `REDIS_URL` into the project's environment variables.                       | P1       |
| FR-033  | The system SHALL support opening a `redis-cli` shell through the CLI.                                    | P1       |
| FR-034  | The system SHALL support flushing all keys with an explicit confirmation flag.                            | P1       |
| FR-035  | The dashboard SHALL provide a paginated key browser with pattern search.                                 | P2       |

### 7.5 Domain & SSL Management

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-040  | The system SHALL support binding custom domains (apex and subdomains) to any Capsule resource.           | P0       |
| FR-041  | The system SHALL automatically provision TLS certificates via Let's Encrypt using DNS-01 challenge.      | P0       |
| FR-042  | The system SHALL support wildcard certificates (`*.example.com`).                                        | P1       |
| FR-043  | The system SHALL auto-renew certificates 30 days before expiry.                                          | P0       |
| FR-044  | The system SHALL create/update Route 53 DNS records (A, AAAA, CNAME).                                   | P0       |
| FR-045  | The system SHALL provide DNS propagation status checking.                                                | P1       |
| FR-046  | The system SHALL output required DNS records for external DNS providers.                                 | P1       |
| FR-047  | The system SHALL configure Traefik to hot-reload TLS certificates without downtime.                      | P0       |

### 7.6 Serverless Deployments

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-050  | The system SHALL support deploying functions to AWS Lambda with `--serverless` flag.                      | P0       |
| FR-051  | The system SHALL support runtimes: Node.js (18/20/22), Python (3.11/3.12/3.13), Go (1.22+), Rust.       | P0       |
| FR-052  | The system SHALL create API Gateway v2 (HTTP API) endpoints for Lambda functions.                        | P0       |
| FR-053  | The system SHALL support custom Dockerfile-based Lambda deployments.                                     | P1       |
| FR-054  | The system SHALL inject environment variables into Lambda function configuration.                        | P0       |
| FR-055  | The system SHALL support CloudFront CDN integration for serverless deployments.                           | P2       |
| FR-056  | The system SHALL support cold start optimization (provisioned concurrency configuration).                | P2       |

### 7.7 24/7 Server Deployments

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-060  | The system SHALL support deploying persistent containers (server, worker, daemon, cron) on EC2.          | P0       |
| FR-061  | The system SHALL build Docker images and push them to ECR.                                               | P0       |
| FR-062  | The system SHALL provision an ALB + Target Group for `server` type deployments.                          | P0       |
| FR-063  | The system SHALL provision an Auto Scaling Group with configurable min/max/desired capacity.             | P0       |
| FR-064  | The system SHALL support rolling updates as the default deployment strategy.                             | P0       |
| FR-065  | The system SHALL support blue/green deployment strategy.                                                 | P1       |
| FR-066  | The system SHALL support canary deployment strategy with traffic percentage routing.                     | P2       |
| FR-067  | The system SHALL support cron job scheduling via CloudWatch Events / EventBridge.                        | P1       |
| FR-068  | The system SHALL support SSH into running containers via AWS SSM Session Manager.                        | P1       |
| FR-069  | The system SHALL support health check configuration for ALB target groups.                               | P0       |

### 7.8 Cloud Build System

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-070  | The system SHALL build all code remotely — no local builds.                                              | P0       |
| FR-071  | The system SHALL support AWS CodeBuild as the primary build backend.                                     | P0       |
| FR-072  | The system SHALL support an internal build worker as a fallback build backend.                            | P1       |
| FR-073  | The system SHALL support build caching (layer caching, dependency caching) to reduce build times.        | P1       |
| FR-074  | The system SHALL stream build logs in real-time to the CLI and dashboard.                                | P0       |
| FR-075  | The system SHALL store build artifacts in S3 with versioned keys.                                        | P0       |
| FR-076  | The system SHALL support `capsule.yaml` / `capsule.json` for build configuration.                       | P0       |
| FR-077  | The system SHALL auto-detect runtime and build commands if no configuration file is present.             | P1       |

### 7.9 Environment Variables

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-080  | The system SHALL support CRUD operations for environment variables via CLI and dashboard.                | P0       |
| FR-081  | The system SHALL store environment variables encrypted at rest (AES-256).                                | P0       |
| FR-082  | The system SHALL sync environment variables to AWS Secrets Manager.                                      | P0       |
| FR-083  | The system SHALL inject environment variables at deploy time (not stored in code or images).             | P0       |
| FR-084  | The system SHALL support project-global and resource-specific variable scoping.                          | P1       |
| FR-085  | The system SHALL support bulk import from `.env` files.                                                  | P1       |
| FR-086  | The system SHALL mask variable values by default in CLI output and dashboard UI.                         | P0       |
| FR-087  | The system SHALL support a `--show-values` / reveal toggle for authorized users.                        | P0       |

### 7.10 Package / Export & Import / Restore

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-090  | The system SHALL support exporting project configuration, data, code, and secrets to a single `.zip`.    | P1       |
| FR-091  | The system SHALL encrypt archives with AES-256-GCM using a user-provided or auto-generated passphrase.  | P1       |
| FR-092  | The archive SHALL include a `manifest.json` with checksums (SHA-256) for integrity verification.        | P1       |
| FR-093  | The system SHALL support `--everything`, `--config-only`, and `--data-only` export modes.                | P1       |
| FR-094  | The system SHALL support importing an archive to the same or a different AWS account/region.             | P1       |
| FR-095  | The system SHALL support `--dry-run` import to preview resource creation.                                | P1       |
| FR-096  | The system SHALL validate archive integrity (checksums) before starting import.                          | P1       |

### 7.11 Deploy History & Rollback

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-100  | The system SHALL maintain an immutable log of all deployments.                                           | P0       |
| FR-101  | Each deploy record SHALL include: version, commit SHA, status, build logs URL, artifact URL, duration.   | P0       |
| FR-102  | The system SHALL support rollback to any previous successful deployment.                                 | P0       |
| FR-103  | Rollback SHALL re-deploy the exact artifact without rebuilding.                                          | P0       |
| FR-104  | The system SHALL mark rolled-back deployments with `rolled_back` status.                                 | P0       |

### 7.12 Real-Time Logs

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-110  | The system SHALL collect logs from Lambda, Docker containers, and build workers via Fluent Bit or Vector.| P0       |
| FR-111  | The system SHALL stream logs to the dashboard via WebSocket.                                             | P0       |
| FR-112  | The system SHALL stream logs to the CLI via streaming HTTP (SSE or chunked transfer).                    | P0       |
| FR-113  | The system SHALL support filtering logs by resource, severity, and time range.                           | P1       |
| FR-114  | The system SHALL store logs in CloudWatch (7 days), S3 Standard (30 days), S3 Glacier (90 days).        | P1       |
| FR-115  | The system SHALL support log search with full-text queries.                                              | P2       |

### 7.13 Dashboard

| ID      | Requirement                                                                                              | Priority |
| ------- | -------------------------------------------------------------------------------------------------------- | -------- |
| FR-120  | The dashboard SHALL provide a project list with status, resource count, and last deploy time.            | P0       |
| FR-121  | The dashboard SHALL provide a project detail view with resource cards and deploy timeline.               | P0       |
| FR-122  | The dashboard SHALL provide CRUD interfaces for databases, Redis, domains, servers, and env vars.        | P0       |
| FR-123  | The dashboard SHALL provide a real-time log viewer with filters.                                         | P0       |
| FR-124  | The dashboard SHALL provide a deploy history view with rollback buttons.                                 | P0       |
| FR-125  | The dashboard SHALL provide resource metrics (CPU, memory, requests, latency) via CloudWatch.            | P1       |
| FR-126  | The dashboard SHALL be responsive (mobile-friendly).                                                     | P2       |
| FR-127  | The dashboard SHALL support dark mode.                                                                   | P2       |

---

## 8. Non-Functional Requirements

### 8.1 Performance

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-001 | API response time for CRUD operations                                                    | p95 < 200 ms      |
| NFR-002 | CLI command cold-start time (first execution)                                            | < 500 ms          |
| NFR-003 | Time from `capsule deploy` to live URL (serverless)                                      | < 90 seconds      |
| NFR-004 | Time from `capsule deploy` to live URL (server, first deploy)                            | < 5 minutes       |
| NFR-005 | Time from `capsule deploy` to live URL (server, subsequent deploys)                      | < 2 minutes       |
| NFR-006 | Dashboard initial page load (LCP)                                                        | < 1.5 seconds     |
| NFR-007 | WebSocket log latency (event to display)                                                 | < 500 ms          |
| NFR-008 | Rollback execution time                                                                  | < 30 seconds      |
| NFR-009 | Database provisioning time (container mode)                                              | < 60 seconds      |
| NFR-010 | Database provisioning time (serverless mode)                                             | < 5 minutes       |

### 8.2 Scalability

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-020 | Concurrent projects per Capsule installation                                             | ≥ 100             |
| NFR-021 | Concurrent deployments                                                                   | ≥ 10              |
| NFR-022 | Concurrent WebSocket connections for log streaming                                       | ≥ 500             |
| NFR-023 | Resources per project (databases + Redis + servers + domains)                            | ≥ 50              |
| NFR-024 | Environment variables per project                                                        | ≥ 500             |
| NFR-025 | Deploy history retention                                                                 | ≥ 1,000 per project|

### 8.3 Reliability

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-030 | Capsule control plane availability                                                       | 99.9 % uptime     |
| NFR-031 | Data durability for database backups                                                     | 99.999999999 % (S3)|
| NFR-032 | Zero data loss for environment variable storage                                          | PostgreSQL + WAL   |
| NFR-033 | Graceful degradation if CloudWatch is unavailable                                        | Logs buffered locally|
| NFR-034 | Auto-recovery of Capsule API after crash                                                 | < 30 seconds (systemd/Docker restart) |

### 8.4 Security

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-040 | All API communication encrypted in transit                                               | TLS 1.2+          |
| NFR-041 | All secrets encrypted at rest                                                            | AES-256-GCM       |
| NFR-042 | IAM policies follow principle of least privilege                                         | Zero over-provisioning |
| NFR-043 | JWT tokens are short-lived with refresh rotation                                         | 15 min / 7 days   |
| NFR-044 | Rate limiting on all public API endpoints                                                | 100 req/s per user|
| NFR-045 | OWASP Top 10 compliance                                                                  | Full compliance   |
| NFR-046 | Dependency vulnerability scanning in CI                                                  | Zero critical CVEs|

### 8.5 Maintainability

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-050 | Code test coverage (backend)                                                             | ≥ 80 %            |
| NFR-051 | Code test coverage (CLI)                                                                 | ≥ 75 %            |
| NFR-052 | API documentation (OpenAPI 3.1)                                                          | 100 % of endpoints|
| NFR-053 | CLI help text for every command and flag                                                  | 100 % coverage    |

### 8.6 Compatibility

| ID      | Requirement                                                                              | Target            |
| ------- | ---------------------------------------------------------------------------------------- | ----------------- |
| NFR-060 | CLI supported platforms                                                                  | Linux (amd64/arm64), macOS (amd64/arm64), Windows (amd64) |
| NFR-061 | Dashboard browser support                                                                | Chrome, Firefox, Safari, Edge (last 2 versions) |
| NFR-062 | AWS regions supported                                                                    | All commercial regions |

---

## 9. System Architecture Overview

### 9.1 High-Level Architecture

```mermaid
graph TB
    subgraph Developer Machine
        CLI[Capsule CLI<br/>Go + Cobra]
        Browser[Web Browser]
    end
    
    subgraph Capsule Control Plane
        Traefik[Traefik<br/>Reverse Proxy + SSL]
        API[Capsule API<br/>Go + Fiber/Echo]
        Dashboard[Dashboard<br/>Next.js 14+]
        WS[WebSocket Server<br/>gorilla/websocket]
        BuildWorker[Build Worker<br/>Go Service]
        
        subgraph Internal Data
            PG[(PostgreSQL<br/>Metadata Store)]
            RD[(Redis<br/>Sessions + Queues)]
        end
        
        subgraph Log Pipeline
            FB[Fluent Bit / Vector]
        end
    end
    
    subgraph AWS Services - User Account
        subgraph Compute
            EC2[EC2 Instances]
            Lambda[Lambda Functions]
            ASG_ALB[ASG + ALB]
        end
        
        subgraph Data
            Aurora[Aurora Serverless v2]
            DocDB[DocumentDB]
            ElastiCache[ElastiCache Serverless]
        end
        
        subgraph Networking
            R53[Route 53]
            CF[CloudFront]
            APIGW[API Gateway v2]
        end
        
        subgraph Storage & Build
            S3[S3 Buckets]
            ECR[ECR Registry]
            CB[CodeBuild]
        end
        
        subgraph Observability
            CWL[CloudWatch Logs]
            CWM[CloudWatch Metrics]
        end
        
        subgraph Security
            IAM[IAM Roles/Policies]
            SM[Secrets Manager]
        end
    end
    
    CLI -->|HTTPS| Traefik
    Browser -->|HTTPS| Traefik
    Traefik --> API
    Traefik --> Dashboard
    Traefik --> WS
    
    API --> PG
    API --> RD
    API --> S3
    API --> ECR
    API --> CB
    API --> Lambda
    API --> Aurora
    API --> DocDB
    API --> ElastiCache
    API --> R53
    API --> IAM
    API --> SM
    API --> ASG_ALB
    API --> EC2
    API --> APIGW
    API --> CF
    
    WS --> FB
    FB --> CWL
    FB --> S3
    
    BuildWorker --> S3
    BuildWorker --> ECR
    
    CWM -.-> API
```

### 9.2 Component Responsibilities

| Component           | Responsibility                                                                       |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Capsule API**     | Core business logic, resource orchestration, AWS SDK calls, authentication           |
| **Dashboard**       | Server-rendered UI, client-side interactivity, real-time subscriptions               |
| **CLI**             | Local developer experience, project linking, source upload, log streaming            |
| **Traefik**         | TLS termination, reverse proxy, Let's Encrypt ACME, routing                          |
| **WebSocket Server**| Bi-directional real-time communication for logs, status, notifications               |
| **Build Worker**    | Fallback build execution when CodeBuild is not preferred                              |
| **Fluent Bit / Vector** | Log collection, transformation, and routing from all compute sources             |
| **PostgreSQL**      | Persistent metadata: users, projects, resources, deploy history, env vars            |
| **Redis**           | Session store, job queues, rate limiting counters, pub/sub for real-time events       |

### 9.3 Network Architecture

```mermaid
graph TB
    subgraph VPC[Capsule VPC - 10.0.0.0/16]
        subgraph Public Subnets
            ALB_PUB[ALB / Traefik<br/>10.0.1.0/24]
            NAT[NAT Gateway<br/>10.0.2.0/24]
        end
        
        subgraph Private Subnets - Compute
            API_SUB[Capsule API<br/>10.0.10.0/24]
            BUILD_SUB[Build Workers<br/>10.0.11.0/24]
            USER_COMPUTE[User Containers<br/>10.0.12.0/24]
        end
        
        subgraph Private Subnets - Data
            DB_SUB[Databases<br/>10.0.20.0/24]
            CACHE_SUB[Redis / ElastiCache<br/>10.0.21.0/24]
        end
    end
    
    Internet[Internet] --> ALB_PUB
    ALB_PUB --> API_SUB
    ALB_PUB --> USER_COMPUTE
    API_SUB --> DB_SUB
    API_SUB --> CACHE_SUB
    USER_COMPUTE --> DB_SUB
    USER_COMPUTE --> CACHE_SUB
    API_SUB --> NAT
    BUILD_SUB --> NAT
    NAT --> Internet
```

---

## 10. Technology Stack

### 10.1 Backend

| Layer             | Technology                          | Rationale                                                          |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Language          | Go 1.22+                           | Single binary, fast startup, excellent concurrency, AWS SDK v2     |
| HTTP Framework    | Fiber v2 or Echo v4                 | High-performance, familiar middleware pattern                      |
| ORM / DB Driver   | sqlc + pgx v5                      | Type-safe SQL, no runtime reflection overhead                      |
| Authentication    | Custom JWT (golang-jwt/jwt)        | Full control over token lifecycle, no external auth service needed |
| AWS Integration   | AWS SDK for Go v2                   | Native, strongly-typed AWS API calls                               |
| WebSocket         | gorilla/websocket                   | De facto standard for Go WebSocket                                 |
| Task Queue        | Redis Streams or Asynq              | Lightweight, no additional infrastructure                          |
| Configuration     | Viper + envconfig                   | Hierarchical config: file, env, flags                              |
| Logging           | zerolog or slog                     | Structured JSON logging, zero-allocation                           |

### 10.2 Frontend (Dashboard)

| Layer             | Technology                          | Rationale                                                          |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Framework         | Next.js 14+ (App Router)           | Server components, streaming, built-in API routes                  |
| Language          | TypeScript 5+                       | Type safety, IDE support, refactoring confidence                   |
| UI Components     | shadcn/ui + Radix                   | Accessible, composable, no vendor lock-in (code lives in project)  |
| Styling           | Tailwind CSS 3.4+                   | Utility-first, design system consistency, purged in production     |
| State Management  | React Query (TanStack Query v5)    | Server state caching, optimistic updates, auto-refetch             |
| Real-time         | WebSocket (native) + React hooks   | Dashboard log streaming, deploy status updates                     |
| Charts / Metrics  | Recharts or Tremor                  | Lightweight, React-native charting for CloudWatch metrics          |
| Forms             | React Hook Form + Zod              | Validated forms for resource creation, env vars, settings          |
| Tables            | TanStack Table v8                   | Sortable, filterable, paginated resource tables                    |
| Notifications     | Sonner                              | Toast notifications for async operation results                    |

### 10.3 CLI

| Layer             | Technology                          | Rationale                                                          |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Language          | Go 1.22+                           | Same as backend; shared types, single binary distribution          |
| CLI Framework     | Cobra + Viper                       | Industry standard; subcommands, flags, auto-completion, man pages  |
| Output Formatting | lipgloss + table                   | Beautiful terminal output, colored status badges                   |
| HTTP Client       | net/http + retryablehttp           | Built-in, no dependencies; retry with exponential backoff          |
| Config Storage    | JSON file (`~/.capsule/credentials`)| Simple, portable credential storage                                |
| Progress          | progressbar or spinner             | Visual feedback for uploads, builds, deploys                       |
| Log Streaming     | SSE client (custom)                | Streaming HTTP for real-time log output                            |

### 10.4 Infrastructure

| Component         | Technology                          | Rationale                                                          |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Reverse Proxy     | Traefik v3                          | Auto-discovery, Let's Encrypt integration, dynamic configuration   |
| Containerization  | Docker + Docker Compose             | Standard container runtime for Capsule itself and user workloads   |
| Container Registry| Amazon ECR                          | Private registry in user's AWS account                             |
| Build System      | AWS CodeBuild + internal worker     | Remote builds, pay-per-use, Docker layer caching                   |
| Object Storage    | Amazon S3                           | Build artifacts, logs, backups, archives                           |
| DNS               | Amazon Route 53                     | Programmatic DNS management, health checks                         |
| CDN               | Amazon CloudFront                   | Edge caching for serverless functions and static assets            |
| Secrets           | AWS Secrets Manager                 | Native secret rotation, IAM-scoped access                          |
| Monitoring        | Amazon CloudWatch                   | Logs, metrics, alarms — already in user's account                  |
| Log Collection    | Fluent Bit or Vector                | Lightweight, multi-destination log routing                         |
| Encryption        | AES-256-GCM (Go `crypto/aes`)     | Backup archive encryption, env var encryption at rest              |

### 10.5 AWS Services Summary

| Service                   | Usage in Capsule                                                 |
| ------------------------- | ---------------------------------------------------------------- |
| **EC2**                   | User containers (server/worker/daemon), Capsule API host         |
| **Lambda**                | Serverless function deployments                                  |
| **API Gateway v2**        | HTTP API endpoints for Lambda functions                          |
| **ECR**                   | Docker image storage for user container deployments              |
| **Route 53**              | DNS record management, domain routing                            |
| **CloudWatch**            | Logs, metrics, alarms, event scheduling                          |
| **CodeBuild**             | Remote code builds (primary build backend)                       |
| **S3**                    | Build artifacts, log archives, backup archives                   |
| **IAM**                   | User-scoped policies, service roles, instance profiles           |
| **ASG**                   | Auto-scaling for user server deployments                         |
| **ALB**                   | Load balancing for user server deployments                       |
| **Aurora Serverless v2**  | Managed PostgreSQL/MySQL (when `--serverless` flag is used)      |
| **DocumentDB**            | Managed MongoDB-compatible (when `--serverless` flag is used)    |
| **ElastiCache Serverless**| Managed Redis (when `--serverless` flag is used)                 |
| **CloudFront**            | CDN for serverless deployments and static assets                 |
| **Secrets Manager**       | Database credentials, environment variable sync                  |
| **SSM Session Manager**   | Secure SSH access to user containers                             |
| **EventBridge**           | Cron job scheduling, event-driven triggers                       |
| **ACM**                   | Backup certificate provider (ALB/CloudFront TLS)                |

---

## 11. Security Requirements

### 11.1 IAM Security Model

```mermaid
graph TD
    subgraph Capsule IAM Hierarchy
        Root[AWS Root Account<br/>❌ Never used at runtime]
        Admin[CapsuleAdmin IAM User<br/>Initial setup only]
        
        subgraph Service Roles
            APIRole[CapsuleAPIRole<br/>API server operations]
            BuildRole[CapsuleBuildRole<br/>CodeBuild operations]
            LambdaRole[CapsuleLambdaExecRole<br/>Lambda execution]
        end
        
        subgraph Project-Scoped Policies
            P1[Project A Policy<br/>Scoped to project resources]
            P2[Project B Policy<br/>Scoped to project resources]
        end
    end
    
    Root -.->|One-time setup| Admin
    Admin -->|Creates| APIRole
    Admin -->|Creates| BuildRole
    Admin -->|Creates| LambdaRole
    APIRole -->|Assumes per project| P1
    APIRole -->|Assumes per project| P2
```

### 11.2 Security Controls

| Area                       | Control                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **Authentication**         | JWT with RS256 signing, refresh token rotation, MFA (TOTP)                                  |
| **Authorization**          | RBAC (Owner, Admin, Developer, Viewer), resource-level ACLs                                 |
| **Network**                | Private subnets for data, security groups with least-privilege rules, no public DB endpoints |
| **Secrets**                | AWS Secrets Manager, encrypted at rest (KMS), never logged, never in container images       |
| **Data in transit**        | TLS 1.2+ enforced on all endpoints (API, dashboard, database connections)                   |
| **Data at rest**           | EBS encryption, S3 SSE-KMS, RDS encryption, AES-256-GCM for backups                        |
| **Audit logging**          | All mutations logged with user ID, timestamp, resource, and action                          |
| **Dependency scanning**    | Automated CVE scanning in CI (govulncheck for Go, npm audit for Next.js)                    |
| **Container security**     | Non-root containers, read-only filesystem where possible, resource limits                   |
| **Rate limiting**          | Token bucket per user (100 req/s), per IP (50 req/s), burst allowance                       |
| **CORS**                   | Strict origin allowlist, no wildcard in production                                           |
| **CSP**                    | Content Security Policy headers on dashboard                                                |
| **Input validation**       | Server-side validation on all inputs, parameterized SQL queries (sqlc)                      |

### 11.3 Encryption Standards

| Data Type                  | Encryption Method        | Key Management       |
| -------------------------- | ------------------------ | -------------------- |
| API traffic                | TLS 1.2+ (ECDHE+AES)   | Let's Encrypt / ACM  |
| Database credentials       | AES-256 via KMS          | AWS KMS CMK          |
| Environment variables      | AES-256-GCM              | Capsule master key   |
| Backup archives            | AES-256-GCM              | User passphrase / PBKDF2 |
| EBS volumes                | AES-256                  | AWS managed key      |
| S3 objects                 | SSE-KMS                  | AWS KMS CMK          |
| RDS / Aurora storage       | AES-256                  | AWS managed key      |

---

## 12. Success Metrics / KPIs

### 12.1 Product Metrics

| Metric                                      | Measurement                                          | Target (6 months)   |
| ------------------------------------------- | ---------------------------------------------------- | ------------------- |
| Time to first deploy (new user)             | Time from CLI install to first live URL               | < 10 minutes        |
| Deploy success rate                         | % of deploys that reach `live` status                 | ≥ 98 %              |
| Rollback success rate                       | % of rollbacks that restore service                   | 100 %               |
| Mean deploy time (serverless)               | `capsule deploy --serverless` to live URL             | < 90 seconds        |
| Mean deploy time (server)                   | `capsule deploy` to live URL                          | < 3 minutes         |
| Package/Import round-trip                   | Export + Import to new account                        | < 15 minutes        |
| Resource provisioning time (DB)             | `capsule db create` to `running` status               | < 2 minutes         |
| CLI command error rate                      | % of CLI commands that return non-transient errors    | < 2 %               |

### 12.2 Engineering Metrics

| Metric                                      | Measurement                                          | Target              |
| ------------------------------------------- | ---------------------------------------------------- | ------------------- |
| API p95 latency                             | 95th percentile response time                         | < 200 ms            |
| Control plane uptime                        | Monthly availability percentage                       | ≥ 99.9 %            |
| Build test coverage (backend)               | Line coverage percentage                              | ≥ 80 %              |
| Open critical bugs                          | Count of P0/P1 bugs in backlog                        | 0                   |
| Mean time to recovery (MTTR)                | Time from incident detection to resolution            | < 30 minutes        |
| Deployment frequency (Capsule itself)       | Releases per week                                     | ≥ 2                 |

### 12.3 Adoption Metrics

| Metric                                      | Measurement                                          | Target (12 months)  |
| ------------------------------------------- | ---------------------------------------------------- | ------------------- |
| GitHub stars                                | Cumulative stars on the repository                    | ≥ 1,000             |
| Active installations                        | Unique Capsule instances sending telemetry (opt-in)   | ≥ 200               |
| Community contributions                     | PRs merged from external contributors                 | ≥ 50                |
| Documentation coverage                      | % of features with published documentation            | 100 %               |

---

## 13. Release Phases

### 13.1 Phase Overview

```mermaid
gantt
    title Capsule Release Roadmap
    dateFormat  YYYY-MM-DD
    axisFormat  %b %Y
    
    section MVP (v0.1)
    Core API & Auth               :a1, 2026-06-01, 30d
    CLI (login, init, deploy)     :a2, 2026-06-15, 30d
    Server deployments (Docker)   :a3, 2026-06-15, 45d
    PostgreSQL (container mode)   :a4, 2026-07-01, 21d
    Redis (container mode)        :a5, 2026-07-01, 14d
    Basic Dashboard               :a6, 2026-07-01, 45d
    Cloud builds (CodeBuild)      :a7, 2026-07-15, 21d
    Env var management            :a8, 2026-07-15, 14d
    MVP Release                   :milestone, m1, 2026-08-15, 0d
    
    section v1.0
    Domain management + SSL       :b1, 2026-08-16, 30d
    Serverless deployments        :b2, 2026-08-16, 45d
    Deploy history + rollback     :b3, 2026-09-01, 21d
    Real-time logs (WS + SSE)    :b4, 2026-09-01, 30d
    MySQL & MongoDB support       :b5, 2026-09-15, 21d
    Dashboard polish              :b6, 2026-09-15, 30d
    v1.0 Release                  :milestone, m2, 2026-10-15, 0d
    
    section v1.5
    --serverless flag (Aurora)    :c1, 2026-10-16, 30d
    --serverless flag (ElastiCache):c2, 2026-10-16, 21d
    Package / Export              :c3, 2026-11-01, 21d
    Import / Restore              :c4, 2026-11-15, 21d
    Blue/Green deployments        :c5, 2026-11-01, 30d
    Team management + RBAC        :c6, 2026-11-01, 30d
    v1.5 Release                  :milestone, m3, 2026-12-15, 0d
    
    section v2.0
    Canary deployments            :d1, 2027-01-01, 30d
    Multi-region support          :d2, 2027-01-01, 45d
    Audit logging                 :d3, 2027-01-15, 21d
    CloudFront CDN integration    :d4, 2027-02-01, 21d
    Plugin / extension system     :d5, 2027-02-01, 45d
    v2.0 Release                  :milestone, m4, 2027-03-15, 0d
```

### 13.2 Phase Details

#### MVP (v0.1) — Target: August 2026

| Feature                  | Scope                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| Authentication           | Email/password, JWT, CLI device flow                                         |
| Project management       | Create, list, delete projects; `capsule init`, `capsule link`                |
| Server deployments       | Docker containers on EC2, single instance, basic ALB                         |
| PostgreSQL               | Container mode only, create, list, info, shell, delete                       |
| Redis                    | Container mode only, create, list, info, shell, delete                       |
| Cloud builds             | AWS CodeBuild integration, Dockerfile support                                |
| Env vars                 | Set, get, list, unset via CLI; injected at deploy time                       |
| Dashboard                | Login, project list, project detail, basic resource views                     |
| CLI                      | `login`, `init`, `link`, `deploy`, `db`, `redis`, `env`, `status`, `whoami` |

> **MVP exit criteria:** A developer can `capsule init` → `capsule db create` → `capsule deploy` and get a working app with a database, accessible via a public URL, in under 10 minutes.

#### v1.0 — Target: October 2026

| Feature                  | Scope                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| Domain management        | Add domains, auto SSL (Let's Encrypt), Route 53 integration                  |
| Serverless deployments   | Lambda + API Gateway, Node.js and Python runtimes                            |
| Deploy history           | Full history with version numbers, commit SHAs, build logs                   |
| Rollback                 | One-command rollback to any previous version                                 |
| Real-time logs           | WebSocket streaming for dashboard, SSE for CLI                               |
| MySQL & MongoDB          | Container mode support for MySQL 8.0 and MongoDB 7.0                         |
| Dashboard                | Deploy history view, rollback UI, log viewer, domain management              |
| CLI                      | `domain`, `logs`, `deploy list`, `deploy rollback`                           |

#### v1.5 — Target: December 2026

| Feature                  | Scope                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| `--serverless` flag      | Aurora Serverless v2 (PostgreSQL/MySQL), ElastiCache Serverless, DocumentDB  |
| Package / Export         | `capsule package --everything`, AES-256 encrypted archives                   |
| Import / Restore         | `capsule import --file`, dry-run mode, cross-region import                   |
| Blue/Green deploys       | Swap-based deployments with zero downtime                                    |
| Team management          | Invite members, RBAC roles (Owner, Admin, Developer, Viewer)                 |
| Auto-scaling             | ASG configuration via CLI and dashboard, CPU-based scaling policies          |
| Go & Rust runtimes       | Serverless support for Go and Rust Lambda functions                          |
| Dashboard                | Team settings, backup/export UI, scaling configuration                       |

#### v2.0 — Target: March 2027

| Feature                  | Scope                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| Canary deployments       | Traffic percentage routing with automatic rollback                           |
| Multi-region             | Deploy resources across multiple AWS regions                                 |
| Audit logging            | Complete audit trail of all mutations, exportable                            |
| CloudFront CDN           | One-click CDN for serverless and static deployments                          |
| Plugin system            | Extension points for custom build steps, deploy hooks, notifications         |
| MFA                      | TOTP-based multi-factor authentication                                       |
| OAuth providers          | GitHub and Google OAuth login                                                |
| Advanced metrics         | Custom dashboards, cost estimation, budget alerts                            |

---

## 14. Risks & Mitigations

| #    | Risk                                                        | Probability | Impact  | Mitigation                                                                                                       |
| ---- | ----------------------------------------------------------- | ----------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| R-01 | **AWS API rate limits** during bulk provisioning             | Medium      | High    | Implement exponential backoff with jitter; batch operations; request limit increases proactively.                 |
| R-02 | **Let's Encrypt rate limits** for certificate issuance       | Low         | Medium  | Use staging environment for testing; implement certificate caching; consider ACM as fallback.                    |
| R-03 | **AWS cost overrun** from user misconfiguration              | Medium      | High    | Default to smallest instance types; implement cost estimation in CLI output; add budget alerts in v2.0.          |
| R-04 | **Security breach** via compromised JWT or credentials       | Low         | Critical| Short-lived tokens, refresh rotation, MFA, IAM least-privilege, audit logging, regular penetration testing.      |
| R-05 | **Build system bottleneck** with concurrent deploys          | Medium      | Medium  | Queue builds with priority; scale CodeBuild concurrency; implement build caching aggressively.                   |
| R-06 | **Data loss** during import/restore operations               | Low         | Critical| Validate checksums before restore; dry-run mode; maintain original archive; test restore procedures regularly.   |
| R-07 | **Vendor lock-in perception** despite being AWS-only         | Medium      | Medium  | Clearly document that Capsule creates standard AWS resources; provide `package/import` for migration.            |
| R-08 | **Complexity creep** from supporting too many resource types  | Medium      | Medium  | Strict phase gating; MVP with minimal viable feature set; user feedback-driven prioritization.                   |
| R-09 | **Docker image size** causing slow deploys                    | Medium      | Low     | Multi-stage builds; layer caching; buildkit optimizations; document best practices.                              |
| R-10 | **WebSocket connection drops** in unstable networks           | Medium      | Low     | Automatic reconnection with exponential backoff; SSE fallback; client-side buffering.                            |
| R-11 | **Traefik single point of failure**                          | Low         | High    | Run Traefik in Docker with restart policy; health checks; consider HA pair in v2.0.                              |
| R-12 | **CLI backward compatibility** across releases               | Medium      | Medium  | Semantic versioning; deprecation warnings; `capsule.yaml` schema versioning; migration guides.                   |
| R-13 | **Insufficient Go/AWS SDK expertise** in the team            | Low         | Medium  | Invest in training; follow AWS Well-Architected Framework; code reviews with security focus.                     |
| R-14 | **Open-source sustainability** (contributor burnout)          | Medium      | Medium  | Clear contribution guidelines; maintainer rotation; potential commercial support tier.                            |

---

## 15. Glossary

| Term                          | Definition                                                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **ACU**                       | Aurora Capacity Unit — a measurement of compute and memory capacity for Aurora Serverless v2.                                 |
| **ALB**                       | Application Load Balancer — AWS Layer 7 load balancer that routes HTTP/HTTPS traffic to target groups.                        |
| **ACME**                      | Automatic Certificate Management Environment — the protocol used by Let's Encrypt for automated TLS certificate issuance.    |
| **ASG**                       | Auto Scaling Group — AWS service that automatically adjusts the number of EC2 instances based on demand.                      |
| **Blue/Green Deployment**     | A deployment strategy where a new version runs alongside the old; traffic is switched atomically.                             |
| **Canary Deployment**         | A deployment strategy where a small percentage of traffic is routed to the new version before full rollout.                   |
| **Capsule API**               | The central Go backend service that orchestrates all resource management and AWS operations.                                  |
| **Capsule Control Plane**     | The set of services (API, Dashboard, WebSocket, Build Worker) that manage user resources.                                     |
| **CloudWatch**                | AWS monitoring service for logs, metrics, and alarms.                                                                         |
| **Cobra**                     | A Go library for creating CLI applications with subcommands, flags, and auto-completion.                                      |
| **CodeBuild**                 | AWS fully managed build service used for compiling code, running tests, and producing deployable artifacts.                    |
| **DNS-01 Challenge**          | An ACME challenge type where domain ownership is proved by creating a specific DNS TXT record.                                |
| **Docker**                    | Container platform used for packaging and running applications in isolated environments.                                      |
| **ECPU**                      | ElastiCache Processing Unit — a measurement unit for ElastiCache Serverless throughput.                                       |
| **ECR**                       | Elastic Container Registry — AWS private Docker image registry.                                                               |
| **Fiber**                     | A Go web framework inspired by Express.js, built on fasthttp.                                                                 |
| **Fluent Bit**                | Lightweight log processor and forwarder, designed for high-throughput environments.                                           |
| **IAM**                       | Identity and Access Management — AWS service for managing access to AWS resources.                                            |
| **JWT**                       | JSON Web Token — a compact, URL-safe token format used for authentication and authorization.                                  |
| **KMS**                       | Key Management Service — AWS service for creating and managing cryptographic keys.                                            |
| **Lambda**                    | AWS serverless compute service that runs code in response to events.                                                          |
| **Let's Encrypt**             | A free, automated Certificate Authority that issues TLS certificates.                                                         |
| **MFA**                       | Multi-Factor Authentication — requiring multiple forms of verification to access an account.                                  |
| **PaaS**                      | Platform as a Service — a cloud computing model providing a platform for developing, running, and managing applications.      |
| **RBAC**                      | Role-Based Access Control — authorization model where permissions are assigned to roles rather than individual users.          |
| **Route 53**                  | AWS DNS and domain registration service.                                                                                      |
| **S3**                        | Simple Storage Service — AWS object storage service.                                                                          |
| **Secrets Manager**           | AWS service for securely storing and managing secrets (passwords, API keys, credentials).                                     |
| **shadcn/ui**                 | A collection of re-usable React components built with Radix UI and Tailwind CSS.                                              |
| **SSE**                       | Server-Sent Events — a standard for servers to push real-time updates to clients over HTTP.                                   |
| **SSM Session Manager**       | AWS Systems Manager capability for secure shell access to EC2 instances without SSH keys.                                    |
| **Traefik**                   | A modern reverse proxy and load balancer with automatic TLS certificate management.                                           |
| **TOTP**                      | Time-based One-Time Password — an MFA algorithm that generates short-lived codes.                                            |
| **Vector**                    | A high-performance log/metric/trace pipeline tool (alternative to Fluent Bit).                                                |
| **VPC**                       | Virtual Private Cloud — an isolated network environment within AWS.                                                           |
| **WebSocket**                 | A protocol providing full-duplex communication channels over a single TCP connection.                                         |

---

## Appendix A — API Endpoint Summary

> **Note:** Full OpenAPI 3.1 specification will be published as a separate document (`docs/api/openapi.yaml`).

| Method   | Endpoint                              | Description                                  |
| -------- | ------------------------------------- | -------------------------------------------- |
| `POST`   | `/api/v1/auth/register`              | Register new user                            |
| `POST`   | `/api/v1/auth/login`                 | Login (returns JWT)                          |
| `POST`   | `/api/v1/auth/refresh`               | Refresh access token                         |
| `POST`   | `/api/v1/auth/device/code`           | Generate device auth code (CLI)              |
| `POST`   | `/api/v1/auth/device/confirm`        | Confirm device auth code                     |
| `GET`    | `/api/v1/projects`                   | List user's projects                         |
| `POST`   | `/api/v1/projects`                   | Create new project                           |
| `GET`    | `/api/v1/projects/:id`              | Get project details                          |
| `DELETE` | `/api/v1/projects/:id`              | Delete project                               |
| `GET`    | `/api/v1/projects/:id/status`       | Get project status summary                   |
| `POST`   | `/api/v1/projects/:id/deploy`       | Trigger deployment                           |
| `GET`    | `/api/v1/projects/:id/deploys`      | List deploy history                          |
| `POST`   | `/api/v1/projects/:id/rollback`     | Rollback deployment                          |
| `GET`    | `/api/v1/projects/:id/databases`    | List databases                               |
| `POST`   | `/api/v1/projects/:id/databases`    | Create database                              |
| `GET`    | `/api/v1/projects/:id/databases/:name` | Get database details                      |
| `DELETE` | `/api/v1/projects/:id/databases/:name` | Delete database                           |
| `POST`   | `/api/v1/projects/:id/databases/:name/snapshot` | Create snapshot                    |
| `POST`   | `/api/v1/projects/:id/databases/:name/restore`  | Restore from snapshot              |
| `GET`    | `/api/v1/projects/:id/redis`        | List Redis instances                         |
| `POST`   | `/api/v1/projects/:id/redis`        | Create Redis instance                        |
| `DELETE` | `/api/v1/projects/:id/redis/:name`  | Delete Redis instance                        |
| `GET`    | `/api/v1/projects/:id/domains`      | List domains                                 |
| `POST`   | `/api/v1/projects/:id/domains`      | Add domain                                   |
| `DELETE` | `/api/v1/projects/:id/domains/:name`| Remove domain                                |
| `GET`    | `/api/v1/projects/:id/servers`      | List servers                                 |
| `POST`   | `/api/v1/projects/:id/servers`      | Create/deploy server                         |
| `PATCH`  | `/api/v1/projects/:id/servers/:name`| Scale/update server                          |
| `DELETE` | `/api/v1/projects/:id/servers/:name`| Delete server                                |
| `GET`    | `/api/v1/projects/:id/env`          | List environment variables                   |
| `PUT`    | `/api/v1/projects/:id/env`          | Set environment variables (bulk)             |
| `DELETE` | `/api/v1/projects/:id/env/:key`     | Unset environment variable                   |
| `GET`    | `/api/v1/projects/:id/logs`         | Query historical logs                        |
| `WS`     | `/api/v1/projects/:id/logs/stream`  | WebSocket log stream                         |
| `POST`   | `/api/v1/projects/:id/package`      | Generate export archive                      |
| `POST`   | `/api/v1/import`                    | Import archive                               |

---

## Appendix B — `.capsule/config.json` Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Capsule Project Configuration",
  "type": "object",
  "required": ["projectId", "apiEndpoint"],
  "properties": {
    "projectId": {
      "type": "string",
      "pattern": "^proj_[a-zA-Z0-9]{12,}$",
      "description": "Unique project identifier assigned by the Capsule API"
    },
    "apiEndpoint": {
      "type": "string",
      "format": "uri",
      "description": "Base URL of the Capsule API"
    },
    "region": {
      "type": "string",
      "description": "Default AWS region for this project"
    },
    "defaultDeployType": {
      "type": "string",
      "enum": ["server", "worker", "daemon", "cron", "serverless"],
      "default": "server",
      "description": "Default deployment type when --type is not specified"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "Timestamp when the project was linked locally"
    }
  }
}
```

---

## Appendix C — `capsule.yaml` Schema

```yaml
# capsule.yaml — full schema reference
version: "1"                        # Schema version (required)
name: string                        # Project name (required)

build:
  runtime: string                   # Runtime: node18, node20, node22, python311, python312, go122, rust
  command: string                   # Build command (e.g., "npm run build")
  output: string                    # Build output directory (e.g., ".next", "dist")
  dockerfile: string                # Path to Dockerfile (overrides runtime-based build)
  build_args:                       # Build-time arguments
    KEY: VALUE
  cache:
    paths:                          # Directories to cache between builds
      - string

deploy:
  type: string                      # server | worker | daemon | cron | serverless
  port: integer                     # Application port (server type)
  health_check: string              # Health check endpoint path
  replicas: integer                 # Number of instances (server type)
  instance_type: string             # EC2 instance type (e.g., t3.small)
  schedule: string                  # Cron expression (cron type only)
  command: string                   # Override entrypoint command
  strategy: string                  # rolling | blue_green | canary

autoscale:
  enabled: boolean
  min: integer
  max: integer
  cpu_target: integer               # CPU utilization target percentage
  memory_target: integer            # Memory utilization target percentage

env:                                # List of env var names to inject (values from Capsule env store)
  - string

domains:                            # Custom domains to bind
  - string

serverless:                         # Serverless-specific configuration
  handler: string                   # Function handler (e.g., "src/index.handler")
  memory: integer                   # Lambda memory in MB (128-10240)
  timeout: integer                  # Lambda timeout in seconds (1-900)
  provisioned_concurrency: integer  # Provisioned concurrency count
```

---

## Document History

| Version | Date       | Author            | Changes                                |
| ------- | ---------- | ----------------- | -------------------------------------- |
| 1.0.0   | 2026-05-26 | Kynto Engineering | Initial draft — complete PRD           |

---

> **Next Steps:**
> 1. Review and approve this PRD with all stakeholders.
> 2. Create detailed technical design documents for each subsystem.
> 3. Set up the monorepo structure (`/api`, `/cli`, `/dashboard`, `/infra`).
> 4. Begin MVP sprint (Phase 1) — see [Release Phases](#13-release-phases).
