# Capsule Testing Strategy

This document details the testing strategy for the **Capsule** platform across all three core modules: the Go Backend, the Next.js Dashboard, and the Go CLI.

---

## 1. The Testing Pyramid

Capsule follows a strict Testing Pyramid distribution to ensure speed, safety, and correctness:

```
      /\
     /  \     E2E (Playwright & CLI Integration) - 10%
    /----\
   /      \   Integration (REST API Endpoints & DB) - 30%
  /--------\
 /          \ Unit Tests (Business logic, parsing, utility functions) - 60%
/____________\
```

---

## 2. Test Coverage & Quality Gates

- **Minimum Code Coverage**: **80%** across all packages.
- **Critical Path Coverage**: **95%** (Auth, Billing, Backups, Deploy pipelines).
- **Quality Gates**:
  - Pull Requests must not lower existing code coverage.
  - Tests must execute in under **3 minutes** in CI.
  - E2E tests run sequentially on Staging environment deployments.

---

## 3. Go Testing Standards (Backend & CLI)

Go tests use standard library `testing` package combined with `stretchr/testify` for rich assertions.

### 3.1 Unit Testing Conventions
- Use table-driven tests for utility methods, parsing logic, and math.
- Mock all third-party services and databases (e.g., AWS SDK, Redis) using interface generation.
- Keep tests package-internal (e.g., `package api`) unless testing public interface APIs.

**Example Table-Driven Test in Go:**
```go
func TestDomainValidation(t *testing.T) {
	tests := []struct {
		name    string
		domain  string
		wantErr bool
	}{
		{"Valid domain", "capsule.live", false},
		{"Valid subdomain", "api.capsule.live", false},
		{"Invalid top-level domain", "localhost", true},
		{"Missing TLD", "capsule.", true},
		{"Invalid character", "api$.capsule.live", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateDomain(tt.domain)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateDomain() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
```

### 3.2 Integration Testing
- Integration tests must run against a **live containerized database** (PostgreSQL/Redis) launched via `docker-compose.test.yml`.
- Re-migrate the schema from scratch for each test run.
- Use transactional rollbacks inside DB test hooks to isolate tests.

---

## 4. Frontend Testing Standards (Dashboard)

- **Unit/Component Testing**: Vitest + React Testing Library.
- **End-to-End Testing**: Playwright.

### 4.1 Component Testing Rules
- Mock all external context providers (Router, Session, QueryClient).
- Test component interactions (clicks, input changes) and state updates, not implementation details.
- Avoid snapshot tests unless for purely static components.

### 4.2 Playwright E2E Flow
- E2E tests reside under `apps/dashboard/e2e/`.
- Tests run against standard mock servers or staging servers.
- Playwright tests cover core user flows:
  - User signup and organization onboarding.
  - Creating a Project and environment variables.
  - Deploying a project and seeing real-time logs.
  - Creating and deleting a database.

---

## 5. CLI End-to-End Testing

CLI commands are tested end-to-end using a mock Capsule API Server.

- Execute binary calls directly using a dedicated Go test package.
- Capture `stdout` and `stderr` and check against **golden output files**.
- Assert exit codes.
- Inject a mock environment config pointing to local server mock endpoints.

---

## 6. Security & Performance Testing

### 6.1 Performance Testing (k6)
- Run monthly load testing on API endpoints using `k6`.
- Base requirements: Gateway proxy must handle 10,000 req/sec at <15ms latency (excluding Bedrock latency).

### 6.2 Security Scans (Static & Dynamic)
- Core dependencies scanned daily using `govulncheck` and `npm audit`.
- Use `gosec` for static security scans on the Go codebase.
