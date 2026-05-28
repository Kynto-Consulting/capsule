# Capsule Developer Onboarding Guide

Welcome to Capsule. This document gets you from a fresh clone to a running local environment and explains how we work day-to-day.

---

## 1. Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Go | 1.22+ | Required for backend and CLI |
| Node.js | 18+ | Required for frontend |
| pnpm | latest | `npm install -g pnpm` |
| Docker & Docker Compose | latest | Required for Postgres and Redis |
| Make | any | Available by default on Linux/macOS; install via Chocolatey or Git Bash on Windows |
| golangci-lint | latest | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |

---

## 2. First-Time Setup

### Clone

```bash
git clone git@github.com:kynto/capsule.git
cd capsule
```

### Start infrastructure dependencies

```bash
make dev
```

This starts PostgreSQL (port 5432) and Redis (port 6379) via Docker Compose and prints the next steps.

### Copy environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Edit `backend/.env` at minimum to set:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/capsule?sslmode=disable
REDIS_URL=redis://localhost:6379
CAPSULE_SECRET_KEY=dev-secret-change-in-prod
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

`frontend/.env.local` defaults are usually fine for local development:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

### Run the backend

```bash
cd backend && go run ./cmd/server
```

The API listens on `http://localhost:8080`.

### Run the frontend (separate terminal)

```bash
cd frontend && pnpm install && pnpm dev
```

The dashboard is available at `http://localhost:3000`.

### Build and verify the CLI

```bash
make build-cli
./bin/capsule version
```

---

## 3. Repository Structure

```
capsule/
├── backend/            # Go API server (REST + WebSocket)
│   ├── cmd/server/     # Main entry point
│   ├── internal/
│   │   ├── server/     # HTTP handlers and middleware (Chi router)
│   │   ├── service/    # Business logic layer
│   │   ├── repository/ # Database access layer + migrations
│   │   ├── domain/     # Domain models and interfaces
│   │   └── config/     # Configuration loading
│   └── pkg/            # Shared, importable packages
├── frontend/           # Next.js 16 web dashboard (App Router)
│   ├── app/            # Pages and layouts
│   ├── components/     # Reusable UI components
│   ├── lib/            # API client, utilities, hooks
│   └── stores/         # Zustand state stores
├── cli/                # Go CLI (Cobra + Viper)
│   ├── cmd/capsule/    # Command definitions and entry point
│   └── internal/       # API client, config, formatters
├── deploy/             # Terraform modules, Dockerfiles, infra config
├── docs/               # Architecture docs, ADRs, API specs
└── scripts/            # Automation and helper scripts
```

---

## 4. Useful Make Targets

| Target | What it does |
|--------|--------------|
| `make dev` | Start Postgres + Redis via Docker Compose |
| `make dev-all` | Start all services including backend and frontend via Docker |
| `make build` | Build backend, CLI, and frontend |
| `make build-backend` | Build `bin/capsule-server` |
| `make build-cli` | Build `bin/capsule` |
| `make build-frontend` | Build the Next.js production bundle |
| `make test` | Run all tests (backend, CLI, frontend) |
| `make lint` | Run all linters |
| `make migrate-up` | Run pending database migrations |
| `make migrate-down` | Roll back the last migration |
| `make migrate-create NAME=create_users` | Create a new migration pair |
| `make docker-build` | Build Docker images for backend and frontend |
| `make clean` | Remove build artifacts and caches |

---

## 5. Running Tests

```bash
# All tests
make test

# Backend only
make test-backend

# CLI only
make test-cli

# Frontend only
make test-frontend

# Integration tests (requires running services)
make test-integration
```

---

## 6. Contribution Workflow

1. **Branch from `main`**
   - `feat/<name>` for new features
   - `fix/<name>` for bug fixes
   - `docs/<name>` for documentation changes

2. **Check the specs** — If your change affects an endpoint, CLI command, or database schema, update the relevant spec under `docs/` first.

3. **Implement with tests** — Backend uses Go table-driven tests with `testify`. Frontend uses Vitest co-located next to components (`Component.test.tsx`).

4. **Lint and test before pushing**
   ```bash
   make lint
   make test
   ```

5. **Open a PR** with a clear description. CI must pass before merge.

---

## 7. Architecture Notes

- **Clean Architecture** — backend layers go handlers → services → repositories. Dependencies point inward; the domain layer has no external imports.
- **Repository Pattern** — database access is abstracted behind interfaces in `backend/internal/domain/`.
- **Dependency Injection** — services receive all dependencies via constructors; no globals.
- **Middleware Chain** — auth, structured logging, rate limiting, and CORS are applied as Chi middleware in `backend/internal/server/`.
- **Graceful Shutdown** — both the backend server and CLI handle `SIGTERM`/`SIGINT` cleanly.
