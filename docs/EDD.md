# Capsule — Engineering Design Document (EDD)

| Field           | Value                                     |
| --------------- | ----------------------------------------- |
| **Project**     | Capsule                                   |
| **Type**        | Self-Hosted PaaS on AWS                   |
| **Version**     | 1.0.0-draft                               |
| **Authors**     | Capsule Engineering                       |
| **Created**     | 2026-05-26                                |
| **Status**      | Draft                                     |
| **Repository**  | `github.com/kynto/capsule` (monorepo)     |

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Backend Architecture (Go)](#2-backend-architecture-go)
3. [Frontend Architecture (Next.js)](#3-frontend-architecture-nextjs)
4. [CLI Architecture (Go + Cobra)](#4-cli-architecture-go--cobra)
5. [AWS Integration Layer](#5-aws-integration-layer)
6. [Deploy Pipeline](#6-deploy-pipeline)
7. [Database & Redis Management](#7-database--redis-management)
8. [Backup & Portability System](#8-backup--portability-system)
9. [Logging Architecture](#9-logging-architecture)
10. [Security Design](#10-security-design)
11. [API Specification](#11-api-specification)
12. [Database Schema](#12-database-schema)

---

## 1. System Architecture

### 1.1 Monorepo Layout

Capsule is organized as a single monorepo with three deployable artifacts:

```
capsule/
├── cmd/
│   ├── api/                # Go API server entry point
│   │   └── main.go
│   └── cli/                # Go CLI entry point
│       └── main.go
├── internal/               # Shared private Go packages
│   ├── auth/               # JWT, API token, middleware
│   ├── build/              # Build service logic
│   ├── deploy/             # Deploy service logic
│   ├── dns/                # DNS management service
│   ├── log/                # Log collection & streaming
│   ├── backup/             # Backup & restore service
│   ├── database/           # DB provisioning service
│   ├── redis/              # Redis provisioning service
│   ├── domain/             # Core domain models
│   ├── repository/         # Data-access interfaces + implementations
│   ├── queue/              # Async job queue abstraction
│   ├── aws/                # AWS SDK abstraction layer
│   ├── config/             # Configuration loading
│   ├── middleware/         # HTTP middleware (CORS, rate-limit, logging)
│   └── ws/                 # WebSocket hub for real-time streaming
├── pkg/                    # Public shared Go packages
│   └── capsule/            # Shared types for CLI ↔ API
├── web/                    # Next.js frontend
│   ├── app/                # App Router pages
│   ├── components/         # React components
│   ├── lib/                # API client, hooks, utils
│   ├── public/             # Static assets
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── deploy/                 # IaC & scripts
│   ├── terraform/          # Terraform modules
│   ├── docker/             # Dockerfiles
│   └── scripts/            # Helper shell scripts
├── docs/                   # Documentation
│   ├── EDD.md              # ← this document
│   └── API.md
├── migrations/             # SQL migration files
├── go.mod
├── go.sum
├── Makefile
└── README.md
```

### 1.2 Microservice Boundaries

Although Capsule ships as a **single binary** (monolith-first), it is internally partitioned into logical service boundaries that can be extracted into independent services later. Each service owns its domain, data access, and AWS interactions.

```mermaid
graph TB
    subgraph "Capsule API Server (single binary)"
        GW["API Gateway<br/>(HTTP Router + Auth Middleware)"]
        BS["Build Service"]
        DS["Deploy Service"]
        LS["Log Service"]
        DNS["DNS Service"]
        BK["Backup Service"]
        DBS["Database Service"]
        RS["Redis Service"]
    end

    CLI["CLI (capsule)"] -->|HTTPS + WSS| GW
    WEB["Dashboard (Next.js)"] -->|HTTPS + WSS| GW

    GW --> BS
    GW --> DS
    GW --> LS
    GW --> DNS
    GW --> BK
    GW --> DBS
    GW --> RS

    BS -->|"Enqueue build jobs"| Q["Job Queue<br/>(PostgreSQL-backed)"]
    DS -->|"Enqueue deploy jobs"| Q

    BS -->|"Push images"| ECR["AWS ECR"]
    BS -->|"Start builds"| CB["AWS CodeBuild"]
    DS -->|"Update functions"| LAM["AWS Lambda"]
    DS -->|"Update services"| ECS["AWS ECS / EC2"]
    DNS -->|"Manage records"| R53["AWS Route 53"]
    BK -->|"Store artifacts"| S3["AWS S3"]
    LS -->|"Query logs"| CW["AWS CloudWatch"]
    DBS -->|"Provision"| RDS["AWS RDS / Aurora"]
    RS -->|"Provision"| EC["AWS ElastiCache"]

    style GW fill:#3b82f6,color:#fff
    style Q fill:#f59e0b,color:#000
```

### 1.3 High-Level Data Flow

```mermaid
sequenceDiagram
    participant U as User (CLI / Dashboard)
    participant API as Capsule API
    participant Q as Job Queue
    participant W as Worker
    participant AWS as AWS Services
    participant WS as WebSocket Hub

    U->>API: POST /api/v1/deployments (source tarball)
    API->>API: Validate, store artifact in S3
    API->>Q: Enqueue BUILD job
    API-->>U: 202 Accepted {deployment_id}

    U->>WS: Subscribe to /ws/logs/{deployment_id}

    Q->>W: Dequeue BUILD job
    W->>AWS: CodeBuild.StartBuild()
    W->>WS: Stream build logs in real time
    W->>AWS: ECR push image
    W->>Q: Enqueue DEPLOY job

    Q->>W: Dequeue DEPLOY job
    W->>AWS: Lambda.UpdateFunctionCode() or ECS.UpdateService()
    W->>WS: Stream deploy logs
    W-->>API: Update deployment status → LIVE
    WS-->>U: Deployment complete ✓
```

### 1.4 Component Interaction Diagram

```mermaid
graph LR
    subgraph "Client Tier"
        CLI["CLI"]
        DASH["Dashboard"]
    end

    subgraph "API Tier"
        AUTH["Auth Middleware"]
        ROUTER["Chi Router"]
        HANDLERS["HTTP Handlers"]
        SERVICES["Service Layer"]
        REPOS["Repositories"]
        QUEUE["Queue Producer"]
        WSHub["WS Hub"]
    end

    subgraph "Worker Tier"
        CONSUMER["Queue Consumer"]
        BUILD_W["Build Worker"]
        DEPLOY_W["Deploy Worker"]
        BACKUP_W["Backup Worker"]
    end

    subgraph "Data Tier"
        PG[("PostgreSQL")]
        REDIS_C[("Redis (cache)")]
        S3_A["S3 (artifacts)"]
    end

    subgraph "AWS Tier"
        EC2_A["EC2"]
        LAMBDA_A["Lambda"]
        R53_A["Route 53"]
        ECR_A["ECR"]
        CB_A["CodeBuild"]
        CW_A["CloudWatch"]
        RDS_A["RDS / Aurora"]
        ELASTI["ElastiCache"]
    end

    CLI -->|HTTPS| AUTH
    DASH -->|HTTPS| AUTH
    AUTH --> ROUTER --> HANDLERS --> SERVICES
    SERVICES --> REPOS --> PG
    SERVICES --> REPOS --> REDIS_C
    SERVICES --> QUEUE
    SERVICES --> WSHub
    HANDLERS --> WSHub

    QUEUE --> CONSUMER
    CONSUMER --> BUILD_W
    CONSUMER --> DEPLOY_W
    CONSUMER --> BACKUP_W

    BUILD_W --> CB_A
    BUILD_W --> ECR_A
    BUILD_W --> S3_A
    DEPLOY_W --> LAMBDA_A
    DEPLOY_W --> EC2_A
    BACKUP_W --> S3_A

    SERVICES --> R53_A
    SERVICES --> CW_A
    SERVICES --> RDS_A
    SERVICES --> ELASTI
```

---

## 2. Backend Architecture (Go)

### 2.1 Clean Architecture Layers

The Go backend follows Clean Architecture with four concentric layers. Dependencies always point inward.

```mermaid
graph TB
    subgraph "Layer 4 — Frameworks & Drivers"
        HTTP["HTTP Server (net/http)"]
        PGX["pgx (PostgreSQL)"]
        AWSSDK["AWS SDK v2"]
        WSS["gorilla/websocket"]
    end

    subgraph "Layer 3 — Interface Adapters"
        HAND["HTTP Handlers"]
        REPO_IMPL["Repository Implementations"]
        QUEUE_IMPL["Queue Implementations"]
        AWS_IMPL["AWS Client Implementations"]
    end

    subgraph "Layer 2 — Use Cases (Services)"
        SVC_P["ProjectService"]
        SVC_D["DeployService"]
        SVC_B["BuildService"]
        SVC_DB["DatabaseService"]
        SVC_R["RedisService"]
        SVC_BK["BackupService"]
        SVC_DNS["DNSService"]
        SVC_LOG["LogService"]
        SVC_AUTH["AuthService"]
    end

    subgraph "Layer 1 — Domain Entities"
        ENT["Project, Deployment, Database,<br/>RedisInstance, Domain, EnvVar,<br/>User, BuildLog, AuditEntry"]
    end

    HTTP --> HAND --> SVC_P & SVC_D & SVC_B & SVC_DB & SVC_R & SVC_BK & SVC_DNS & SVC_LOG & SVC_AUTH
    SVC_P & SVC_D & SVC_B --> ENT
    REPO_IMPL --> PGX
    AWS_IMPL --> AWSSDK
    HAND --> WSS

    style ENT fill:#10b981,color:#fff
    style SVC_P fill:#6366f1,color:#fff
    style SVC_D fill:#6366f1,color:#fff
    style SVC_B fill:#6366f1,color:#fff
```

### 2.2 Package Structure Detail

```
internal/
├── domain/                     # Layer 1 — Pure domain types
│   ├── project.go              # Project entity + value objects
│   ├── deployment.go           # Deployment entity, DeployStatus enum
│   ├── database.go             # ManagedDB entity
│   ├── redis.go                # RedisInstance entity
│   ├── domain.go               # CustomDomain entity
│   ├── envvar.go               # EnvVar (encrypted value)
│   ├── user.go                 # User entity, Role enum
│   ├── buildlog.go             # BuildLog entry
│   ├── audit.go                # AuditEntry
│   └── errors.go               # Domain-level errors (ErrNotFound, etc.)
│
├── repository/                 # Layer 2 — Interfaces
│   ├── project_repo.go         # ProjectRepository interface
│   ├── deployment_repo.go
│   ├── database_repo.go
│   ├── redis_repo.go
│   ├── domain_repo.go
│   ├── envvar_repo.go
│   ├── user_repo.go
│   ├── buildlog_repo.go
│   └── audit_repo.go
│
├── service/                    # Layer 2 — Use-case implementations
│   ├── project_svc.go
│   ├── deploy_svc.go
│   ├── build_svc.go
│   ├── database_svc.go
│   ├── redis_svc.go
│   ├── backup_svc.go
│   ├── dns_svc.go
│   ├── log_svc.go
│   └── auth_svc.go
│
├── postgres/                   # Layer 3 — PostgreSQL repository impls
│   ├── project_repo.go
│   ├── deployment_repo.go
│   └── ...
│
├── aws/                        # Layer 3 — AWS abstraction
│   ├── client.go               # Shared AWS config/session
│   ├── ec2.go                  # EC2Manager interface + impl
│   ├── lambda.go               # LambdaManager
│   ├── route53.go              # DNSManager
│   ├── s3.go                   # StorageManager
│   ├── codebuild.go            # BuildRunner
│   ├── ecr.go                  # RegistryManager
│   ├── cloudwatch.go           # MetricsCollector
│   ├── rds.go                  # RDSManager
│   ├── elasticache.go          # ElastiCacheManager
│   ├── asg.go                  # AutoScalingManager
│   ├── alb.go                  # LoadBalancerManager
│   └── iam.go                  # IAMManager
│
├── queue/                      # Layer 3 — Job queue
│   ├── producer.go             # QueueProducer interface + PG impl
│   ├── consumer.go             # QueueConsumer (polling worker)
│   └── job.go                  # Job types (BUILD, DEPLOY, BACKUP)
│
├── handler/                    # Layer 3 — HTTP handlers
│   ├── router.go               # Chi router setup + middleware
│   ├── auth_handler.go
│   ├── project_handler.go
│   ├── deployment_handler.go
│   ├── database_handler.go
│   ├── redis_handler.go
│   ├── domain_handler.go
│   ├── envvar_handler.go
│   ├── log_handler.go
│   ├── backup_handler.go
│   └── ws_handler.go           # WebSocket upgrade + log streaming
│
├── auth/                       # Auth subsystem
│   ├── jwt.go                  # JWT issuing & validation
│   ├── apitoken.go             # API token hashing & lookup
│   └── middleware.go           # Auth middleware (JWT + Bearer token)
│
├── middleware/                 # Generic HTTP middleware
│   ├── cors.go
│   ├── ratelimit.go
│   ├── requestid.go
│   └── logger.go
│
├── ws/                         # WebSocket hub
│   ├── hub.go                  # Central broadcast hub
│   ├── client.go               # Per-connection client
│   └── channel.go              # Channel (topic) management
│
└── config/                     # Configuration
    └── config.go               # Env-based config with defaults
```

### 2.3 Authentication Flow

Capsule supports two authentication mechanisms:

1. **JWT tokens** — for browser-based Dashboard sessions
2. **API tokens** — for CLI and programmatic access

```mermaid
sequenceDiagram
    participant U as User
    participant D as Dashboard / CLI
    participant API as Capsule API
    participant DB as PostgreSQL

    Note over D: Dashboard Login (JWT)
    U->>D: Enter email + password
    D->>API: POST /api/v1/auth/login {email, password}
    API->>DB: Lookup user, verify bcrypt hash
    DB-->>API: User record
    API->>API: Sign JWT (HS256, 24h expiry)
    API-->>D: {access_token, refresh_token}
    D->>D: Store tokens (httpOnly cookie / localStorage)

    Note over D: CLI Login (API Token)
    U->>D: capsule login
    D->>API: POST /api/v1/auth/login {email, password}
    API-->>D: {access_token}
    D->>API: POST /api/v1/auth/tokens {name: "cli-<hostname>"}
    API->>API: Generate random 32-byte token, SHA-256 hash for storage
    API->>DB: Store {token_hash, user_id, name, created_at}
    API-->>D: {token: "cap_xxxxxxxxxxxx"} (plaintext, shown once)
    D->>D: Store in ~/.capsule/config.json

    Note over D: Subsequent Requests
    D->>API: GET /api/v1/projects<br/>Authorization: Bearer cap_xxxx
    API->>API: Hash token → lookup in DB
    API->>API: Attach user to request context
    API-->>D: 200 OK {projects: [...]}
```

#### Token Structure

| Field          | JWT                              | API Token                          |
| -------------- | -------------------------------- | ---------------------------------- |
| Format         | `eyJhbGci...`                    | `cap_` + 43 base64url chars        |
| Storage (server)| N/A (stateless)                 | SHA-256 hash in `api_tokens` table |
| Storage (client)| Cookie / `localStorage`         | `~/.capsule/config.json`           |
| Expiry         | 24 hours (refresh: 7 days)       | Never (manual revocation)          |
| Scope          | Full user permissions            | Full user permissions              |

### 2.4 WebSocket Server for Real-Time Logs

```mermaid
graph LR
    subgraph "Clients"
        C1["Dashboard Tab 1"]
        C2["Dashboard Tab 2"]
        C3["CLI deploy --follow"]
    end

    subgraph "WebSocket Hub"
        HUB["Hub (goroutine)"]
        CH1["Channel: deploy:abc123"]
        CH2["Channel: logs:proj-x"]
    end

    subgraph "Producers"
        BW["Build Worker"]
        DW["Deploy Worker"]
        LW["Log Collector"]
    end

    C1 -->|"subscribe deploy:abc123"| HUB
    C3 -->|"subscribe deploy:abc123"| HUB
    C2 -->|"subscribe logs:proj-x"| HUB

    HUB --> CH1
    HUB --> CH2

    BW -->|"publish"| CH1
    DW -->|"publish"| CH1
    LW -->|"publish"| CH2

    CH1 -->|"broadcast"| C1 & C3
    CH2 -->|"broadcast"| C2
```

**Hub design** (Go):

```go
// ws/hub.go
type Hub struct {
    channels   map[string]map[*Client]bool  // channel → set of clients
    register   chan Subscription
    unregister chan Subscription
    publish    chan Message
    mu         sync.RWMutex
}

type Message struct {
    Channel string          `json:"channel"`
    Type    string          `json:"type"`     // "log", "status", "error"
    Payload json.RawMessage `json:"payload"`
    Time    time.Time       `json:"time"`
}
```

Clients connect via `wss://<host>/api/v1/ws` and send a subscribe frame:

```json
{ "action": "subscribe", "channel": "deploy:abc123" }
```

### 2.5 AWS SDK Integration Layer

Every AWS service is abstracted behind a Go interface so that the service layer never directly imports the AWS SDK. This enables unit testing via mocks and future multi-cloud support.

```go
// internal/aws/ec2.go
type EC2Manager interface {
    ProvisionInstance(ctx context.Context, opts InstanceOpts) (*Instance, error)
    TerminateInstance(ctx context.Context, instanceID string) error
    ListInstances(ctx context.Context, projectID string) ([]Instance, error)
    GetInstanceStatus(ctx context.Context, instanceID string) (InstanceStatus, error)
}

// internal/aws/lambda.go
type LambdaManager interface {
    CreateFunction(ctx context.Context, opts FunctionOpts) (*Function, error)
    UpdateFunctionCode(ctx context.Context, functionName string, imageURI string) error
    InvokeFunction(ctx context.Context, functionName string, payload []byte) ([]byte, error)
    DeleteFunction(ctx context.Context, functionName string) error
}

// internal/aws/s3.go
type StorageManager interface {
    Upload(ctx context.Context, bucket, key string, r io.Reader) error
    Download(ctx context.Context, bucket, key string) (io.ReadCloser, error)
    Delete(ctx context.Context, bucket, key string) error
    GeneratePresignedURL(ctx context.Context, bucket, key string, ttl time.Duration) (string, error)
}
```

All managers are initialized from a shared `aws.Config` in `internal/aws/client.go`:

```go
type AWSClient struct {
    Config aws.Config
    EC2    EC2Manager
    Lambda LambdaManager
    S3     StorageManager
    R53    DNSManager
    ECR    RegistryManager
    CB     BuildRunner
    CW     MetricsCollector
    RDS    RDSManager
    Cache  ElastiCacheManager
    ASG    AutoScalingManager
    ALB    LoadBalancerManager
    IAM    IAMManager
}

func NewAWSClient(ctx context.Context, region string, profile string) (*AWSClient, error) {
    cfg, err := config.LoadDefaultConfig(ctx,
        config.WithRegion(region),
        config.WithSharedConfigProfile(profile),
    )
    if err != nil {
        return nil, fmt.Errorf("aws config: %w", err)
    }
    return &AWSClient{
        Config: cfg,
        EC2:    newEC2Manager(cfg),
        Lambda: newLambdaManager(cfg),
        // ... etc
    }, nil
}
```

### 2.6 Queue System for Async Operations

Capsule uses a **PostgreSQL-backed job queue** (SKIP LOCKED pattern) to avoid introducing an external message broker dependency for self-hosted simplicity.

```mermaid
stateDiagram-v2
    [*] --> PENDING: Job enqueued
    PENDING --> RUNNING: Worker claims (SELECT ... FOR UPDATE SKIP LOCKED)
    RUNNING --> SUCCEEDED: Task completed
    RUNNING --> FAILED: Task errored (retries exhausted)
    RUNNING --> PENDING: Task errored (retry)
    FAILED --> [*]
    SUCCEEDED --> [*]
```

**Queue table** (`jobs`):

| Column         | Type                      | Description                    |
| -------------- | ------------------------- | ------------------------------ |
| `id`           | `UUID` PK                 | Job identifier                 |
| `type`         | `TEXT`                    | `BUILD`, `DEPLOY`, `BACKUP`    |
| `payload`      | `JSONB`                   | Type-specific payload          |
| `status`       | `TEXT`                    | `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED` |
| `attempts`     | `INT` DEFAULT 0           | Current attempt count          |
| `max_attempts` | `INT` DEFAULT 3           | Retry ceiling                  |
| `run_at`       | `TIMESTAMPTZ`             | Scheduled time (for delayed)   |
| `locked_by`    | `TEXT` NULL               | Worker ID holding the lock     |
| `locked_at`    | `TIMESTAMPTZ` NULL        | Lock acquisition time          |
| `created_at`   | `TIMESTAMPTZ`             | Enqueue time                   |
| `updated_at`   | `TIMESTAMPTZ`             | Last update                    |
| `error`        | `TEXT` NULL               | Last error message             |

**Consumer loop** (simplified):

```go
func (c *Consumer) Poll(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(c.pollInterval): // 1s default
            job, err := c.claimJob(ctx)
            if err != nil || job == nil {
                continue
            }
            go c.processJob(ctx, job)
        }
    }
}

func (c *Consumer) claimJob(ctx context.Context) (*Job, error) {
    tx, _ := c.db.BeginTx(ctx, nil)
    defer tx.Rollback()
    row := tx.QueryRow(ctx, `
        UPDATE jobs SET status = 'RUNNING', locked_by = $1, locked_at = now(), attempts = attempts + 1
        WHERE id = (
            SELECT id FROM jobs
            WHERE status = 'PENDING' AND run_at <= now()
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING id, type, payload
    `, c.workerID)
    // scan row...
    tx.Commit()
    return job, nil
}
```

---

## 3. Frontend Architecture (Next.js)

### 3.1 Technology Stack

| Concern            | Technology                               |
| ------------------ | ---------------------------------------- |
| Framework          | Next.js 15 (App Router)                  |
| Language           | TypeScript 5                             |
| Styling            | Tailwind CSS 4 + shadcn/ui              |
| State management   | Zustand (global) + React Query (server)  |
| Terminal emulator  | xterm.js                                 |
| Forms              | React Hook Form + Zod                    |
| Charts             | Recharts                                 |
| HTTP client        | Axios (wrapped in API client layer)      |
| WebSocket          | Native `WebSocket` API                   |

### 3.2 App Router Structure

```
web/app/
├── layout.tsx                   # Root layout (auth provider, sidebar)
├── page.tsx                     # Redirect → /dashboard
├── (auth)/
│   ├── login/page.tsx
│   └── register/page.tsx
├── (dashboard)/
│   ├── layout.tsx               # Dashboard shell (sidebar + topbar)
│   ├── dashboard/page.tsx       # Overview: resource cards, activity feed
│   ├── projects/
│   │   ├── page.tsx             # Project list (grid/table)
│   │   ├── new/page.tsx         # Create project wizard
│   │   └── [projectId]/
│   │       ├── layout.tsx       # Project tabs layout
│   │       ├── page.tsx         # Overview (latest deploy, metrics)
│   │       ├── deployments/
│   │       │   ├── page.tsx     # Deployment history table
│   │       │   └── [deployId]/page.tsx  # Deploy detail + logs
│   │       ├── logs/page.tsx    # Real-time log viewer (xterm.js)
│   │       ├── env/page.tsx     # Environment variables editor
│   │       ├── domains/page.tsx # Custom domain management
│   │       └── settings/page.tsx
│   ├── databases/
│   │   ├── page.tsx             # Managed database list
│   │   ├── new/page.tsx         # Provision wizard (Docker / Aurora)
│   │   └── [dbId]/page.tsx      # DB detail (connection info, metrics)
│   ├── redis/
│   │   ├── page.tsx             # Redis instance list
│   │   ├── new/page.tsx
│   │   └── [redisId]/page.tsx
│   ├── servers/
│   │   ├── page.tsx             # EC2 instance list
│   │   └── [serverId]/page.tsx  # Server detail (metrics, SSH info)
│   ├── backups/
│   │   ├── page.tsx             # Backup list & restore UI
│   │   └── new/page.tsx         # Create backup wizard
│   └── settings/
│       ├── page.tsx             # User profile
│       ├── tokens/page.tsx      # API token management
│       └── team/page.tsx        # Team members & RBAC
```

### 3.3 Real-Time Log Viewer Component

```mermaid
graph TB
    subgraph "LogViewer Component"
        XTERM["xterm.js Terminal"]
        FIT["FitAddon"]
        SEARCH["SearchAddon"]
        WEBLINK["WebLinksAddon"]
    end

    subgraph "useLogStream Hook"
        WS["WebSocket Connection"]
        BUFFER["Ring Buffer (10K lines)"]
        RECONNECT["Auto-Reconnect<br/>(exp. backoff)"]
    end

    WS -->|"onmessage"| BUFFER
    BUFFER -->|"write()"| XTERM
    XTERM --> FIT
    XTERM --> SEARCH
    XTERM --> WEBLINK
    RECONNECT -->|"on disconnect"| WS
```

**Key component structure:**

```tsx
// components/log-viewer.tsx
export function LogViewer({ channel }: { channel: string }) {
  const termRef = useRef<HTMLDivElement>(null);
  const { status, lineCount } = useLogStream(channel, termRef);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-2 border-b">
        <StatusBadge status={status} />
        <span className="text-sm text-muted-foreground">
          {lineCount} lines
        </span>
        <SearchBar termRef={termRef} />
        <Button variant="ghost" size="sm" onClick={clearTerminal}>
          Clear
        </Button>
      </div>
      <div ref={termRef} className="flex-1" />
    </div>
  );
}
```

### 3.4 State Management Approach

```mermaid
graph LR
    subgraph "Server State (React Query)"
        PQ["useQuery('projects')"]
        DQ["useQuery('deployments')"]
        DBQ["useQuery('databases')"]
    end

    subgraph "Client State (Zustand)"
        AUTH_S["authStore<br/>{user, token, login(), logout()}"]
        UI_S["uiStore<br/>{sidebarOpen, theme}"]
        WS_S["wsStore<br/>{connections, subscribe(), unsubscribe()}"]
    end

    subgraph "Form State (React Hook Form)"
        F1["useForm (create project)"]
        F2["useForm (env vars)"]
    end

    PQ --> AUTH_S
    DQ --> AUTH_S
    WS_S --> UI_S
```

| Concern          | Solution          | Why                                        |
| ---------------- | ----------------- | ------------------------------------------ |
| Server cache     | React Query       | Automatic refetch, cache invalidation, optimistic updates |
| Auth state       | Zustand           | Global, persistent, no prop drilling       |
| UI state         | Zustand           | Sidebar, theme, modals                     |
| WS connections   | Zustand           | Centralized connection pool                |
| Form state       | React Hook Form   | Performant, Zod schema validation          |

### 3.5 API Client Layer

```typescript
// lib/api/client.ts
import axios from 'axios';
import { useAuthStore } from '@/stores/auth';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  timeout: 30_000,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) return apiClient(error.config);
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

**Domain-specific API modules:**

```typescript
// lib/api/projects.ts
export const projectsAPI = {
  list:   ()             => apiClient.get<Project[]>('/projects'),
  get:    (id: string)   => apiClient.get<Project>(`/projects/${id}`),
  create: (data: CreateProjectInput) => apiClient.post<Project>('/projects', data),
  update: (id: string, data: UpdateProjectInput) => apiClient.patch<Project>(`/projects/${id}`, data),
  delete: (id: string)   => apiClient.delete(`/projects/${id}`),
};
```

---

## 4. CLI Architecture (Go + Cobra)

### 4.1 Command Tree

```
capsule
├── login                           # Authenticate & store token
├── logout                          # Clear stored credentials
├── whoami                          # Show current user
│
├── init                            # Initialize project in current directory
├── deploy                          # Deploy current project
│   ├── --follow                    # Stream build/deploy logs
│   ├── --env <key=value>           # Override env vars
│   └── --branch <name>            # Deploy specific branch
│
├── projects
│   ├── list                        # List all projects
│   ├── create <name>               # Create project
│   ├── info <name>                 # Show project details
│   └── delete <name>               # Delete project
│
├── deployments
│   ├── list [--project <name>]     # List deployments
│   ├── info <id>                   # Show deployment details
│   ├── logs <id> [--follow]        # View deployment logs
│   └── rollback <id>               # Rollback to deployment
│
├── env
│   ├── list [--project <name>]     # List env vars
│   ├── set <KEY=VALUE>...          # Set env vars
│   ├── unset <KEY>...              # Remove env vars
│   └── pull                        # Download .env file
│
├── domains
│   ├── list [--project <name>]     # List custom domains
│   ├── add <domain>                # Add custom domain
│   └── remove <domain>             # Remove custom domain
│
├── databases
│   ├── list                        # List managed databases
│   ├── create <name>               # Create database
│   │   ├── --engine <pg|mysql>
│   │   └── --serverless            # Use Aurora Serverless v2
│   ├── info <name>                 # Show connection info
│   └── delete <name>               # Delete database
│
├── redis
│   ├── list
│   ├── create <name>
│   ├── info <name>
│   └── delete <name>
│
├── backups
│   ├── list                        # List backups
│   ├── create                      # Create full backup
│   ├── export <id> --out <file>    # Download backup package
│   └── restore <file>              # Restore from package
│
├── logs <project> [--follow]       # Stream project logs
│
├── servers
│   ├── list                        # List provisioned servers
│   └── info <id>                   # Server details
│
└── version                         # Print CLI version
```

### 4.2 Auth Flow

```mermaid
sequenceDiagram
    participant U as User
    participant CLI as capsule CLI
    participant FS as ~/.capsule/config.json
    participant API as Capsule API

    U->>CLI: capsule login
    CLI->>CLI: Prompt email (stdin)
    CLI->>CLI: Prompt password (masked)
    CLI->>API: POST /api/v1/auth/login {email, password}
    API-->>CLI: {access_token}
    CLI->>API: POST /api/v1/auth/tokens {name: "cli-HOSTNAME"}
    API-->>CLI: {token: "cap_xxx..."}
    CLI->>FS: Write {api_url, token, user_email}
    CLI-->>U: ✓ Logged in as user@example.com

    Note over CLI: Subsequent commands
    U->>CLI: capsule projects list
    CLI->>FS: Read token
    CLI->>API: GET /api/v1/projects<br/>Authorization: Bearer cap_xxx
    API-->>CLI: [{name: "my-app", ...}]
    CLI-->>U: ┌────────┬──────────┐<br/>│ NAME   │ STATUS   │<br/>├────────┼──────────┤<br/>│ my-app │ deployed │<br/>└────────┴──────────┘
```

### 4.3 Deploy Flow

```mermaid
flowchart TD
    A["capsule deploy"] --> B{"Project linked?<br/>(.capsule/config.json)"}
    B -->|No| C["capsule init<br/>(prompt user)"]
    B -->|Yes| D["Detect Framework"]

    D --> D1{"Check files"}
    D1 -->|"package.json + next.config"| D2["Next.js"]
    D1 -->|"go.mod"| D3["Go"]
    D1 -->|"requirements.txt"| D4["Python"]
    D1 -->|"Dockerfile"| D5["Docker"]
    D1 -->|"None"| D6["Static"]

    D2 & D3 & D4 & D5 & D6 --> E["Read .capsuleignore"]
    E --> F["Compress source → .tar.gz<br/>(exclude node_modules, .git, etc.)"]
    F --> G["Upload tarball<br/>POST /api/v1/deployments"]
    G --> H["Receive deployment_id"]
    H --> I["Connect WebSocket<br/>/ws/logs/{deployment_id}"]
    I --> J["Stream build logs → stdout"]
    J --> K{"Build succeeded?"}
    K -->|Yes| L["Stream deploy logs"]
    K -->|No| M["Print error, exit 1"]
    L --> N["✓ Deployed at https://my-app.capsule.dev"]

    style A fill:#6366f1,color:#fff
    style N fill:#10b981,color:#fff
    style M fill:#ef4444,color:#fff
```

### 4.4 Local Config File

**`~/.capsule/config.json`** (global):

```json
{
  "api_url": "https://capsule.example.com",
  "token": "cap_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_abc",
  "user_email": "user@example.com"
}
```

**`.capsule/config.json`** (per-project, in repo root):

```json
{
  "project_id": "proj_abc123",
  "project_name": "my-app",
  "framework": "nextjs",
  "deploy_target": "lambda",
  "region": "us-east-1"
}
```

### 4.5 Output Formatting

| Element      | Library / Technique     | Example                          |
| ------------ | ----------------------- | -------------------------------- |
| Tables       | `tablewriter`           | `capsule projects list`          |
| Spinners     | `briandowns/spinner`    | `⠋ Building...`                 |
| Colors       | `fatih/color`           | Green ✓, Red ✗, Yellow ⚠        |
| Progress     | `schollz/progressbar`   | Upload: `███████░░░ 70%`         |
| JSON output  | `--output json` flag    | Machine-readable output          |

---

## 5. AWS Integration Layer

### 5.1 IAM Policy Template (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EC2Management",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:DescribeInstances",
        "ec2:CreateTags",
        "ec2:DescribeSecurityGroups",
        "ec2:CreateSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "ec2:DescribeKeyPairs"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${var.region}"
        }
      }
    },
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:ListFunctions",
        "lambda:InvokeFunction",
        "lambda:CreateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:AddPermission"
      ],
      "Resource": "arn:aws:lambda:${var.region}:${var.account_id}:function:capsule-*"
    },
    {
      "Sid": "ECRManagement",
      "Effect": "Allow",
      "Action": [
        "ecr:CreateRepository",
        "ecr:DeleteRepository",
        "ecr:DescribeRepositories",
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:BatchCheckLayerAvailability"
      ],
      "Resource": "arn:aws:ecr:${var.region}:${var.account_id}:repository/capsule-*"
    },
    {
      "Sid": "S3ArtifactsAndBackups",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:CreateBucket",
        "s3:PutBucketEncryption",
        "s3:PutBucketVersioning"
      ],
      "Resource": [
        "arn:aws:s3:::capsule-*",
        "arn:aws:s3:::capsule-*/*"
      ]
    },
    {
      "Sid": "Route53DNS",
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:ListHostedZones",
        "route53:GetHostedZone",
        "route53:CreateHostedZone"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CodeBuild",
      "Effect": "Allow",
      "Action": [
        "codebuild:CreateProject",
        "codebuild:StartBuild",
        "codebuild:BatchGetBuilds",
        "codebuild:BatchGetProjects",
        "codebuild:DeleteProject"
      ],
      "Resource": "arn:aws:codebuild:${var.region}:${var.account_id}:project/capsule-*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
        "logs:DescribeLogGroups"
      ],
      "Resource": "arn:aws:logs:${var.region}:${var.account_id}:log-group:/capsule/*"
    },
    {
      "Sid": "RDSProvisioning",
      "Effect": "Allow",
      "Action": [
        "rds:CreateDBCluster",
        "rds:CreateDBInstance",
        "rds:DeleteDBCluster",
        "rds:DeleteDBInstance",
        "rds:DescribeDBClusters",
        "rds:DescribeDBInstances",
        "rds:ModifyDBCluster",
        "rds:CreateDBClusterSnapshot",
        "rds:RestoreDBClusterFromSnapshot"
      ],
      "Resource": "arn:aws:rds:${var.region}:${var.account_id}:cluster:capsule-*"
    },
    {
      "Sid": "ElastiCache",
      "Effect": "Allow",
      "Action": [
        "elasticache:CreateCacheCluster",
        "elasticache:DeleteCacheCluster",
        "elasticache:DescribeCacheClusters",
        "elasticache:CreateReplicationGroup",
        "elasticache:DeleteReplicationGroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AutoScaling",
      "Effect": "Allow",
      "Action": [
        "autoscaling:CreateAutoScalingGroup",
        "autoscaling:UpdateAutoScalingGroup",
        "autoscaling:DeleteAutoScalingGroup",
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:SetDesiredCapacity",
        "autoscaling:CreateLaunchConfiguration",
        "autoscaling:DeleteLaunchConfiguration"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ELB",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateLoadBalancer",
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:CreateListener",
        "elasticloadbalancing:ModifyListener",
        "elasticloadbalancing:DescribeTargetHealth"
      ],
      "Resource": "*"
    },
    {
      "Sid": "IAMPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${var.account_id}:role/capsule-*"
    }
  ]
}
```

### 5.2 EC2 Provisioning Flow

```mermaid
sequenceDiagram
    participant API as Capsule API
    participant EC2 as AWS EC2
    participant SG as Security Groups
    participant R53 as Route 53
    participant SSM as SSM (User Data)

    API->>SG: CreateSecurityGroup(capsule-{project}-sg)
    SG-->>API: sg-xxxxx
    API->>SG: AuthorizeIngress(22, 80, 443)

    API->>EC2: RunInstances<br/>AMI: Amazon Linux 2023<br/>Type: t3.small<br/>UserData: bootstrap script<br/>Tags: capsule:project={name}
    EC2-->>API: i-xxxxxxxx (pending)

    loop Wait for running
        API->>EC2: DescribeInstances(i-xxx)
        EC2-->>API: state: running, publicIP: 1.2.3.4
    end

    API->>R53: ChangeResourceRecordSets<br/>A record: {project}.capsule.dev → 1.2.3.4

    Note over API: UserData bootstrap installs:<br/>Docker, Caddy (auto TLS), Vector (log agent)
```

### 5.3 Lambda Deployment Flow

```mermaid
sequenceDiagram
    participant API as Capsule API
    participant ECR as AWS ECR
    participant LAM as AWS Lambda
    participant APIGW as API Gateway / Function URL

    API->>ECR: docker push capsule-{project}:v{version}
    ECR-->>API: Image pushed

    alt New function
        API->>LAM: CreateFunction<br/>PackageType: Image<br/>ImageUri: {ecr-uri}:v{version}<br/>MemorySize: 1024<br/>Timeout: 30<br/>Env: {from env_vars table}
        LAM-->>API: Function ARN

        API->>LAM: CreateFunctionUrlConfig<br/>AuthType: NONE
        LAM-->>API: Function URL
    else Existing function
        API->>LAM: UpdateFunctionCode<br/>ImageUri: {ecr-uri}:v{version}
        LAM-->>API: Updated

        API->>LAM: UpdateFunctionConfiguration<br/>Env: {updated env_vars}
        LAM-->>API: Configured
    end

    API->>API: Store function URL as deploy endpoint
```

### 5.4 Route 53 DNS Management

```mermaid
flowchart TD
    A["User adds domain:<br/>app.example.com"] --> B["Lookup hosted zone<br/>for example.com"]
    B --> C{"Zone found?"}
    C -->|No| D["CreateHostedZone(example.com)"]
    C -->|Yes| E["Get Zone ID"]
    D --> E

    E --> F{"Deploy target?"}
    F -->|Lambda| G["CNAME → function URL"]
    F -->|EC2/ECS| H["A record → ALB/IP"]

    G & H --> I["ChangeResourceRecordSets<br/>UPSERT record"]
    I --> J["Return NS records<br/>for user to configure"]
    J --> K["Poll for propagation<br/>+ TLS cert validation"]
```

### 5.5 S3 Bucket Structure

```
capsule-{account-id}-{region}/
├── artifacts/
│   └── {project_id}/
│       └── {deployment_id}/
│           ├── source.tar.gz         # Uploaded source code
│           └── buildspec.yml         # Generated build configuration
├── backups/
│   └── {backup_id}/
│       ├── manifest.json             # Backup manifest
│       ├── metadata.json.enc         # Encrypted metadata
│       ├── databases/
│       │   └── {db_name}.sql.gz.enc  # Encrypted DB dump
│       ├── redis/
│       │   └── {redis_name}.rdb.enc  # Encrypted Redis snapshot
│       ├── env/
│       │   └── {project_name}.env.enc
│       └── config/
│           └── projects.json.enc
└── logs/
    └── {project_id}/
        └── {date}/
            └── {hour}.log.gz         # Archived log files
```

### 5.6 CloudWatch Metrics Collection

```mermaid
graph LR
    subgraph "Metric Sources"
        CW_LAM["Lambda Metrics<br/>(Invocations, Duration, Errors)"]
        CW_EC2["EC2 Metrics<br/>(CPU, Network, Disk)"]
        CW_RDS["RDS Metrics<br/>(Connections, IOPS, Latency)"]
        CW_ALB["ALB Metrics<br/>(RequestCount, Latency, 5xx)"]
    end

    subgraph "Capsule Metrics Collector"
        POLL["MetricsCollector.Poll()<br/>(every 60s)"]
        AGG["Aggregate & Transform"]
        STORE["Store in metrics table"]
    end

    CW_LAM & CW_EC2 & CW_RDS & CW_ALB --> POLL --> AGG --> STORE

    subgraph "Dashboard"
        CHART["Recharts Visualizations"]
    end

    STORE -->|"GET /api/v1/metrics"| CHART
```

### 5.7 ASG + ALB Auto-Scaling Setup

```mermaid
graph TB
    subgraph "Internet"
        USER["Users"]
    end

    subgraph "AWS"
        ALB["Application Load Balancer<br/>capsule-{project}-alb"]
        TG["Target Group<br/>(health check: /health)"]
        
        subgraph "Auto Scaling Group"
            ASG["capsule-{project}-asg<br/>Min: 1, Max: 10, Desired: 2"]
            I1["EC2 Instance 1"]
            I2["EC2 Instance 2"]
            I3["EC2 Instance N..."]
        end

        SP_UP["Scale-Up Policy<br/>CPU > 70% for 5min"]
        SP_DN["Scale-Down Policy<br/>CPU < 30% for 10min"]
    end

    USER --> ALB --> TG
    TG --> I1 & I2 & I3
    ASG --> I1 & I2 & I3
    SP_UP --> ASG
    SP_DN --> ASG
```

**Launch template** user data bootstraps: Docker, application container pull from ECR, Caddy for TLS, and Vector for log shipping.

---

## 6. Deploy Pipeline

### 6.1 End-to-End Pipeline

```mermaid
flowchart LR
    A["Git Push /<br/>CLI deploy"] --> B["Webhook /<br/>API upload"]
    B --> C["Store source<br/>in S3"]
    C --> D["Enqueue<br/>BUILD job"]
    D --> E["CodeBuild<br/>starts"]

    subgraph "Build Phase"
        E --> F["Pull source<br/>from S3"]
        F --> G["Detect runtime<br/>& framework"]
        G --> H["Install deps<br/>(cached layers)"]
        H --> I["Build app"]
        I --> J["Build Docker<br/>image"]
        J --> K["Push to ECR"]
    end

    K --> L["Enqueue<br/>DEPLOY job"]

    subgraph "Deploy Phase"
        L --> M{"Target?"}
        M -->|Lambda| N["UpdateFunctionCode"]
        M -->|ECS/EC2| O["Rolling update<br/>via ASG"]
    end

    N & O --> P["Health check"]
    P -->|Pass| Q["Mark LIVE<br/>Update DNS"]
    P -->|Fail| R["Auto-rollback<br/>to previous"]

    style A fill:#6366f1,color:#fff
    style Q fill:#10b981,color:#fff
    style R fill:#ef4444,color:#fff
```

### 6.2 Rolling Update Strategy (ECS/EC2)

```mermaid
sequenceDiagram
    participant API as Deploy Worker
    participant ASG as Auto Scaling Group
    participant ALB as ALB Target Group
    participant OLD as Old Instances
    participant NEW as New Instances

    API->>ASG: Create new Launch Template version<br/>(updated container image)
    API->>ASG: StartInstanceRefresh<br/>MinHealthyPercentage: 90%<br/>InstanceWarmup: 120s

    ASG->>NEW: Launch new instance (v2)
    NEW->>NEW: Pull image, start container
    NEW->>ALB: Register target

    loop Health checks
        ALB->>NEW: GET /health
        NEW-->>ALB: 200 OK
    end

    ALB->>ALB: Mark new instance healthy
    ASG->>OLD: Terminate old instance (v1)
    OLD->>ALB: Deregister (drain 30s)

    Note over ASG: Repeat for remaining instances<br/>(one at a time)

    API->>API: All instances refreshed → status LIVE
```

### 6.3 Rollback Mechanism

```mermaid
flowchart TD
    A["Deployment fails<br/>health check"] --> B["Identify previous<br/>successful deployment"]
    B --> C["Load previous<br/>deployment record"]
    C --> D{"Target type?"}

    D -->|Lambda| E["UpdateFunctionCode<br/>imageUri: previous ECR tag"]
    D -->|ECS/EC2| F["Update Launch Template<br/>to previous version"]
    F --> G["StartInstanceRefresh<br/>(roll back instances)"]

    E & G --> H["Verify health"]
    H --> I["Mark deployment FAILED<br/>Previous deployment stays LIVE"]
    I --> J["Notify user via<br/>WebSocket + email"]

    style A fill:#ef4444,color:#fff
    style J fill:#f59e0b,color:#000
```

**Rollback triggers:**

| Trigger                  | Threshold              | Action                      |
| ------------------------ | ---------------------- | --------------------------- |
| Health check failure     | 3 consecutive fails    | Auto-rollback               |
| Error rate spike         | >50% 5xx in 2 min      | Auto-rollback               |
| Manual                   | User: `capsule rollback <id>` | Immediate rollback   |
| Deployment timeout       | 10 min (configurable)  | Auto-rollback               |

### 6.4 Build Caching

| Cache Layer                | Strategy                                              |
| -------------------------- | ----------------------------------------------------- |
| Docker layer cache         | CodeBuild local cache mode (`LOCAL_DOCKER_LAYER_CACHE`) |
| npm / yarn cache           | S3 cache (`node_modules/.cache`)                      |
| Go module cache            | S3 cache (`$GOPATH/pkg/mod`)                          |
| pip cache                  | S3 cache (`~/.cache/pip`)                             |
| ECR image layers           | Reused across builds (shared base images)             |

Build caching configuration in `buildspec.yml`:

```yaml
version: 0.2
cache:
  paths:
    - '/root/.cache/**/*'
    - '/root/go/pkg/mod/**/*'
    - 'node_modules/**/*'
phases:
  install:
    runtime-versions:
      golang: 1.22
      nodejs: 20
  pre_build:
    commands:
      - echo Logging in to ECR...
      - aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URI
  build:
    commands:
      - docker build -t $IMAGE_URI:$TAG --cache-from $IMAGE_URI:latest .
      - docker tag $IMAGE_URI:$TAG $IMAGE_URI:latest
  post_build:
    commands:
      - docker push $IMAGE_URI:$TAG
      - docker push $IMAGE_URI:latest
```

---

## 7. Database & Redis Management

### 7.1 Provisioning Modes

```mermaid
flowchart TD
    A["capsule databases create my-db"] --> B{"--serverless flag?"}

    B -->|No| C["Docker Container Mode"]
    B -->|Yes| D["Aurora Serverless v2"]

    subgraph "Docker Mode (on EC2)"
        C --> C1["Pull postgres:16 / mysql:8 image"]
        C1 --> C2["docker run with volume mount"]
        C2 --> C3["Generate credentials"]
        C3 --> C4["Configure pg_hba.conf / auth"]
        C4 --> C5["Store connection URI"]
    end

    subgraph "Aurora Serverless v2"
        D --> D1["CreateDBCluster<br/>Engine: aurora-postgresql<br/>ServerlessV2ScalingConfig:<br/>  MinCapacity: 0.5<br/>  MaxCapacity: 16"]
        D1 --> D2["CreateDBInstance<br/>DBInstanceClass: db.serverless"]
        D2 --> D3["Wait for available"]
        D3 --> D4["Store connection URI"]
    end

    C5 & D4 --> E["Return connection info<br/>to user"]
```

### 7.2 Docker Container Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Provisioning: create command
    Provisioning --> Running: Container started
    Running --> Stopped: stop command
    Stopped --> Running: start command
    Running --> BackingUp: Scheduled backup
    BackingUp --> Running: Backup complete
    Running --> Deleting: delete command
    Stopped --> Deleting: delete command
    Deleting --> [*]: Container + volume removed
```

**Container naming convention:** `capsule-db-{project_id}-{db_name}`

**Volume mount:** `/var/lib/capsule/databases/{db_name}/data` → container `/var/lib/postgresql/data`

### 7.3 Automated Backups

```mermaid
sequenceDiagram
    participant CRON as Backup Scheduler<br/>(daily 02:00 UTC)
    participant W as Backup Worker
    participant DB as Database Container
    participant S3 as AWS S3

    CRON->>W: Enqueue BACKUP job for each DB

    W->>DB: pg_dump --format=custom --compress=9<br/>→ pipe to stdout
    DB-->>W: SQL dump stream
    W->>W: Encrypt (AES-256-GCM)
    W->>S3: PutObject(backups/{db_id}/{timestamp}.dump.enc)
    S3-->>W: 200 OK

    W->>W: Prune old backups (retention: 7 daily, 4 weekly)

    Note over W: For Redis
    W->>DB: redis-cli BGSAVE
    W->>DB: Wait for LASTSAVE change
    W->>DB: Copy dump.rdb
    W->>W: Encrypt
    W->>S3: PutObject(backups/{redis_id}/{timestamp}.rdb.enc)
```

### 7.4 Connection Pooling & URI Generation

```mermaid
graph LR
    APP["Application<br/>(user's project)"] --> PGB["PgBouncer<br/>(connection pooler)"]
    PGB --> PG["PostgreSQL<br/>(Docker or Aurora)"]

    subgraph "Connection URI"
        URI["postgresql://capsule_{project}:{password}@<br/>{host}:{port}/{db_name}?<br/>sslmode=require&<br/>application_name=capsule"]
    end
```

| Parameter        | Docker Mode                           | Aurora Serverless                           |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| Host             | EC2 private IP                        | Aurora cluster endpoint                     |
| Port             | Dynamic (5432–5500 range)             | 5432                                        |
| Database         | `capsule_{project_name}`              | `capsule_{project_name}`                    |
| User             | `capsule_{project_name}`              | `capsule_{project_name}`                    |
| Password         | 32-char random (stored encrypted)     | 32-char random (stored in Secrets Manager)  |
| SSL              | Self-signed cert                      | AWS RDS CA bundle                           |
| Pooler           | PgBouncer sidecar container           | RDS Proxy (optional add-on)                 |

---

## 8. Backup & Portability System

### 8.1 Package Structure (.zip Anatomy)

```
backup-{timestamp}.capsule.zip
├── manifest.json                    # Package metadata & integrity
├── metadata/
│   ├── projects.json.enc            # All project configurations
│   ├── env_vars.json.enc            # All environment variables
│   ├── domains.json.enc             # Domain configurations
│   └── users.json.enc               # User accounts (hashed passwords)
├── databases/
│   ├── db1.sql.gz.enc               # PostgreSQL dump (compressed + encrypted)
│   └── db2.sql.gz.enc
├── redis/
│   └── cache1.rdb.gz.enc            # Redis RDB snapshot (compressed + encrypted)
├── artifacts/
│   └── {project_id}/
│       └── latest-source.tar.gz.enc # Latest source tarball
└── checksums.sha256                 # Integrity verification
```

### 8.2 Manifest Structure

```json
{
  "version": "1.0.0",
  "format": "capsule-backup",
  "created_at": "2026-05-26T08:00:00Z",
  "created_by": "user@example.com",
  "capsule_version": "1.0.0",
  "encryption": {
    "algorithm": "AES-256-GCM",
    "key_derivation": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt": "base64-encoded-salt"
  },
  "contents": {
    "projects": 5,
    "databases": 3,
    "redis_instances": 2,
    "env_var_sets": 5,
    "domains": 8,
    "users": 3
  },
  "checksums": {
    "algorithm": "SHA-256",
    "file": "checksums.sha256"
  }
}
```

### 8.3 Encryption (AES-256)

```mermaid
flowchart LR
    A["User Passphrase"] --> B["PBKDF2-SHA256<br/>600K iterations<br/>+ random salt"]
    B --> C["256-bit Key"]
    C --> D["AES-256-GCM<br/>Encrypt"]
    E["Plaintext Data"] --> F["gzip compress"] --> D
    D --> G["Ciphertext + 12-byte Nonce<br/>(prepended)"]
```

**Encryption implementation** (Go):

```go
func Encrypt(plaintext []byte, passphrase string) ([]byte, []byte, error) {
    salt := make([]byte, 32)
    if _, err := rand.Read(salt); err != nil {
        return nil, nil, err
    }

    key := pbkdf2.Key([]byte(passphrase), salt, 600_000, 32, sha256.New)

    block, err := aes.NewCipher(key)
    if err != nil {
        return nil, nil, err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return nil, nil, err
    }

    nonce := make([]byte, gcm.NonceSize())
    if _, err := rand.Read(nonce); err != nil {
        return nil, nil, err
    }

    ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
    return ciphertext, salt, nil
}
```

### 8.4 Export Algorithm

```mermaid
flowchart TD
    A["capsule backups create"] --> B["Create temp directory"]
    B --> C["Generate manifest"]

    C --> D["Export Projects"]
    D --> D1["Query all projects + configs"]
    D1 --> D2["Serialize JSON → gzip → encrypt"]

    C --> E["Export Databases"]
    E --> E1["For each DB: pg_dump / mysqldump"]
    E1 --> E2["Pipe: dump → gzip → encrypt → file"]

    C --> F["Export Redis"]
    F --> F1["For each Redis: BGSAVE → copy .rdb"]
    F1 --> F2["gzip → encrypt → file"]

    C --> G["Export Env Vars"]
    G --> G1["Query all env vars (decrypt from DB)"]
    G1 --> G2["Re-encrypt with backup passphrase"]

    C --> H["Export Domains & Users"]

    D2 & E2 & F2 & G2 & H --> I["Compute SHA-256 checksums"]
    I --> J["Write checksums.sha256"]
    J --> K["ZIP all files"]
    K --> L["Upload to S3 or<br/>stream to CLI"]

    style A fill:#6366f1,color:#fff
    style L fill:#10b981,color:#fff
```

### 8.5 Import / Restore Algorithm with Validation

```mermaid
flowchart TD
    A["capsule backups restore backup.capsule.zip"] --> B["Extract ZIP to temp dir"]
    B --> C["Read manifest.json"]
    C --> D["Validate manifest version"]

    D --> E["Verify checksums.sha256<br/>against all files"]
    E --> F{"All checksums valid?"}
    F -->|No| G["Abort: Integrity check failed"]
    F -->|Yes| H["Prompt for passphrase"]

    H --> I["Decrypt metadata/projects.json"]
    I --> J{"Decrypt successful?"}
    J -->|No| K["Abort: Wrong passphrase"]
    J -->|Yes| L["Begin restore transaction"]

    L --> M["Restore users"]
    M --> N["Restore projects"]
    N --> O["Restore env vars"]
    O --> P["Restore databases"]
    P --> P1["Create DB container/cluster"]
    P1 --> P2["Decrypt → decompress → pg_restore"]

    O --> Q["Restore Redis"]
    Q --> Q1["Create Redis container"]
    Q1 --> Q2["Decrypt → decompress → copy .rdb → restart"]

    P2 & Q2 --> R["Restore domains"]
    R --> S["Cloud State Reconciliation"]
    S --> T["Commit transaction"]

    style A fill:#6366f1,color:#fff
    style G fill:#ef4444,color:#fff
    style K fill:#ef4444,color:#fff
    style T fill:#10b981,color:#fff
```

### 8.6 Cloud State Reconciliation

After restoring metadata, the system reconciles the desired state (from backup) with actual AWS cloud state:

```mermaid
flowchart TD
    A["Reconciliation Engine"] --> B["Load restored project configs"]

    B --> C["For each project"]
    C --> D{"AWS resource exists?"}

    D -->|"Yes (matching tags)"| E["Verify configuration matches"]
    D -->|"No"| F["Re-provision resource"]

    E --> G{"Config matches?"}
    G -->|Yes| H["Skip — already in sync"]
    G -->|No| I["Update resource to match backup"]

    F --> J["Create EC2/Lambda/etc."]
    J --> K["Update DNS records"]

    I & H & K --> L["Update Capsule DB with<br/>new resource identifiers"]
    L --> M["Next project"]

    style A fill:#f59e0b,color:#000
```

---

## 9. Logging Architecture

### 9.1 Log Collection

```mermaid
graph TB
    subgraph "Application Tier"
        APP1["Project A Container"]
        APP2["Project B Container"]
        APP3["Lambda Function"]
    end

    subgraph "Collection Agents"
        VEC1["Vector Agent<br/>(on EC2)"]
        CW_SUB["CloudWatch<br/>Subscription Filter"]
    end

    subgraph "Capsule Log Service"
        INGEST["Log Ingestion API"]
        BUFFER["In-Memory Ring Buffer<br/>(per project, 10K lines)"]
        PERSIST["Log Persistence Worker"]
    end

    subgraph "Storage"
        PG_LOG["PostgreSQL<br/>(recent: 7 days)"]
        S3_LOG["S3<br/>(archive: 90 days)"]
        CW_LOG["CloudWatch Logs<br/>(raw source)"]
    end

    subgraph "Consumers"
        WS_HUB["WebSocket Hub"]
        DASH["Dashboard Log Viewer"]
        CLI_LOG["CLI: capsule logs"]
    end

    APP1 & APP2 -->|stdout/stderr| VEC1
    APP3 -->|auto| CW_LOG
    CW_LOG -->|subscription| CW_SUB

    VEC1 -->|HTTP POST| INGEST
    CW_SUB -->|HTTP POST| INGEST

    INGEST --> BUFFER
    BUFFER --> WS_HUB --> DASH & CLI_LOG
    BUFFER --> PERSIST --> PG_LOG
    PERSIST -->|"rotate (daily)"| S3_LOG
```

### 9.2 Log Streaming (WebSocket Channels)

```mermaid
sequenceDiagram
    participant C as Client (Dashboard/CLI)
    participant WS as WebSocket Hub
    participant BUF as Ring Buffer
    participant ING as Log Ingestion

    C->>WS: Connect wss://host/api/v1/ws
    C->>WS: {"action":"subscribe","channel":"logs:proj-abc"}
    WS->>BUF: Get recent lines (last 100)
    BUF-->>WS: [cached log lines]
    WS-->>C: Batch send cached lines

    loop Real-time streaming
        ING->>BUF: New log line arrives
        BUF->>WS: Publish to channel "logs:proj-abc"
        WS-->>C: {"type":"log","payload":{...}}
    end

    C->>WS: {"action":"unsubscribe","channel":"logs:proj-abc"}
    WS->>WS: Remove client from channel
```

### 9.3 Log Storage & Retention

| Tier         | Storage           | Retention   | Access Pattern              |
| ------------ | ----------------- | ----------- | --------------------------- |
| Hot          | In-memory buffer  | ~10K lines  | Real-time WebSocket stream  |
| Warm         | PostgreSQL        | 7 days      | Full-text search, filtering |
| Cold         | S3 (gzip)         | 90 days     | Archive retrieval           |
| Source       | CloudWatch Logs   | 30 days     | AWS-native querying         |

### 9.4 Structured Logging Format

All log entries conform to a JSON schema for consistent querying:

```json
{
  "timestamp": "2026-05-26T08:30:15.123Z",
  "level": "INFO",
  "project_id": "proj_abc123",
  "deployment_id": "dep_xyz789",
  "source": "application",
  "service": "web",
  "instance_id": "i-0abc123def",
  "message": "HTTP request completed",
  "fields": {
    "method": "GET",
    "path": "/api/users",
    "status": 200,
    "duration_ms": 45,
    "request_id": "req_abc123"
  }
}
```

**Log levels:** `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`

**Index strategy** (PostgreSQL):

```sql
CREATE INDEX idx_build_logs_project_time ON build_logs (project_id, timestamp DESC);
CREATE INDEX idx_build_logs_deployment   ON build_logs (deployment_id, timestamp DESC);
CREATE INDEX idx_build_logs_level        ON build_logs (level) WHERE level IN ('ERROR', 'FATAL');
```

---

## 10. Security Design

### 10.1 IAM Sub-Profile Isolation

Each Capsule installation creates an IAM role with scoped permissions. Per-project isolation is enforced via resource-level policies and tagging:

```mermaid
graph TB
    subgraph "AWS Account"
        ROLE["IAM Role: capsule-control-plane"]

        subgraph "Project A Resources"
            A_LAMBDA["Lambda: capsule-proj-a-*"]
            A_ECR["ECR: capsule-proj-a"]
            A_SG["SG: capsule-proj-a-sg"]
        end

        subgraph "Project B Resources"
            B_EC2["EC2: tagged capsule:project=proj-b"]
            B_ECR["ECR: capsule-proj-b"]
            B_SG["SG: capsule-proj-b-sg"]
        end
    end

    ROLE -->|"capsule:project tag condition"| A_LAMBDA & A_ECR & A_SG
    ROLE -->|"capsule:project tag condition"| B_EC2 & B_ECR & B_SG
```

**Tag-based access control:**

```json
{
  "Condition": {
    "StringEquals": {
      "aws:ResourceTag/capsule:project": "${project_id}"
    }
  }
}
```

### 10.2 Secret Encryption at Rest

```mermaid
flowchart LR
    A["User sets env var:<br/>DATABASE_URL=postgres://..."] --> B["API receives plaintext"]
    B --> C["Encrypt with<br/>project-specific key"]
    C --> D["Store ciphertext in<br/>env_vars table"]

    subgraph "Key Hierarchy"
        MK["Master Key<br/>(from CAPSULE_MASTER_KEY env)"]
        PK["Project Key<br/>(derived via HKDF)"]
    end

    MK -->|"HKDF-SHA256 + project_id"| PK
    PK --> C

    D --> E["On deploy: decrypt<br/>& inject into container env"]
```

| Layer                | Encryption                          | Key Source                          |
| -------------------- | ----------------------------------- | ----------------------------------- |
| Env vars in DB       | AES-256-GCM                         | HKDF-derived project key            |
| Database passwords   | AES-256-GCM                         | Master key                          |
| Backups              | AES-256-GCM                         | User passphrase (PBKDF2)           |
| S3 objects           | SSE-S3 (AES-256)                    | AWS-managed                         |
| DB connections       | TLS 1.3                             | Auto-generated / RDS CA             |
| API traffic          | TLS 1.2+                            | Let's Encrypt (Caddy) / ACM         |

### 10.3 TLS Everywhere

```mermaid
graph LR
    subgraph "External"
        BROWSER["Browser"]
        CLI_C["CLI"]
    end

    subgraph "Edge"
        CADDY["Caddy<br/>(auto TLS via Let's Encrypt)"]
    end

    subgraph "Internal"
        API_S["API Server"]
        PG_S["PostgreSQL"]
        REDIS_S["Redis"]
        AWS_EP["AWS API Endpoints"]
    end

    BROWSER -->|"TLS 1.2+"| CADDY
    CLI_C -->|"TLS 1.2+"| CADDY
    CADDY -->|"HTTP (localhost)"| API_S
    API_S -->|"TLS (pg sslmode=require)"| PG_S
    API_S -->|"TLS"| REDIS_S
    API_S -->|"TLS (HTTPS)"| AWS_EP
```

### 10.4 RBAC for Dashboard Users

| Role         | Permissions                                                                 |
| ------------ | --------------------------------------------------------------------------- |
| **Owner**    | Full access. Manage team, billing, delete projects. One per account.        |
| **Admin**    | Create/delete projects, databases, Redis. Manage domains and env vars.      |
| **Developer**| Deploy, view logs, manage env vars. Cannot delete resources.                |
| **Viewer**   | Read-only access to all resources. Cannot modify anything.                  |

**RBAC middleware** (Go):

```go
func RequireRole(roles ...domain.Role) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            user := auth.UserFromContext(r.Context())
            for _, role := range roles {
                if user.Role == role {
                    next.ServeHTTP(w, r)
                    return
                }
            }
            http.Error(w, "Forbidden", http.StatusForbidden)
        })
    }
}

// Usage in router
r.With(RequireRole(domain.RoleOwner, domain.RoleAdmin)).
    Delete("/projects/{id}", h.DeleteProject)
```

### 10.5 Audit Logging

Every state-changing operation is recorded in the `audit_trail` table:

```json
{
  "id": "aud_abc123",
  "timestamp": "2026-05-26T08:30:15Z",
  "user_id": "usr_xyz789",
  "user_email": "admin@example.com",
  "action": "project.delete",
  "resource_type": "project",
  "resource_id": "proj_abc123",
  "ip_address": "192.168.1.100",
  "user_agent": "capsule-cli/1.0.0",
  "metadata": {
    "project_name": "my-app",
    "reason": "cleanup"
  }
}
```

**Audited actions:**

| Category     | Actions                                                       |
| ------------ | ------------------------------------------------------------- |
| Auth         | `login`, `logout`, `token.create`, `token.revoke`             |
| Projects     | `project.create`, `project.update`, `project.delete`          |
| Deployments  | `deploy.create`, `deploy.rollback`                            |
| Environment  | `env.set`, `env.unset`                                        |
| Databases    | `database.create`, `database.delete`                          |
| Redis        | `redis.create`, `redis.delete`                                |
| Domains      | `domain.add`, `domain.remove`                                 |
| Backups      | `backup.create`, `backup.restore`, `backup.export`            |
| Team         | `user.invite`, `user.remove`, `user.role_change`              |

---

## 11. API Specification

### 11.1 Base URL & Conventions

| Item             | Value                                     |
| ---------------- | ----------------------------------------- |
| Base URL         | `https://{host}/api/v1`                   |
| Content Type     | `application/json` (unless file upload)   |
| Auth Header      | `Authorization: Bearer <token>`           |
| Pagination       | `?page=1&per_page=20`                     |
| Sorting          | `?sort=created_at&order=desc`             |
| Error format     | `{"error": {"code": "...", "message": "..."}}` |

### 11.2 Authentication

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| POST   | `/auth/register`            | Create account             | No   |
| POST   | `/auth/login`               | Login → JWT                | No   |
| POST   | `/auth/refresh`             | Refresh JWT                | Yes  |
| POST   | `/auth/logout`              | Invalidate refresh token   | Yes  |
| GET    | `/auth/me`                  | Get current user           | Yes  |
| POST   | `/auth/tokens`              | Create API token           | Yes  |
| GET    | `/auth/tokens`              | List API tokens            | Yes  |
| DELETE | `/auth/tokens/{tokenId}`    | Revoke API token           | Yes  |

**POST `/auth/login`**

```json
// Request
{ "email": "user@example.com", "password": "********" }

// Response 200
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 86400,
  "user": {
    "id": "usr_abc123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "admin"
  }
}
```

**POST `/auth/tokens`**

```json
// Request
{ "name": "cli-macbook", "expires_at": null }

// Response 201
{
  "id": "tok_abc123",
  "name": "cli-macbook",
  "token": "cap_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_abc",
  "created_at": "2026-05-26T08:00:00Z"
}
```

### 11.3 Projects

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| GET    | `/projects`                 | List all projects          | Yes  |
| POST   | `/projects`                 | Create project             | Yes  |
| GET    | `/projects/{id}`            | Get project detail         | Yes  |
| PATCH  | `/projects/{id}`            | Update project             | Yes  |
| DELETE | `/projects/{id}`            | Delete project             | Yes  |

**POST `/projects`**

```json
// Request
{
  "name": "my-app",
  "framework": "nextjs",
  "deploy_target": "lambda",
  "region": "us-east-1",
  "git_url": "https://github.com/user/my-app.git",
  "branch": "main",
  "build_command": "npm run build",
  "start_command": "npm start",
  "root_directory": "/"
}

// Response 201
{
  "id": "proj_abc123",
  "name": "my-app",
  "framework": "nextjs",
  "deploy_target": "lambda",
  "region": "us-east-1",
  "status": "created",
  "url": "https://my-app.capsule.dev",
  "created_at": "2026-05-26T08:00:00Z",
  "updated_at": "2026-05-26T08:00:00Z"
}
```

### 11.4 Deployments

| Method | Path                                      | Description                | Auth |
| ------ | ----------------------------------------- | -------------------------- | ---- |
| GET    | `/projects/{projectId}/deployments`       | List deployments           | Yes  |
| POST   | `/projects/{projectId}/deployments`       | Create deployment (upload) | Yes  |
| GET    | `/deployments/{id}`                       | Get deployment detail      | Yes  |
| POST   | `/deployments/{id}/rollback`              | Rollback to deployment     | Yes  |
| POST   | `/deployments/{id}/cancel`                | Cancel running deploy      | Yes  |

**POST `/projects/{projectId}/deployments`**

```
Content-Type: multipart/form-data

Fields:
  source: <file.tar.gz>            # Source archive
  branch: "main"                   # Git branch (optional)
  commit_sha: "abc1234"            # Git commit (optional)
  commit_message: "fix: bug"       # Commit message (optional)
```

```json
// Response 202
{
  "id": "dep_xyz789",
  "project_id": "proj_abc123",
  "status": "queued",
  "version": 42,
  "branch": "main",
  "commit_sha": "abc1234",
  "created_at": "2026-05-26T08:30:00Z"
}
```

### 11.5 Databases

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| GET    | `/databases`                | List all databases         | Yes  |
| POST   | `/databases`                | Create database            | Yes  |
| GET    | `/databases/{id}`           | Get database detail        | Yes  |
| DELETE | `/databases/{id}`           | Delete database            | Yes  |
| POST   | `/databases/{id}/start`     | Start (Docker mode)        | Yes  |
| POST   | `/databases/{id}/stop`      | Stop (Docker mode)         | Yes  |

**POST `/databases`**

```json
// Request
{
  "name": "my-db",
  "engine": "postgresql",
  "version": "16",
  "serverless": false,
  "project_id": "proj_abc123"
}

// Response 201
{
  "id": "db_abc123",
  "name": "my-db",
  "engine": "postgresql",
  "version": "16",
  "mode": "docker",
  "status": "provisioning",
  "connection_uri": null,
  "created_at": "2026-05-26T08:00:00Z"
}
```

**GET `/databases/{id}`** (after provisioning)

```json
{
  "id": "db_abc123",
  "name": "my-db",
  "engine": "postgresql",
  "version": "16",
  "mode": "docker",
  "status": "running",
  "connection_uri": "postgresql://capsule_mydb:****@10.0.1.5:5432/capsule_mydb?sslmode=require",
  "host": "10.0.1.5",
  "port": 5432,
  "database": "capsule_mydb",
  "username": "capsule_mydb",
  "size_bytes": 52428800,
  "created_at": "2026-05-26T08:00:00Z"
}
```

### 11.6 Redis

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| GET    | `/redis`                    | List Redis instances       | Yes  |
| POST   | `/redis`                    | Create Redis instance      | Yes  |
| GET    | `/redis/{id}`               | Get Redis detail           | Yes  |
| DELETE | `/redis/{id}`               | Delete Redis instance      | Yes  |

**POST `/redis`**

```json
// Request
{
  "name": "my-cache",
  "version": "7",
  "max_memory_mb": 256,
  "project_id": "proj_abc123"
}

// Response 201
{
  "id": "rds_abc123",
  "name": "my-cache",
  "version": "7",
  "status": "provisioning",
  "connection_uri": null,
  "max_memory_mb": 256,
  "created_at": "2026-05-26T08:00:00Z"
}
```

### 11.7 Domains

| Method | Path                                     | Description                | Auth |
| ------ | ---------------------------------------- | -------------------------- | ---- |
| GET    | `/projects/{projectId}/domains`          | List domains               | Yes  |
| POST   | `/projects/{projectId}/domains`          | Add custom domain          | Yes  |
| DELETE | `/projects/{projectId}/domains/{id}`     | Remove domain              | Yes  |
| POST   | `/projects/{projectId}/domains/{id}/verify` | Verify DNS config       | Yes  |

**POST `/projects/{projectId}/domains`**

```json
// Request
{ "domain": "app.example.com" }

// Response 201
{
  "id": "dom_abc123",
  "domain": "app.example.com",
  "status": "pending_verification",
  "dns_record": {
    "type": "CNAME",
    "name": "app.example.com",
    "value": "proj-abc123.capsule.dev"
  },
  "tls_status": "pending",
  "created_at": "2026-05-26T08:00:00Z"
}
```

### 11.8 Environment Variables

| Method | Path                                     | Description                | Auth |
| ------ | ---------------------------------------- | -------------------------- | ---- |
| GET    | `/projects/{projectId}/env`              | List env vars (masked)     | Yes  |
| PUT    | `/projects/{projectId}/env`              | Set env vars (bulk)        | Yes  |
| DELETE | `/projects/{projectId}/env/{key}`        | Unset env var              | Yes  |

**PUT `/projects/{projectId}/env`**

```json
// Request
{
  "variables": {
    "DATABASE_URL": "postgresql://...",
    "REDIS_URL": "redis://...",
    "API_KEY": "sk-abc123"
  }
}

// Response 200
{
  "variables": [
    { "key": "DATABASE_URL", "value": "postgresql://…****", "updated_at": "2026-05-26T08:00:00Z" },
    { "key": "REDIS_URL",    "value": "redis://…****",      "updated_at": "2026-05-26T08:00:00Z" },
    { "key": "API_KEY",      "value": "sk-****",            "updated_at": "2026-05-26T08:00:00Z" }
  ]
}
```

### 11.9 Logs

| Method | Path                                     | Description                | Auth |
| ------ | ---------------------------------------- | -------------------------- | ---- |
| GET    | `/projects/{projectId}/logs`             | Query historical logs      | Yes  |
| GET    | `/deployments/{deployId}/logs`           | Get deployment build logs  | Yes  |
| WS     | `/ws`                                   | WebSocket for real-time    | Yes  |

**GET `/projects/{projectId}/logs`**

```
Query params:
  since:    RFC3339 timestamp (default: 1h ago)
  until:    RFC3339 timestamp (default: now)
  level:    INFO,WARN,ERROR (comma-separated filter)
  search:   Full-text search query
  limit:    Max lines (default: 500, max: 5000)
  order:    asc | desc (default: desc)
```

```json
// Response 200
{
  "logs": [
    {
      "timestamp": "2026-05-26T08:30:15.123Z",
      "level": "INFO",
      "message": "HTTP request completed",
      "source": "application",
      "fields": { "status": 200, "path": "/api/users" }
    }
  ],
  "total": 1523,
  "has_more": true
}
```

### 11.10 Backups

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| GET    | `/backups`                  | List backups               | Yes  |
| POST   | `/backups`                  | Create full backup         | Yes  |
| GET    | `/backups/{id}`             | Get backup detail          | Yes  |
| GET    | `/backups/{id}/download`    | Download backup package    | Yes  |
| POST   | `/backups/restore`          | Restore from backup        | Yes  |
| DELETE | `/backups/{id}`             | Delete backup              | Yes  |

**POST `/backups`**

```json
// Request
{
  "name": "pre-migration-backup",
  "include_databases": true,
  "include_redis": true,
  "include_env_vars": true,
  "encryption_passphrase": "secure-passphrase-here"
}

// Response 202
{
  "id": "bak_abc123",
  "name": "pre-migration-backup",
  "status": "in_progress",
  "size_bytes": null,
  "created_at": "2026-05-26T08:00:00Z"
}
```

### 11.11 Servers

| Method | Path                        | Description                | Auth |
| ------ | --------------------------- | -------------------------- | ---- |
| GET    | `/servers`                  | List provisioned servers   | Yes  |
| GET    | `/servers/{id}`             | Get server detail          | Yes  |
| GET    | `/servers/{id}/metrics`     | Get server metrics         | Yes  |
| POST   | `/servers/{id}/reboot`      | Reboot server              | Yes  |

### 11.12 Metrics

| Method | Path                                     | Description                | Auth |
| ------ | ---------------------------------------- | -------------------------- | ---- |
| GET    | `/projects/{projectId}/metrics`          | Get project metrics        | Yes  |
| GET    | `/servers/{serverId}/metrics`            | Get server metrics         | Yes  |
| GET    | `/databases/{dbId}/metrics`              | Get database metrics       | Yes  |

**GET `/projects/{projectId}/metrics`**

```
Query params:
  period:   1h, 6h, 24h, 7d, 30d
  metrics:  requests,errors,latency,cpu,memory (comma-separated)
```

---

## 12. Database Schema

### 12.1 Entity-Relationship Diagram

```mermaid
erDiagram
    users ||--o{ projects : "owns"
    users ||--o{ api_tokens : "has"
    users ||--o{ audit_trail : "generates"
    projects ||--o{ deployments : "has"
    projects ||--o{ env_vars : "has"
    projects ||--o{ domains : "has"
    projects ||--o{ databases : "has"
    projects ||--o{ redis_instances : "has"
    projects ||--o{ build_logs : "generates"
    deployments ||--o{ build_logs : "generates"
    projects ||--o{ backups : "included in"

    users {
        uuid id PK
        text email UK
        text name
        text password_hash
        text role "owner|admin|developer|viewer"
        timestamptz created_at
        timestamptz updated_at
        timestamptz last_login_at
        boolean is_active
    }

    api_tokens {
        uuid id PK
        uuid user_id FK
        text name
        text token_hash UK
        text token_prefix "cap_xxxx (first 8 chars)"
        timestamptz created_at
        timestamptz expires_at "nullable"
        timestamptz last_used_at "nullable"
        boolean is_revoked
    }

    projects {
        uuid id PK
        uuid user_id FK
        text name UK
        text framework "nextjs|go|python|docker|static"
        text deploy_target "lambda|ec2|ecs"
        text region
        text git_url "nullable"
        text branch
        text build_command
        text start_command
        text root_directory
        text status "created|deploying|deployed|failed|stopped"
        text url "nullable"
        text aws_resource_id "nullable - EC2/Lambda ID"
        jsonb settings "additional config"
        timestamptz created_at
        timestamptz updated_at
    }

    deployments {
        uuid id PK
        uuid project_id FK
        integer version "auto-increment per project"
        text status "queued|building|deploying|live|failed|rolled_back"
        text branch "nullable"
        text commit_sha "nullable"
        text commit_message "nullable"
        text source_artifact_key "S3 key for source tarball"
        text image_uri "nullable - ECR image URI"
        text function_url "nullable - Lambda URL"
        text error_message "nullable"
        timestamptz started_at "nullable"
        timestamptz finished_at "nullable"
        timestamptz created_at
    }

    env_vars {
        uuid id PK
        uuid project_id FK
        text key
        bytea encrypted_value "AES-256-GCM ciphertext"
        bytea nonce "GCM nonce"
        timestamptz created_at
        timestamptz updated_at
    }

    domains {
        uuid id PK
        uuid project_id FK
        text domain UK
        text status "pending_verification|active|failed"
        text dns_record_type "A|CNAME"
        text dns_record_value
        text tls_status "pending|active|error"
        text route53_record_id "nullable"
        timestamptz verified_at "nullable"
        timestamptz created_at
    }

    databases {
        uuid id PK
        uuid project_id FK
        text name
        text engine "postgresql|mysql"
        text version
        text mode "docker|serverless"
        text status "provisioning|running|stopped|deleting|deleted"
        text host
        integer port
        text database_name
        text username
        bytea encrypted_password
        text connection_uri_template "with placeholder for password"
        text aws_resource_id "nullable - RDS/Aurora ID"
        text container_id "nullable - Docker container ID"
        bigint size_bytes
        timestamptz created_at
        timestamptz updated_at
    }

    redis_instances {
        uuid id PK
        uuid project_id FK
        text name
        text version
        text status "provisioning|running|stopped|deleting|deleted"
        text host
        integer port
        bytea encrypted_password "nullable"
        integer max_memory_mb
        text container_id "nullable"
        text aws_resource_id "nullable - ElastiCache ID"
        timestamptz created_at
        timestamptz updated_at
    }

    build_logs {
        uuid id PK
        uuid project_id FK
        uuid deployment_id FK "nullable"
        text level "TRACE|DEBUG|INFO|WARN|ERROR|FATAL"
        text source "build|deploy|application|system"
        text message
        jsonb fields "structured metadata"
        timestamptz timestamp
    }

    audit_trail {
        uuid id PK
        uuid user_id FK
        text user_email
        text action "domain.verb"
        text resource_type
        text resource_id "nullable"
        text ip_address
        text user_agent
        jsonb metadata "nullable"
        timestamptz timestamp
    }

    backups {
        uuid id PK
        uuid user_id FK
        text name
        text status "in_progress|completed|failed"
        text s3_key "nullable"
        bigint size_bytes "nullable"
        boolean includes_databases
        boolean includes_redis
        boolean includes_env_vars
        jsonb contents_summary "project/db/redis counts"
        text error_message "nullable"
        timestamptz completed_at "nullable"
        timestamptz created_at
    }

    jobs {
        uuid id PK
        text type "BUILD|DEPLOY|BACKUP"
        jsonb payload
        text status "PENDING|RUNNING|SUCCEEDED|FAILED"
        integer attempts
        integer max_attempts
        timestamptz run_at
        text locked_by "nullable"
        timestamptz locked_at "nullable"
        text error "nullable"
        timestamptz created_at
        timestamptz updated_at
    }
```

### 12.2 Table Definitions

#### `users`

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'developer'
                    CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users (email);
```

#### `api_tokens`

```sql
CREATE TABLE api_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    token_hash      TEXT NOT NULL UNIQUE,
    token_prefix    TEXT NOT NULL,
    is_revoked      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ
);

CREATE INDEX idx_api_tokens_user     ON api_tokens (user_id);
CREATE INDEX idx_api_tokens_hash     ON api_tokens (token_hash) WHERE NOT is_revoked;
```

#### `projects`

```sql
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL UNIQUE,
    framework       TEXT NOT NULL CHECK (framework IN ('nextjs', 'go', 'python', 'docker', 'static')),
    deploy_target   TEXT NOT NULL CHECK (deploy_target IN ('lambda', 'ec2', 'ecs')),
    region          TEXT NOT NULL DEFAULT 'us-east-1',
    git_url         TEXT,
    branch          TEXT NOT NULL DEFAULT 'main',
    build_command   TEXT,
    start_command   TEXT,
    root_directory  TEXT NOT NULL DEFAULT '/',
    status          TEXT NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created', 'deploying', 'deployed', 'failed', 'stopped')),
    url             TEXT,
    aws_resource_id TEXT,
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_user   ON projects (user_id);
CREATE INDEX idx_projects_status ON projects (status);
```

#### `deployments`

```sql
CREATE TABLE deployments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version             INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'building', 'deploying', 'live', 'failed', 'rolled_back')),
    branch              TEXT,
    commit_sha          TEXT,
    commit_message      TEXT,
    source_artifact_key TEXT,
    image_uri           TEXT,
    function_url        TEXT,
    error_message       TEXT,
    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, version)
);

CREATE INDEX idx_deployments_project ON deployments (project_id, created_at DESC);
CREATE INDEX idx_deployments_status  ON deployments (status);
```

#### `env_vars`

```sql
CREATE TABLE env_vars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    nonce           BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, key)
);

CREATE INDEX idx_env_vars_project ON env_vars (project_id);
```

#### `domains`

```sql
CREATE TABLE domains (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain            TEXT NOT NULL UNIQUE,
    status            TEXT NOT NULL DEFAULT 'pending_verification'
                      CHECK (status IN ('pending_verification', 'active', 'failed')),
    dns_record_type   TEXT NOT NULL CHECK (dns_record_type IN ('A', 'CNAME')),
    dns_record_value  TEXT NOT NULL,
    tls_status        TEXT NOT NULL DEFAULT 'pending'
                      CHECK (tls_status IN ('pending', 'active', 'error')),
    route53_record_id TEXT,
    verified_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_domains_project ON domains (project_id);
```

#### `databases`

```sql
CREATE TABLE databases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    engine                  TEXT NOT NULL CHECK (engine IN ('postgresql', 'mysql')),
    version                 TEXT NOT NULL,
    mode                    TEXT NOT NULL CHECK (mode IN ('docker', 'serverless')),
    status                  TEXT NOT NULL DEFAULT 'provisioning'
                            CHECK (status IN ('provisioning', 'running', 'stopped', 'deleting', 'deleted')),
    host                    TEXT,
    port                    INTEGER,
    database_name           TEXT,
    username                TEXT,
    encrypted_password      BYTEA,
    connection_uri_template TEXT,
    aws_resource_id         TEXT,
    container_id            TEXT,
    size_bytes              BIGINT DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, name)
);

