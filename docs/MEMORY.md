# Capsule Project Memory

This file serves as the **Single Source of Truth** for Capsule. All AI agents, developers, and product owners should consult this document to understand the codebase context, architectural design, coding patterns, and guidelines.

---

## 1. Core Vision & Concept

**Capsule** is a self-hosted, lightweight, and modern Developer Platform-as-a-Service (PaaS) built on AWS. It replicates the magic developer experience of platforms like Vercel and Heroku while maintaining absolute control, 100% cost transparency, and extreme portability inside the user's own AWS account.

Capsule manages five core infrastructure blocks via a unified Web Dashboard and a powerful CLI tool:
1. **Databases** (PostgreSQL, MySQL, MongoDB)
2. **Redis Cachings**
3. **Domains, IPs, & CNAMEs** (Auto SSL via Let's Encrypt + Traefik routing)
4. **Serverless Apps** (Scale-to-zero AWS Lambda functions with Function URLs)
5. **Persistent Servers & Workers** (24/7 container processes, daemons, cronjobs)

### The Portability Engine (`capsule package --everything`)
Capsule can package the entire infrastructure configuration, database dumps, Redis states, SSL certificates, and environment variables into a single encrypted ZIP file using `AES-256` encryption. This file can be uploaded to a brand new Capsule server to seamlessly migrate everything in minutes (Disaster Recovery / Zero Lock-in).

---

## 2. Technology Stack

- **CLI Tool**: Go (Golang) + Cobra library. Compile to single, cross-platform executables.
- **API Backend**: Go (Golang) + Fiber framework. Tiny footprint (~20MB memory) + fast WebSockets.
- **Web Dashboard**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + Shadcn/UI. Beautiful Tremor charts and xterm.js live log streams.
- **Database (Metadata)**: PostgreSQL + Redis for fast sessions/caches.
- **Proxy/Routing Engine**: Traefik (Docker provider). Automatic discovery of web services and auto SSL.
- **AWS Integrations**: Direct Go AWS SDK v2 integration under a restricted **IAM Sub-profile** (EC2, Lambda, ECR, Route53, S3, CodeBuild, CloudWatch, Bedrock).

---

## 3. Project Directory Map

```
capsule/
├── .agents/                 # AI Coding Agent prompts and instructions
│   ├── prompts/             # Domain prompts (backend, frontend, cli, infra)
│   └── capsule-agent.md     # General coding guidelines for AI
├── .claude/                 # Claude IDE workspace settings
│   ├── commands/            # Standard developer commands (build, test, deploy)
│   └── CLAUDE.md            # Claude context
├── .github/                 # GitHub configurations
│   ├── ISSUE_TEMPLATE/      # Sprint, bug, epic, tech debt templates
│   ├── workflows/           # CI/CD Workflows (ci.yml, release.yml)
│   └── CODEOWNERS           # Project ownership rules
├── apps/
│   └── dashboard/           # Next.js 14 Web Frontend
├── cmd/
│   ├── capsule/             # CLI command parser entrypoint (Cobra)
│   └── server/              # Go REST API backend entrypoint
├── docs/                    # Technical documentation
│   ├── architecture/        # System, Database, API, and CLI specs
│   ├── development/         # SDD, Coding standards, Testing, CI/CD, ADRs
│   ├── guides/              # Deploy, dev-setup, backup/restore
│   ├── modules/             # BEDROCK_AI_MODULE.md
│   ├── PRD.md               # Product Requirements Document
│   ├── EDD.md               # Engineering Design Document
│   └── MEMORY.md            # This File
├── pkg/                     # Go Backend Domain Logic
│   ├── api/                 # HTTP API endpoints and handlers
│   ├── aws/                 # AWS SDK provisioning code
│   ├── db/                  # DB connection and migrations
│   └── domain/              # Clean Architecture core models
└── docker-compose.yml       # Local developer containers (Postgres, Redis, Traefik)
```

---

## 4. Key Architectural Decisions (ADRs)

1. **ADR-001: Go Backend & CLI**: Small, executable, robust concurrency, secure.
2. **ADR-002: Next.js Dashboard**: Fluid single page app, dynamic state, gorgeous Shadcn controls.
3. **ADR-003: Traefik Engine**: High performance, native hot-reloading Docker routing, automated Let's Encrypt TLS.
4. **ADR-004: Direct AWS SDK**: Sub-profile IAM calls, state tracked locally in DB to bypass slow HCL processes.
5. **ADR-005: Hybrid Waterfall-Agile**: Macro Waterfall roadmap phases combined with iterative 2-week Agile sprints for velocity and structure.
6. **ADR-006: Spec-Driven Development (SDD)**: High-quality spec blueprints must precede any code modification.

---

## 5. Development Methodology Guidelines

Capsule uses a **hybrid Waterfall-Agile methodology**:
- The project is split into 6 structured macro phases (Foundation → Core Backend → Deploy Pipeline → CLI → Dashboard → Hardening).
- Development runs inside **2-week sprints** with structured daily syncs, sprint planning, retrospectives, and demos.
- High standards of quality are maintained via a strict **Definition of Done (DoD)**: >80% test coverage, golangci-lint check, peer code review, and successful E2E staging validations.
