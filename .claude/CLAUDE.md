# CLAUDE.md — Capsule Project Context

## What is Capsule?

Capsule is a cloud infrastructure management platform that simplifies environment provisioning, deployment, and monitoring. It provides a unified interface (API, CLI, and Web Dashboard) for managing cloud resources across providers, with a focus on AWS.

**Tagline:** *Your infrastructure, encapsulated.*

---

## Architecture

Capsule follows a **clean architecture** pattern with three main components:

```
capsule/
├── backend/        # Go API server (REST + WebSocket)
├── frontend/       # Next.js 14 web dashboard (App Router)
├── cli/            # Go CLI tool (Cobra-based)
├── deploy/         # Terraform modules, Dockerfiles
├── docs/           # Architecture docs, ADRs, API specs
├── scripts/        # Automation & helper scripts
└── shared/         # Shared protobuf definitions, constants
```

### Backend (Go)

- **Language:** Go 1.22+
- **Framework:** Standard library `net/http` with Chi router
- **Database:** PostgreSQL 16 via `pgx`
- **Cache:** Redis 7
- **Auth:** JWT with refresh tokens
- **Architecture:** Clean Architecture (handlers → services → repositories)
- **Key packages:**
  - `internal/server/` — HTTP handlers and middleware
  - `internal/service/` — Business logic layer
  - `internal/repository/` — Database access layer
  - `internal/domain/` — Domain models and interfaces
  - `internal/config/` — Configuration loading
  - `pkg/` — Shared, importable packages

### Frontend (Next.js)

- **Framework:** Next.js 14 with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **State:** Zustand for client state, React Query for server state
- **Key directories:**
  - `app/` — Pages and layouts (App Router)
  - `components/` — Reusable UI components
  - `lib/` — Utilities, API client, hooks
  - `stores/` — Zustand state stores

### CLI

- **Language:** Go 1.22+
- **Framework:** Cobra + Viper
- **Output:** Table, JSON, YAML formats
- **Auth:** OAuth2 device flow + token caching
- **Key directories:**
  - `cmd/capsule/` — Entry point
  - `cmd/` — Command definitions
  - `internal/` — API client, formatters, config

---

## Coding Conventions

### Go (Backend & CLI)

- Follow [Effective Go](https://go.dev/doc/effective_go) and [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments)
- **Error handling:** Always wrap errors with context using `fmt.Errorf("operation: %w", err)`
- **Naming:** Use descriptive names; avoid abbreviations except well-known ones (ctx, err, req, resp)
- **Interfaces:** Define at the consumer side, not the producer side
- **Testing:** Table-driven tests, use `testify` for assertions
- **Logging:** Structured logging with `slog`
- **Linting:** Must pass `golangci-lint run ./...`

### TypeScript (Frontend)

- Strict TypeScript — no `any` types
- Functional components with hooks
- Server Components by default, `'use client'` only when necessary
- Co-locate tests with components: `Component.test.tsx`

### General

- **Commits:** Follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, etc.)
- **Branches:** `feat/<name>`, `fix/<name>`, `docs/<name>` from `main`
- **PRs:** Must have description, passing CI, and at least one review

---

## Key Patterns

1. **Repository Pattern** — Database access is abstracted behind interfaces in `internal/domain/`
2. **Dependency Injection** — Services receive their dependencies via constructors
3. **Middleware Chain** — Auth, logging, rate limiting, CORS applied as Chi middleware
4. **Domain Events** — State changes emit events for audit logging and WebSocket notifications
5. **Feature Flags** — Runtime feature toggling via environment variables or database
6. **Graceful Shutdown** — All servers handle SIGTERM/SIGINT for clean shutdown

---

## How to Add a New Feature

1. **Define the domain model** in `backend/internal/domain/`
2. **Create the repository interface** in `backend/internal/domain/` and implement in `backend/internal/repository/`
3. **Implement the service** in `backend/internal/service/`
4. **Add HTTP handlers** in `backend/internal/server/`
5. **Register routes** in `backend/internal/server/router.go`
6. **Add CLI command** in `cli/cmd/` if the feature needs CLI access
7. **Build frontend UI** in `frontend/app/` and `frontend/components/`
8. **Write tests** at every layer
9. **Update OpenAPI spec** in `docs/api/`

---

## How to Run Locally

```bash
# Start all dependencies
docker compose up -d postgres redis

# Run backend
cd backend && go run ./cmd/server

# Run frontend
cd frontend && pnpm dev

# Run CLI (after building)
cd cli && go run ./cmd/capsule -- version
```

---

## Environment Variables

| Variable            | Default              | Description               |
|---------------------|----------------------|---------------------------|
| `CAPSULE_ENV`       | `development`        | Environment name          |
| `CAPSULE_PORT`      | `8080`               | Backend API port          |
| `DATABASE_URL`      | (required)           | PostgreSQL connection URL |
| `REDIS_URL`         | `redis://localhost:6379` | Redis connection URL  |
| `CAPSULE_SECRET_KEY`| (required in prod)   | JWT signing key           |

---

## Useful Commands

```bash
make build          # Build all components
make test           # Run all tests
make lint           # Run all linters
make dev            # Start dev environment
make docker-build   # Build Docker images
make clean          # Clean build artifacts
```
