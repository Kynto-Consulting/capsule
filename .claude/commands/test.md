# Test Commands — Capsule

## Overview

Instructions for running the full test suite across all Capsule packages.

---

## Run All Tests

```bash
make test
```

---

## Backend Tests (Go)

```bash
# Run all backend tests
cd backend
go test ./...

# Run with verbose output
go test -v ./...

# Run with race detector
go test -race ./...

# Run a specific package
go test -v ./internal/server/...

# Run a specific test function
go test -v -run TestCreateEnvironment ./internal/server/...

# Run with coverage
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html

# Run integration tests (requires running database)
go test -tags=integration -v ./...

# Short mode (skip long-running tests)
go test -short ./...
```

### Backend Test Conventions

- Unit tests live alongside source files: `handler.go` → `handler_test.go`
- Integration tests use build tag `//go:build integration`
- Table-driven tests are preferred
- Use `testify/assert` and `testify/require` for assertions
- Mock interfaces with `gomock` or hand-written mocks in `internal/mocks/`

---

## Frontend Tests (Next.js)

```bash
# Run all frontend tests
cd frontend
pnpm test

# Run in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run a specific test file
pnpm test -- --testPathPattern="components/Dashboard"

# Run E2E tests (Playwright)
pnpm test:e2e

# Run E2E in headed mode (visible browser)
pnpm test:e2e -- --headed
```

### Frontend Test Conventions

- Unit tests: `ComponentName.test.tsx` alongside component
- Use React Testing Library for component tests
- Use MSW (Mock Service Worker) for API mocking
- E2E tests live in `frontend/e2e/`

---

## CLI Tests (Go)

```bash
# Run all CLI tests
cd cli
go test ./...

# Run with verbose output
go test -v ./...

# Run with race detector
go test -race ./...

# Run a specific command test
go test -v -run TestDeployCommand ./cmd/...

# Run with coverage
go test -coverprofile=coverage.out ./...
go tool cover -func=coverage.out
```

### CLI Test Conventions

- Test command output using `bytes.Buffer` as stdout/stderr
- Test flag parsing and validation
- Mock API client calls via interfaces

---

## Linting

```bash
# Run all linters
make lint

# Backend linting
cd backend && golangci-lint run ./...

# CLI linting
cd cli && golangci-lint run ./...

# Frontend linting
cd frontend && pnpm lint
```

---

## Coverage Thresholds

| Component | Minimum Coverage |
|-----------|-----------------|
| Backend   | 70%             |
| Frontend  | 60%             |
| CLI       | 65%             |

---

## CI Test Matrix

Tests are automatically run in CI on:
- Every push to `main`
- Every pull request
- Nightly schedule (full integration suite)

See `.github/workflows/ci.yml` for the full pipeline configuration.

---

## Troubleshooting

| Issue                          | Solution                                         |
|--------------------------------|--------------------------------------------------|
| Tests fail with DB errors      | Ensure PostgreSQL is running: `docker compose up -d postgres` |
| Frontend tests timeout         | Increase Jest timeout or check async test logic  |
| Race condition detected        | Fix the flagged goroutine access pattern         |
| Coverage below threshold       | Add tests for uncovered paths before merging     |
