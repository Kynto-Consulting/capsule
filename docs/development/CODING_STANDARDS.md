# Coding Standards

> **Project:** Capsule — Cloud Infrastructure Management Platform
> **Applies to:** Backend (Go), CLI (Go), Frontend (TypeScript/React)
> **Last Updated:** 2026-05-26

---

## Table of Contents

- [General Standards](#general-standards)
- [Go Standards (Backend + CLI)](#go-standards-backend--cli)
- [TypeScript / React Standards (Frontend)](#typescript--react-standards-frontend)
- [Enforcement](#enforcement)

---

## General Standards

### File Size & Complexity

| Rule | Limit | Rationale |
|------|-------|-----------|
| File length | **< 300 lines** preferred, 500 max | Smaller files are easier to review and test |
| Function length | **< 50 lines** preferred | Long functions indicate missing abstractions |
| Cyclomatic complexity | **≤ 10** per function | Reduces cognitive load and test cases |
| Function parameters | **≤ 5** | Use option structs for more |
| Nesting depth | **≤ 3 levels** | Extract helper functions for deeper nesting |

### Comment Conventions

```
// Package-level documentation for every exported package.
// Explains the purpose, not the implementation.

// FunctionDoc describes what the function does, not how.
// Include parameter semantics for non-obvious inputs.
// Document error conditions.
```

**When to comment:**
- **Why**, not **what** — the code shows what; comments explain why
- Non-obvious business rules or edge cases
- Workarounds with references to issues or upstream bugs
- Public API contracts (all exported symbols in Go, all public types in TS)

**Marker comment format:**

```
// TODO(username): Description of what needs to be done [CAP-XXX]
// FIXME(username): Description of the bug or incorrect behavior [CAP-XXX]
// HACK(username): Description of why this is a hack and when to fix it [CAP-XXX]
// NOTE: Important context that future readers need
// DEPRECATED: Use [alternative] instead. Will be removed in v[X.Y].
```

> All `TODO`, `FIXME`, and `HACK` markers **must** include an issue tracker ID. Orphaned markers are flagged in code review.

### Import Ordering

All files must organize imports in the following order, separated by blank lines:

**Go:**
```go
import (
    // 1. Standard library
    "context"
    "fmt"
    "net/http"

    // 2. Third-party packages
    "github.com/go-chi/chi/v5"
    "github.com/jackc/pgx/v5"

    // 3. Internal packages
    "github.com/kynto/capsule/internal/domain"
    "github.com/kynto/capsule/internal/service"
)
```

**TypeScript:**
```typescript
// 1. React / Next.js
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// 2. Third-party libraries
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

// 3. Internal absolute imports (@/)
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";

// 4. Relative imports
import { EnvironmentCard } from "./environment-card";
import type { Environment } from "./types";
```

### Commit Messages

Follow **Conventional Commits** strictly:

```
<type>(<scope>): <subject>

[body]

[footer]
```

| Type | Usage |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting (no logic change) |
| `refactor` | Code change (no feature/fix) |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Build, CI, tooling changes |
| `revert` | Reverting a previous commit |

**Scope values:** `backend`, `frontend`, `cli`, `infra`, `docs`, `deps`

**Example:**
```
feat(backend): add environment provisioning endpoint

Implements POST /api/v1/environments with async provisioning
via AWS CloudFormation. Returns 202 Accepted with a task ID
for polling status.

Closes CAP-142
```

### Branch Naming

```
feat/<short-description>     # Feature branches
fix/<short-description>      # Bug fix branches
docs/<short-description>     # Documentation branches
refactor/<short-description> # Refactoring branches
chore/<short-description>    # Tooling / CI branches
release/v<semver>            # Release branches
hotfix/v<semver>             # Hotfix branches
```

---

## Go Standards (Backend + CLI)

### Package Naming

```go
// ✅ Good: short, lowercase, no underscores, singular
package environment
package auth
package middleware

// ❌ Bad
package environmentService   // No camelCase
package env_handler          // No underscores
package environments         // No plural
package utils                // Too generic — name by purpose
package common               // Too generic — split into focused packages
```

**Package organization principles:**
- **One responsibility per package** — a package should do one thing well
- **Name by purpose, not by layer** — prefer `environment` over `handlers`
- **Avoid circular imports** — dependency flow: `handler → service → repository → domain`
- **`internal/`** for non-importable packages, **`pkg/`** for importable ones

### Error Handling

```go
// ✅ Always wrap errors with context
func (s *EnvironmentService) Create(ctx context.Context, req CreateEnvRequest) (*Environment, error) {
    env, err := s.repo.Create(ctx, req.toModel())
    if err != nil {
        return nil, fmt.Errorf("create environment %q: %w", req.Name, err)
    }
    return env, nil
}

// ✅ Define domain-specific sentinel errors
var (
    ErrEnvironmentNotFound = errors.New("environment not found")
    ErrEnvironmentExists   = errors.New("environment already exists")
    ErrQuotaExceeded       = errors.New("environment quota exceeded")
)

// ✅ Use errors.Is and errors.As for checking
if errors.Is(err, ErrEnvironmentNotFound) {
    return nil, NewNotFoundError("environment", id)
}

// ❌ Never ignore errors
result, _ := doSomething()  // NEVER do this

// ❌ Don't use panic for recoverable errors
panic("database connection failed")  // Only for programmer errors
```

**Error handling rules:**
1. **Wrap every error** with operation context using `fmt.Errorf("operation: %w", err)`
2. **Don't log AND return** — pick one. Usually return; let the caller decide
3. **Sentinel errors** for domain concepts, error types for extra context
4. **HTTP errors** map in the handler layer, never in service or repository

### Interface Design

```go
// ✅ Define interfaces at the CONSUMER side (dependency inversion)
// File: internal/service/environment.go
type EnvironmentRepository interface {
    Create(ctx context.Context, env *domain.Environment) error
    GetByID(ctx context.Context, id string) (*domain.Environment, error)
    List(ctx context.Context, filter domain.EnvironmentFilter) ([]domain.Environment, error)
    Delete(ctx context.Context, id string) error
}

type EnvironmentService struct {
    repo   EnvironmentRepository  // Accept interface
    logger *slog.Logger
}

// ✅ Return concrete structs
func NewEnvironmentService(repo EnvironmentRepository, logger *slog.Logger) *EnvironmentService {
    return &EnvironmentService{repo: repo, logger: logger}
}

// ❌ Don't define interfaces at the producer side
// ❌ Don't create interfaces with too many methods (> 5 is a smell)
// ❌ Don't create single-implementation interfaces preemptively
```

**Interface rules:**
- **Accept interfaces, return structs**
- **Keep interfaces small** — 1-5 methods (Interface Segregation Principle)
- **Name by behavior** — `Reader`, `Closer`, `EnvironmentRepository`
- **Place at the consumer** — the package that uses it, not the one that implements it

### Testing Patterns

```go
// ✅ Table-driven tests
func TestEnvironmentService_Create(t *testing.T) {
    tests := []struct {
        name    string
        req     CreateEnvRequest
        setup   func(repo *MockEnvironmentRepository)
        want    *Environment
        wantErr error
    }{
        {
            name: "creates environment successfully",
            req:  CreateEnvRequest{Name: "production", Provider: "aws"},
            setup: func(repo *MockEnvironmentRepository) {
                repo.EXPECT().Create(gomock.Any(), gomock.Any()).Return(nil)
            },
            want: &Environment{Name: "production", Provider: "aws", Status: "pending"},
        },
        {
            name: "returns error when name already exists",
            req:  CreateEnvRequest{Name: "existing"},
            setup: func(repo *MockEnvironmentRepository) {
                repo.EXPECT().Create(gomock.Any(), gomock.Any()).
                    Return(ErrEnvironmentExists)
            },
            wantErr: ErrEnvironmentExists,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            ctrl := gomock.NewController(t)
            repo := NewMockEnvironmentRepository(ctrl)
            tt.setup(repo)

            svc := NewEnvironmentService(repo, slog.Default())
            got, err := svc.Create(context.Background(), tt.req)

            if tt.wantErr != nil {
                require.ErrorIs(t, err, tt.wantErr)
                return
            }
            require.NoError(t, err)
            assert.Equal(t, tt.want.Name, got.Name)
        })
    }
}
```

**Testing rules:**
- **Table-driven tests** for all functions with multiple cases
- **Use `testify`** — `require` for fatal checks, `assert` for non-fatal
- **Test file naming:** `foo_test.go` next to `foo.go`
- **TestMain** for shared setup (database, fixtures)
- **`t.Parallel()`** for independent tests
- **`t.Helper()`** for test utility functions
- **Mock interfaces** with `gomock` or `testify/mock`

### Logging Standards

```go
// ✅ Structured logging with slog
func (s *EnvironmentService) Create(ctx context.Context, req CreateEnvRequest) (*Environment, error) {
    s.logger.InfoContext(ctx, "creating environment",
        slog.String("name", req.Name),
        slog.String("provider", req.Provider),
        slog.String("region", req.Region),
    )

    env, err := s.repo.Create(ctx, req.toModel())
    if err != nil {
        s.logger.ErrorContext(ctx, "failed to create environment",
            slog.String("name", req.Name),
            slog.String("error", err.Error()),
        )
        return nil, fmt.Errorf("create environment %q: %w", req.Name, err)
    }

    s.logger.InfoContext(ctx, "environment created",
        slog.String("id", env.ID),
        slog.String("name", env.Name),
    )
    return env, nil
}
```

**Logging rules:**
- **Use `slog`** — Go's standard structured logging (Go 1.21+)
- **Include context** — pass `ctx` for request-scoped fields (request ID, user ID)
- **Log levels:** `Debug` for development, `Info` for operations, `Warn` for recoverable issues, `Error` for failures
- **Never log sensitive data** — passwords, tokens, PII, secret keys
- **Log at boundaries** — service entry/exit, external API calls, state changes

### Configuration Management

```go
// ✅ Config struct loaded from environment variables
type Config struct {
    Env       string `env:"CAPSULE_ENV" envDefault:"development"`
    Port      int    `env:"CAPSULE_PORT" envDefault:"8080"`
    
    Database  DatabaseConfig
    Redis     RedisConfig
    Auth      AuthConfig
    AWS       AWSConfig
}

type DatabaseConfig struct {
    URL             string        `env:"DATABASE_URL,required"`
    MaxOpenConns    int           `env:"DB_MAX_OPEN_CONNS" envDefault:"25"`
    MaxIdleConns    int           `env:"DB_MAX_IDLE_CONNS" envDefault:"5"`
    ConnMaxLifetime time.Duration `env:"DB_CONN_MAX_LIFETIME" envDefault:"5m"`
}

// ✅ Load and validate at startup
func LoadConfig() (*Config, error) {
    cfg := &Config{}
    if err := env.Parse(cfg); err != nil {
        return nil, fmt.Errorf("parse config: %w", err)
    }
    if err := cfg.Validate(); err != nil {
        return nil, fmt.Errorf("validate config: %w", err)
    }
    return cfg, nil
}
```

**Configuration rules:**
- **Environment variables → config struct** (single source of truth)
- **Validate at startup** — fail fast, not at runtime
- **Use defaults** for development, require for production
- **Never hardcode** connection strings, secrets, or environment-specific values
- **Document all variables** in the project README and `.env.example`

### API Handler Patterns

```go
// ✅ Handler struct with dependencies
type EnvironmentHandler struct {
    service EnvironmentService
    logger  *slog.Logger
}

func NewEnvironmentHandler(svc EnvironmentService, logger *slog.Logger) *EnvironmentHandler {
    return &EnvironmentHandler{service: svc, logger: logger}
}

// ✅ Consistent response format
func (h *EnvironmentHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateEnvironmentRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        respondError(w, http.StatusBadRequest, "invalid request body", err)
        return
    }

    if err := req.Validate(); err != nil {
        respondError(w, http.StatusUnprocessableEntity, "validation failed", err)
        return
    }

    env, err := h.service.Create(r.Context(), req)
    if err != nil {
        switch {
        case errors.Is(err, ErrEnvironmentExists):
            respondError(w, http.StatusConflict, "environment already exists", err)
        case errors.Is(err, ErrQuotaExceeded):
            respondError(w, http.StatusForbidden, "environment quota exceeded", err)
        default:
            respondError(w, http.StatusInternalServerError, "failed to create environment", err)
        }
        return
    }

    respondJSON(w, http.StatusCreated, env)
}

// ✅ Standard response helpers
func respondJSON(w http.ResponseWriter, status int, data any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, status int, message string, err error) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(map[string]string{
        "error":   message,
        "details": err.Error(),
    })
}
```

### Database Query Patterns

```go
// ✅ Repository implementation with pgx
type PostgresEnvironmentRepository struct {
    pool *pgxpool.Pool
}

func (r *PostgresEnvironmentRepository) GetByID(ctx context.Context, id string) (*domain.Environment, error) {
    var env domain.Environment
    err := r.pool.QueryRow(ctx, `
        SELECT id, name, provider, region, status, created_at, updated_at
        FROM environments
        WHERE id = $1 AND deleted_at IS NULL
    `, id).Scan(
        &env.ID, &env.Name, &env.Provider, &env.Region,
        &env.Status, &env.CreatedAt, &env.UpdatedAt,
    )
    if err != nil {
        if errors.Is(err, pgx.ErrNoRows) {
            return nil, ErrEnvironmentNotFound
        }
        return nil, fmt.Errorf("query environment by id %q: %w", id, err)
    }
    return &env, nil
}

// ✅ Use transactions for multi-step operations
func (r *PostgresEnvironmentRepository) CreateWithResources(
    ctx context.Context,
    env *domain.Environment,
    resources []domain.Resource,
) error {
    tx, err := r.pool.Begin(ctx)
    if err != nil {
        return fmt.Errorf("begin transaction: %w", err)
    }
    defer tx.Rollback(ctx) // No-op if committed

    // Insert environment
    _, err = tx.Exec(ctx, `INSERT INTO environments (...) VALUES (...)`, ...)
    if err != nil {
        return fmt.Errorf("insert environment: %w", err)
    }

    // Insert resources
    for _, res := range resources {
        _, err = tx.Exec(ctx, `INSERT INTO resources (...) VALUES (...)`, ...)
        if err != nil {
            return fmt.Errorf("insert resource %q: %w", res.Name, err)
        }
    }

    if err := tx.Commit(ctx); err != nil {
        return fmt.Errorf("commit transaction: %w", err)
    }
    return nil
}
```

**Database rules:**
- **Use parameterized queries** — never concatenate user input into SQL
- **Wrap `pgx.ErrNoRows`** into domain-specific errors
- **Use transactions** for multi-step mutations
- **Context-aware** — pass `ctx` to all database operations
- **Connection pooling** via `pgxpool` with configured limits
- **Migrations** managed by `golang-migrate` or `goose`

### Middleware Patterns

```go
// ✅ Chi middleware with consistent patterns
func RequestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        requestID := r.Header.Get("X-Request-ID")
        if requestID == "" {
            requestID = uuid.New().String()
        }
        ctx := context.WithValue(r.Context(), requestIDKey, requestID)
        w.Header().Set("X-Request-ID", requestID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// ✅ Auth middleware
func (m *AuthMiddleware) Authenticate(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := extractBearerToken(r)
        if token == "" {
            respondError(w, http.StatusUnauthorized, "missing auth token", nil)
            return
        }

        claims, err := m.tokenService.Validate(token)
        if err != nil {
            respondError(w, http.StatusUnauthorized, "invalid auth token", err)
            return
        }

        ctx := context.WithValue(r.Context(), userClaimsKey, claims)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}

// ✅ Middleware registration order matters
r := chi.NewRouter()
r.Use(RequestIDMiddleware)       // 1. Request ID (first, for tracing)
r.Use(middleware.RealIP)         // 2. Real IP
r.Use(LoggingMiddleware(logger)) // 3. Logging
r.Use(middleware.Recoverer)      // 4. Panic recovery
r.Use(CORSMiddleware)           // 5. CORS
r.Use(RateLimitMiddleware)      // 6. Rate limiting

r.Route("/api/v1", func(r chi.Router) {
    r.Use(authMiddleware.Authenticate)  // 7. Auth (only on API routes)
    // ... routes
})
```

---

## TypeScript / React Standards (Frontend)

### Component Structure

```
frontend/
├── app/                          # Next.js App Router pages
│   ├── (auth)/                   # Auth group layout
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/              # Dashboard group layout
│   │   ├── environments/
│   │   │   ├── page.tsx          # List page
│   │   │   ├── [id]/page.tsx     # Detail page
│   │   │   └── new/page.tsx      # Create page
│   │   ├── deployments/
│   │   └── settings/
│   ├── layout.tsx                # Root layout
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn/ui primitives (auto-generated)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── dialog.tsx
│   ├── environments/             # Feature-specific components
│   │   ├── environment-card.tsx
│   │   ├── environment-card.test.tsx
│   │   ├── environment-list.tsx
│   │   ├── environment-form.tsx
│   │   └── types.ts
│   ├── deployments/
│   └── shared/                   # Cross-feature components
│       ├── page-header.tsx
│       ├── data-table.tsx
│       └── status-badge.tsx
├── lib/
│   ├── api/                      # API client layer
│   │   ├── client.ts             # Base fetch wrapper
│   │   ├── environments.ts       # Environment API functions
│   │   └── types.ts              # API response types
│   ├── hooks/                    # Custom hooks
│   │   ├── use-environments.ts
│   │   └── use-debounce.ts
│   └── utils/                    # Pure utility functions
│       ├── cn.ts
│       └── format.ts
└── stores/                       # Zustand state stores
    ├── auth.ts
    └── ui.ts
```

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `EnvironmentCard.tsx` |
| Component files | kebab-case | `environment-card.tsx` |
| Hooks | camelCase with `use` prefix | `useEnvironments` |
| Utilities | camelCase | `formatDate`, `cn` |
| Types/Interfaces | PascalCase | `Environment`, `CreateEnvRequest` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_RETRY_COUNT` |
| Zustand stores | camelCase with `use` prefix + `Store` suffix | `useAuthStore` |
| API functions | camelCase verb-noun | `getEnvironments`, `createDeployment` |
| Test files | mirror source with `.test` | `environment-card.test.tsx` |
| CSS classes | Tailwind utilities | `className="flex items-center gap-2"` |

### State Management

```typescript
// ✅ Server state: React Query
// File: lib/hooks/use-environments.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getEnvironments, createEnvironment } from "@/lib/api/environments";

export const environmentKeys = {
  all: ["environments"] as const,
  lists: () => [...environmentKeys.all, "list"] as const,
  list: (filters: EnvFilters) => [...environmentKeys.all, "list", filters] as const,
  details: () => [...environmentKeys.all, "detail"] as const,
  detail: (id: string) => [...environmentKeys.all, "detail", id] as const,
};

export function useEnvironments(filters: EnvFilters) {
  return useQuery({
    queryKey: environmentKeys.list(filters),
    queryFn: () => getEnvironments(filters),
  });
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createEnvironment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: environmentKeys.lists() });
    },
  });
}
```

```typescript
// ✅ Client state: Zustand
// File: stores/ui.ts
import { create } from "zustand";