CREATE INDEX idx_databases_project ON databases (project_id);
CREATE INDEX idx_databases_status  ON databases (status);
```

#### `redis_instances`

```sql
CREATE TABLE redis_instances (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    version            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'provisioning'
                       CHECK (status IN ('provisioning', 'running', 'stopped', 'deleting', 'deleted')),
    host               TEXT,
    port               INTEGER,
    encrypted_password BYTEA,
    max_memory_mb      INTEGER NOT NULL DEFAULT 256,
    container_id       TEXT,
    aws_resource_id    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (project_id, name)
);

CREATE INDEX idx_redis_project ON redis_instances (project_id);
```

#### `build_logs`

```sql
CREATE TABLE build_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    deployment_id   UUID REFERENCES deployments(id) ON DELETE SET NULL,
    level           TEXT NOT NULL DEFAULT 'INFO'
                    CHECK (level IN ('TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')),
    source          TEXT NOT NULL DEFAULT 'application'
                    CHECK (source IN ('build', 'deploy', 'application', 'system')),
    message         TEXT NOT NULL,
    fields          JSONB DEFAULT '{}',
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_build_logs_project_time   ON build_logs (project_id, timestamp DESC);
CREATE INDEX idx_build_logs_deployment     ON build_logs (deployment_id, timestamp DESC);
CREATE INDEX idx_build_logs_level          ON build_logs (level) WHERE level IN ('ERROR', 'FATAL');

