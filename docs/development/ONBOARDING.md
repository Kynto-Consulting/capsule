# Capsule Developer Onboarding Guide

Welcome to the **Capsule** team! This document contains everything you need to get set up, understand our workflows, and make your first contribution.

---

## 1. Setup Development Environment

### Prerequisites
- **Go**: Version 1.22+ installed and on your PATH.
- **Node.js**: Version 20+ (LTS) installed.
- **Docker & Docker Compose**: Installed and running (for Postgres, Redis, and Traefik).
- **Make**: Available on your terminal.

### Quick Start
1. Clone the repository:
   ```bash
   git clone git@github.com:kynto/capsule.git
   cd capsule
   ```

2. Initialize configuration and run external dependencies:
   ```bash
   make dev-deps
   ```
   This fires up the PostgreSQL and Redis containers in the background.

3. Run the API Backend in development mode:
   ```bash
   make dev-backend
   ```

4. In a new terminal, run the Dashboard frontend:
   ```bash
   make dev-frontend
   ```

5. Build the CLI tool locally to verify compilation:
   ```bash
   make build-cli
   ./bin/capsule --version
   ```

---

## 2. Key Directories & Architecture

- `cmd/capsule/` — Entrypoint for the CLI tool (uses Cobra).
- `cmd/server/` — Entrypoint for the Go API server.
- `pkg/` — Core Go backend business logic (Clean Architecture):
  - `domain/` — Core data structures, domain logic, and interface definitions.
  - `api/` — HTTP routers, handlers, and middlewares.
  - `aws/` — AWS SDK integrations (Lambda, EC2, Bedrock, etc.).
  - `db/` — Database migrations and repository implementations.
- `apps/dashboard/` — Next.js 14 Web Dashboard (Tailwind + Shadcn/UI).
- `docs/` — All specifications (PRD, EDD, API & CLI references).

---

## 3. Contribution Workflow (Spec-Driven)

Capsule uses **Spec-Driven Development (SDD)**. Follow these steps for any change:

1. **Check the Spec**: Verify your task against the relevant spec file under `docs/`. If you are adding or changing endpoints, commands, or database tables, you **MUST** update the spec file first and get it approved.
2. **Branch**: Create your branch from `main`:
   - `feat/feature-name` for new features.
   - `fix/bug-name` for bug fixes.
3. **Write Tests First (TDD)**: Create Go table-driven tests or frontend unit tests.
4. **Implement**: Write code conforming to `docs/development/CODING_STANDARDS.md`.
5. **Lint and Test**: Run `make lint` and `make test`.
6. **PR**: Open a PR using our Pull Request Template. Make sure CI passes completely.