interface UIState {
  sidebarOpen: boolean;
  theme: "light" | "dark" | "system";
  toggleSidebar: () => void;
  setTheme: (theme: UIState["theme"]) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: "system",
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
}));
```

**State rules:**
- **React Query** for all server/API state (caching, refetching, optimistic updates)
- **Zustand** for client-only UI state (sidebar, modals, preferences)
- **No prop drilling** beyond 2 levels — use composition or state management
- **Derive state** when possible — don't duplicate server state in client stores

### API Client Patterns

```typescript
// ✅ Typed fetch wrapper
// File: lib/api/client.ts

class APIError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data: unknown,
  ) {
    super(`API Error: ${status} ${statusText}`);
    this.name = "APIError";
  }
}

async function apiClient<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${process.env.NEXT_PUBLIC_API_URL}${endpoint}`;
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options?.headers,
  };

  // Attach auth token if available
  const token = getAuthToken();
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new APIError(response.status, response.statusText, data);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ✅ Typed API functions
// File: lib/api/environments.ts
export async function getEnvironments(
  filters?: EnvFilters,
): Promise<PaginatedResponse<Environment>> {
  const params = new URLSearchParams(filters as Record<string, string>);
  return apiClient<PaginatedResponse<Environment>>(
    `/api/v1/environments?${params}`,
  );
}

export async function createEnvironment(
  data: CreateEnvironmentRequest,
): Promise<Environment> {
  return apiClient<Environment>("/api/v1/environments", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
```