-- Partition by month for large installations
-- CREATE TABLE build_logs_2026_05 PARTITION OF build_logs
--     FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
```

#### `audit_trail`

```sql
CREATE TABLE audit_trail (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_email      TEXT NOT NULL,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     TEXT,
    ip_address      TEXT,
    user_agent      TEXT,
    metadata        JSONB,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_user      ON audit_trail (user_id, timestamp DESC);
CREATE INDEX idx_audit_action    ON audit_trail (action, timestamp DESC);
CREATE INDEX idx_audit_resource  ON audit_trail (resource_type, resource_id);
```

#### `backups`

```sql
CREATE TABLE backups (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed', 'failed')),
    s3_key              TEXT,
    size_bytes          BIGINT,
    includes_databases  BOOLEAN NOT NULL DEFAULT true,
    includes_redis      BOOLEAN NOT NULL DEFAULT true,
    includes_env_vars   BOOLEAN NOT NULL DEFAULT true,
    contents_summary    JSONB DEFAULT '{}',
    error_message       TEXT,
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_backups_user ON backups (user_id, created_at DESC);
```

#### `jobs`

```sql
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            TEXT NOT NULL CHECK (type IN ('BUILD', 'DEPLOY', 'BACKUP')),
    payload         JSONB NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3,
    run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by       TEXT,
    locked_at       TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_claimable ON jobs (created_at)
    WHERE status = 'PENDING' AND run_at <= now();
CREATE INDEX idx_jobs_status    ON jobs (status);
```

### 12.3 Migration Strategy

Capsule uses **golang-migrate** for version-controlled schema migrations.

```
migrations/
├── 000001_create_users.up.sql
├── 000001_create_users.down.sql
├── 000002_create_api_tokens.up.sql
├── 000002_create_api_tokens.down.sql
├── 000003_create_projects.up.sql
├── 000003_create_projects.down.sql
├── 000004_create_deployments.up.sql
├── 000004_create_deployments.down.sql
├── 000005_create_env_vars.up.sql
├── 000005_create_env_vars.down.sql
├── 000006_create_domains.up.sql
├── 000006_create_domains.down.sql
├── 000007_create_databases.up.sql
├── 000007_create_databases.down.sql
├── 000008_create_redis_instances.up.sql
├── 000008_create_redis_instances.down.sql
├── 000009_create_build_logs.up.sql
├── 000009_create_build_logs.down.sql
├── 000010_create_audit_trail.up.sql
├── 000010_create_audit_trail.down.sql
├── 000011_create_backups.up.sql
├── 000011_create_backups.down.sql
├── 000012_create_jobs.up.sql
└── 000012_create_jobs.down.sql
```

**Migration rules:**

1. Every migration has an `up` and `down` script
2. Migrations are applied automatically on server startup (configurable)
3. New columns are added as `NULL` first, then backfilled, then set `NOT NULL`
4. Index creation uses `CONCURRENTLY` for zero-downtime on large tables
5. Destructive changes (column removal) are done in two phases: deprecate → remove

**Migration execution:**

```go
func RunMigrations(dbURL string) error {
    m, err := migrate.New(
        "file://migrations",
        dbURL,
    )
    if err != nil {
        return fmt.Errorf("migration init: %w", err)
    }
    if err := m.Up(); err != nil && err != migrate.ErrNoChange {
        return fmt.Errorf("migration up: %w", err)
    }
    return nil
}
```

---

## Appendix A: Technology Decisions Summary

| Decision                   | Choice                    | Rationale                                                |
| -------------------------- | ------------------------- | -------------------------------------------------------- |
| Monorepo vs polyrepo       | Monorepo                  | Shared types, atomic changes, simpler CI                 |
| API language               | Go                        | Performance, single binary, strong AWS SDK, concurrency  |
| Frontend framework         | Next.js (App Router)      | SSR, file-based routing, React ecosystem                 |
| CLI framework              | Cobra                     | Go standard, excellent UX primitives                     |
| HTTP router                | chi                       | Lightweight, middleware-friendly, stdlib-compatible       |
| Database                   | PostgreSQL                | JSONB support, reliability, Aurora compatibility         |
| Job queue                  | PG-backed (SKIP LOCKED)   | No extra infra for self-hosted, battle-tested pattern    |
| Real-time                  | WebSocket (gorilla)       | Low-latency log streaming, wide client support           |
| State management           | Zustand + React Query     | Minimal boilerplate, cache-first server state            |
| CSS                        | Tailwind + shadcn/ui      | Utility-first, accessible components, rapid iteration    |
| IaC                        | Terraform                 | Multi-resource orchestration, state management           |
| Encryption                 | AES-256-GCM               | Authenticated encryption, NIST approved                  |
| Container registry         | ECR                       | Native AWS integration, no egress costs                  |
| Build system               | CodeBuild                 | Managed, scales to zero, Docker-in-Docker support        |

## Appendix B: Environment Variables (Server)

| Variable                  | Required | Default          | Description                           |
| ------------------------- | -------- | ---------------- | ------------------------------------- |
| `CAPSULE_DATABASE_URL`    | Yes      | —                | PostgreSQL connection string          |
| `CAPSULE_MASTER_KEY`      | Yes      | —                | 32-byte hex for encryption            |
| `CAPSULE_JWT_SECRET`      | Yes      | —                | JWT signing secret                    |
| `CAPSULE_AWS_REGION`      | Yes      | `us-east-1`      | Default AWS region                    |
| `CAPSULE_AWS_PROFILE`     | No       | `default`        | AWS CLI profile name                  |
| `CAPSULE_S3_BUCKET`       | Yes      | —                | S3 bucket for artifacts & backups     |
| `CAPSULE_DOMAIN`          | No       | `capsule.dev`    | Base domain for project URLs          |
| `CAPSULE_PORT`            | No       | `8080`           | API server port                       |
| `CAPSULE_LOG_LEVEL`       | No       | `info`           | Log level (debug/info/warn/error)     |
| `CAPSULE_WORKER_COUNT`    | No       | `4`              | Number of queue consumer goroutines   |
| `CAPSULE_REDIS_URL`       | No       | —                | Redis URL for caching (optional)      |
| `CAPSULE_CORS_ORIGINS`    | No       | `*`              | Allowed CORS origins                  |

---

*This document is a living artifact. It will be updated as Capsule evolves through development milestones.*
