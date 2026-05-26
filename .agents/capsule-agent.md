# Capsule Agent Instructions

You are an AI coding agent working on the **Capsule** project — a cloud infrastructure management platform built by **Kynto**.

---

## Project Overview

Capsule provides a unified interface for provisioning, deploying, and monitoring cloud infrastructure. It targets AWS as its primary cloud provider, with a modular design that allows future multi-cloud support.

**Core value proposition:** Abstract away cloud complexity into reusable "capsules" — encapsulated environment definitions that can be versioned, shared, and deployed consistently.

---

## Architecture

Capsule is a monorepo with three main components:

```
capsule/
├── backend/          # Go 1.22+ REST/WebSocket API server
│   ├── cmd/server/   # Application entry point
│   ├── internal/
│   │   ├── config/   # Configuration (env vars, defaults)
│   │   ├── domain/   # Domain models, interfaces, errors
│   │   ├── server/   # HTTP handlers, middleware, router
│   │   ├── service/  # Business logic layer
│   │   └── repository/ # Database access (PostgreSQL via pgx)
│   └── pkg/          # Shared, importable packages
│
├── frontend/         # Next.js 14 (App Router) + TypeScript
│   ├── app/          # Pages and layouts
│   ├── components/   # Reusable UI components (shadcn/ui)
│   ├── lib/          # Utilities, API client, hooks
│   └── stores/       # Client state (Zustand)
│
├── cli/              # Go 1.22+ CLI tool (Cobra + Viper)
│   ├── cmd/capsule/  # Entry point
│   ├── cmd/          # Subcommand definitions
│   └── internal/     # API client, formatters, config
│
├── deploy/           # Terraform modules, Dockerfiles, scripts
├── docs/             # ADRs, API specs (OpenAPI), architecture docs
├── shared/           # Shared protobuf definitions, constants
├── scripts/          # Automation and helper scripts
├── Makefile          # Build orchestration
├── docker-compose.yml      # Local development services
└── docker-compose.prod.yml # Production deployment
```

---

## Technology Stack

| Layer           | Technology                              |
|-----------------|-----------------------------------------|
| Backend API     | Go 1.22+, Chi router, pgx, slog        |
| Frontend        | Next.js 14, TypeScript, Tailwind, shadcn/ui |
| CLI             | Go 1.22+, Cobra, Viper                  |
| Database        | PostgreSQL 16                           |
| Cache           | Redis 7                                 |
| Auth            | JWT (access + refresh tokens)           |
| Reverse Proxy   | Traefik                                 |
| CI/CD           | GitHub Actions                          |
| Infrastructure  | AWS (EC2, RDS, S3, IAM), Terraform      |
| Containers      | Docker, Docker Compose                  |

---

## Coding Standards

### Go Conventions (Backend & CLI)

