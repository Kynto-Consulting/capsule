# Backend Prompt — Go API Development

You are working on the **Capsule backend**, a Go REST/WebSocket API server using clean architecture.

---

## Stack

- **Go 1.22+** with standard library `net/http`
- **Chi** for routing and middleware
- **pgx** for PostgreSQL access (connection pooling with pgxpool)
- **Redis** for caching and pub/sub
- **slog** for structured logging
- **JWT** for authentication (access + refresh tokens)

---

## Architecture Layers

```
cmd/server/main.go          → App entry point, wire dependencies
internal/config/             → Load env vars, validate config
internal/domain/             → Models, interfaces, errors (NO external deps)
internal/server/             → Handlers, middleware, router
internal/server/middleware/  → Auth, logging, rate limiting, CORS
internal/service/            → Business logic
internal/repository/         → PostgreSQL queries (pgx)
internal/repository/migrations/ → SQL migration files
pkg/                         → Shared packages (pagination, validation, etc.)
```

---

## Go Patterns

### Handler Pattern

```go
type EnvironmentHandler struct {
    service domain.EnvironmentService
    logger  *slog.Logger
}

func (h *EnvironmentHandler) Create(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    var req CreateEnvironmentRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
        return
    }

    if err := req.Validate(); err != nil {
        respondError(w, http.StatusUnprocessableEntity, "VALIDATION_ERROR", err.Error())
        return
    }

    env, err := h.service.Create(ctx, req.ToDomain())
    if err != nil {
        h.handleServiceError(w, err)
        return
    }

    respondJSON(w, http.StatusCreated, env)
}
```

### Service Pattern

```go
type EnvironmentService struct {
    repo   domain.EnvironmentRepository
    cache  domain.CacheStore
    events domain.EventPublisher
    logger *slog.Logger
}

func (s *EnvironmentService) Create(ctx context.Context, env *domain.Environment) (*domain.Environment, error) {
    // Business validation
    if err := s.validateUniqueName(ctx, env.Name); err != nil {
        return nil, fmt.Errorf("validating environment: %w", err)
    }

    // Persist
    created, err := s.repo.Create(ctx, env)
    if err != nil {
        return nil, fmt.Errorf("creating environment: %w", err)
    }

    // Side effects
    s.events.Publish(ctx, domain.EnvironmentCreated{ID: created.ID})
    s.cache.Invalidate(ctx, "environments:list")

    return created, nil
}
```

### Repository Pattern

```go
func (r *environmentRepo) Create(ctx context.Context, env *domain.Environment) (*domain.Environment, error) {
    query := `
        INSERT INTO environments (name, description, owner_id, config, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id, name, description, owner_id, config, status, created_at, updated_at`

    var created domain.Environment
    err := r.pool.QueryRow(ctx, query,
        env.Name, env.Description, env.OwnerID, env.Config,
    ).Scan(
        &created.ID, &created.Name, &created.Description,
        &created.OwnerID, &created.Config, &created.Status,
        &created.CreatedAt, &created.UpdatedAt,
    )
    if err != nil {
        return nil, fmt.Errorf("inserting environment: %w", err)
    }

    return &created, nil
}
```

---

## API Design Rules

1. **RESTful endpoints:** `GET /api/v1/environments`, `POST /api/v1/environments`, `GET /api/v1/environments/{id}`
2. **Versioned API:** All routes prefixed with `/api/v1/`
3. **Pagination:** Use `?page=1&per_page=20` query params; return `meta` object in response
4. **Filtering:** Use query params: `?status=active&owner=user123`
5. **Sorting:** Use `?sort=created_at&order=desc`
6. **Consistent error format:**
   ```json
   {"error": {"code": "RESOURCE_NOT_FOUND", "message": "human-readable message"}}
   ```
7. **HTTP status codes:**
   - `200` success, `201` created, `204` no content
   - `400` bad request, `401` unauthorized, `403` forbidden, `404` not found, `422` validation error
   - `500` internal error
8. **Idempotency:** PUT and DELETE are idempotent; POST uses `Idempotency-Key` header for critical operations

---

## Database Interaction Patterns

1. **Use parameterized queries** — never string-concatenate SQL
2. **Connection pooling** via `pgxpool.Pool` — shared across the app
3. **Transactions** via `pool.BeginTx()` for multi-step operations:
   ```go
   tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
   if err != nil { return err }
   defer tx.Rollback(ctx) // no-op if committed
   // ... queries using tx ...
   return tx.Commit(ctx)
   ```
4. **Migrations** use numbered SQL files: `001_create_users.up.sql`, `001_create_users.down.sql`
5. **Soft deletes** for auditable entities: `deleted_at TIMESTAMPTZ NULL`
6. **JSONB** for flexible config fields: `config JSONB NOT NULL DEFAULT '{}'`
7. **UUID primary keys:** Generated by PostgreSQL with `gen_random_uuid()`

---

## Middleware Stack

Applied in order (outer → inner):

1. `RequestID` — attach unique ID to each request
2. `RealIP` — extract client IP from proxy headers
3. `Logger` — structured request/response logging
4. `Recoverer` — panic recovery → 500 response
5. `Timeout` — 30s request timeout
6. `RateLimiter` — per-IP rate limiting
7. `CORS` — cross-origin configuration
8. `Auth` — JWT validation (applied to protected routes)

---

## Testing Checklist

- [ ] Table-driven tests for all handler/service methods
- [ ] Mock repository interface for service tests
- [ ] Mock service interface for handler tests
- [ ] Integration tests for repository layer (with test database)
- [ ] Test error paths, not just happy paths
- [ ] Test middleware behavior (auth, rate limiting)
- [ ] Benchmark critical hot paths