### Error Boundary Patterns

```typescript
// ✅ Feature-level error boundaries
// File: components/shared/error-boundary.tsx
"use client";

import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info);
    // Report to error tracking service (e.g., Sentry)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center gap-4 p-8">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground">{this.state.error?.message}</p>
          <Button onClick={this.handleReset}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

**Error boundary rules:**
- Wrap **feature sections**, not the entire app
- Always provide a **recovery action** (retry button)
- **Log errors** to an external service
- Use Next.js `error.tsx` for route-level error handling

### Form Handling

```typescript
// ✅ React Hook Form + Zod validation
// File: components/environments/environment-form.tsx
"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateEnvironment } from "@/lib/hooks/use-environments";

const createEnvironmentSchema = z.object({
  name: z
    .string()
    .min(3, "Name must be at least 3 characters")
    .max(63, "Name must be at most 63 characters")
    .regex(/^[a-z][a-z0-9-]*$/, "Must start with a letter, lowercase alphanumeric and hyphens only"),
  provider: z.enum(["aws", "gcp", "azure"], {
    required_error: "Please select a cloud provider",
  }),
  region: z.string().min(1, "Region is required"),
  description: z.string().max(500).optional(),
});

type CreateEnvironmentForm = z.infer<typeof createEnvironmentSchema>;