1. **Follow [Effective Go](https://go.dev/doc/effective_go)** and the [Go Code Review Comments](https://github.com/golang/go/wiki/CodeReviewComments).

2. **Error handling:**
   - Never ignore errors. Always handle or return them.
   - Wrap errors with context: `fmt.Errorf("creating environment %s: %w", name, err)`
   - Use sentinel errors for known conditions: `var ErrNotFound = errors.New("not found")`
   - Use custom error types for domain errors that carry metadata.

3. **Naming:**
   - Exported types, functions, and methods get doc comments.
   - Unexported helpers use concise but clear names.
   - Avoid stutter: `environment.Environment` → bad; `environment.Env` or just the model in `domain` → good.

4. **Interfaces:**
   - Define interfaces at the **consumer** side, not the producer.
   - Keep interfaces small (1-3 methods preferred).
   - Use `io.Reader`, `io.Writer`, and standard library interfaces where possible.

5. **Concurrency:**
   - Always pass `context.Context` as the first parameter.
   - Use `errgroup` for coordinated goroutines.
   - Protect shared state with `sync.Mutex` or channels — prefer channels for communication.

6. **Testing:**
   - Table-driven tests are the default pattern.
   - Use `testify/assert` for soft assertions, `testify/require` for hard assertions.
   - Test file naming: `handler.go` → `handler_test.go`.
   - Integration tests use `//go:build integration` build tag.
   - Mock external dependencies via interfaces; put mocks in `internal/mocks/`.

7. **Logging:**
   - Use `log/slog` with structured fields.
   - Log at appropriate levels: `Debug` for dev, `Info` for operations, `Warn` for recoverable issues, `Error` for failures.

8. **Linting:**
   - All code must pass `golangci-lint run ./...` with the project config.

### TypeScript Conventions (Frontend)

1. **Strict mode** — no `any` types.
2. **Server Components by default** — use `'use client'` only when needed.
3. **Component structure:** Props interface → component → export default.
4. **State management:** Zustand for client state, React Query (TanStack Query) for server state.
5. **Styling:** Tailwind CSS utility classes; no inline styles or CSS modules.

---

## Key Patterns

### Clean Architecture (Backend)

```
HTTP Request → Handler → Service → Repository → Database
                  ↑           ↑          ↑
              Middleware    Domain     Domain
              (auth,       Models     Interfaces
               logging)
```

- **Handlers** parse HTTP, validate input, call services, write responses.
- **Services** contain business logic, orchestrate repositories, emit events.
- **Repositories** handle data persistence, return domain models.
- **Domain** defines models, interfaces, and error types shared across layers.

### Dependency Injection

```go
func NewEnvironmentService(
    repo domain.EnvironmentRepository,
    cache domain.CacheStore,
    logger *slog.Logger,
) *EnvironmentService {
    return &EnvironmentService{repo: repo, cache: cache, logger: logger}
}
```

### API Response Format

```json
{
  "data": { ... },
  "meta": {
    "page": 1,
    "per_page": 20,
    "total": 42
  }
}
```

Error responses:

```json
{
  "error": {
    "code": "ENVIRONMENT_NOT_FOUND",
    "message": "Environment 'prod-us-east' was not found",
    "details": {}
  }
}
```

---

## How to Add a New Feature

1. **Domain first:** Define models and repository interfaces in `backend/internal/domain/`.
2. **Repository:** Implement the data access layer in `backend/internal/repository/`.
3. **Service:** Implement business logic in `backend/internal/service/`.
4. **Handler:** Add HTTP endpoints in `backend/internal/server/`.
5. **Routes:** Register in `backend/internal/server/router.go`.
6. **CLI (if needed):** Add Cobra commands in `cli/cmd/`.
7. **Frontend (if needed):** Add pages/components in `frontend/`.
8. **Tests:** Write tests at every layer (unit + integration).
9. **Docs:** Update OpenAPI spec in `docs/api/`.

---

## How to Run & Test

```bash
# Start dependencies
docker compose up -d postgres redis

# Run backend
cd backend && go run ./cmd/server

# Run frontend
cd frontend && pnpm install && pnpm dev

# Run CLI
cd cli && go run ./cmd/capsule -- version

# Run all tests
make test

# Run linters
make lint

# Build everything
make build
```

---

## Important Files

| File                        | Purpose                               |
|-----------------------------|---------------------------------------|
| `Makefile`                  | Build orchestration for all components|
| `docker-compose.yml`       | Local development services            |
| `.github/workflows/ci.yml` | CI pipeline                           |
| `backend/internal/domain/` | Core domain models and interfaces     |
| `backend/internal/server/router.go` | API route registration       |
| `frontend/app/layout.tsx`  | Root layout                           |
| `cli/cmd/capsule/main.go`  | CLI entry point                       |

---

## Do's and Don'ts

### ✅ Do

- Write tests for every new feature
- Use meaningful commit messages following Conventional Commits
- Handle errors explicitly with context
- Use structured logging
- Keep functions short and focused
- Document exported APIs

### ❌ Don't

- Commit `.env` files or secrets
- Use `panic()` for error handling (except in `main()` initialization)
- Add dependencies without discussing in PR
- Bypass the service layer from handlers
- Use `any` / `interface{}` without strong justification
- Write tests that depend on external services without mocks