export function EnvironmentForm() {
  const createMutation = useCreateEnvironment();

  const form = useForm<CreateEnvironmentForm>({
    resolver: zodResolver(createEnvironmentSchema),
    defaultValues: {
      name: "",
      provider: "aws",
      region: "",
      description: "",
    },
  });

  const onSubmit = (data: CreateEnvironmentForm) => {
    createMutation.mutate(data, {
      onSuccess: () => {
        form.reset();
        // Navigate or show toast
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {/* Form fields using shadcn Form components */}
    </form>
  );
}
```

**Form rules:**
- **Zod** for schema validation — single source of truth for types and rules
- **React Hook Form** for form state management
- **Validate on blur**, submit only shows final errors
- **Disable submit** while mutation is pending
- **Optimistic UI** for quick updates when appropriate

### Styling Conventions

```typescript
// ✅ Tailwind utility classes via cn() helper
import { cn } from "@/lib/utils/cn";

interface StatusBadgeProps {
  status: "running" | "stopped" | "error" | "pending";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        {
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200":
            status === "running",
          "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200":
            status === "stopped",
          "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200":
            status === "error",
          "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200":
            status === "pending",
        },
        className,
      )}
    >
      {status}
    </span>
  );
}
```

**Styling rules:**
- **Tailwind CSS** for all styling — no CSS modules, no styled-components
- **shadcn/ui** as the component library — customize via CSS variables
- **`cn()` utility** (clsx + tailwind-merge) for conditional classes
- **Accept `className` prop** on all reusable components
- **Dark mode** via `dark:` variant — test both themes
- **No inline `style` attributes** except for dynamic values (e.g., grid column count)

### Frontend Testing Patterns

```typescript
// ✅ Vitest + Testing Library
// File: components/environments/environment-card.test.tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { EnvironmentCard } from "./environment-card";

const mockEnvironment = {
  id: "env-123",
  name: "production",
  provider: "aws",
  region: "us-east-1",
  status: "running" as const,
};

describe("EnvironmentCard", () => {
  it("renders environment details", () => {
    render(<EnvironmentCard environment={mockEnvironment} />);

    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("aws")).toBeInTheDocument();
    expect(screen.getByText("us-east-1")).toBeInTheDocument();
  });

  it("shows running status badge", () => {
    render(<EnvironmentCard environment={mockEnvironment} />);

    const badge = screen.getByText("running");
    expect(badge).toHaveClass("bg-green-100");
  });

  it("calls onDelete when delete button is clicked", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <EnvironmentCard environment={mockEnvironment} onDelete={onDelete} />,
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith("env-123");
  });
});
```

**Frontend testing rules:**
- **Vitest** as the test runner — fast, ESM-native
- **Testing Library** — test behavior, not implementation
- **Query by role, text, or label** — avoid `data-testid` unless necessary
- **`userEvent`** over `fireEvent` for user interactions
- **Mock API calls** at the fetch level using `msw` (Mock Service Worker)
- **Co-locate tests** with components: `component-name.test.tsx`

---

## Enforcement

### Automated Checks

| Check | Tool | Stage |
|-------|------|-------|
| Go linting | `golangci-lint` | Pre-commit + CI |
| Go formatting | `gofmt` / `goimports` | Pre-commit |
| TS linting | `eslint` | Pre-commit + CI |
| TS formatting | `prettier` | Pre-commit |
| TS type checking | `tsc --noEmit` | CI |
| Commit messages | `commitlint` | Pre-commit hook |
| File size | Custom lint rule | CI |
| Import ordering | `goimports` (Go) / ESLint rule (TS) | Pre-commit |

### Code Review Checklist

Reviewers should verify:

- [ ] Follows naming conventions for the language
- [ ] Error handling is complete (no swallowed errors)
- [ ] Tests cover happy path and error cases
- [ ] No hardcoded secrets or environment-specific values
- [ ] Functions are ≤ 50 lines, files ≤ 300 lines
- [ ] No `TODO` or `FIXME` without issue tracker reference
- [ ] API changes are reflected in OpenAPI spec
- [ ] Logging follows structured format, no sensitive data logged
- [ ] No `any` types in TypeScript
- [ ] Accessibility: interactive elements have labels, semantic HTML used
