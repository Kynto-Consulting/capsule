# ──────────────────────────────────────────────────────────────
# Capsule Makefile
# ──────────────────────────────────────────────────────────────
.PHONY: all build test lint dev clean help \
        build-backend build-frontend build-cli \
        test-backend test-frontend test-cli \
        lint-backend lint-frontend lint-cli \
        docker-build docker-up docker-down \
        migrate-up migrate-down

# ──────────────────────────────────────────────
# Variables
# ──────────────────────────────────────────────
VERSION   ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT    ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE = $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS    = -ldflags "-s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.buildDate=$(BUILD_DATE)"

GO        = go
GOFLAGS   = -trimpath
BIN_DIR   = bin

# ──────────────────────────────────────────────
# Default target
# ──────────────────────────────────────────────
all: lint test build ## Run lint, test, and build

# ══════════════════════════════════════════════
# BUILD
# ══════════════════════════════════════════════

build: build-backend build-cli build-frontend ## Build all components

build-backend: ## Build the Go backend server
	@echo "🔨 Building backend..."
	cd backend && $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$(BIN_DIR)/capsule-server ./cmd/server
	@echo "✅ Backend built → $(BIN_DIR)/capsule-server"

build-cli: ## Build the Go CLI
	@echo "🔨 Building CLI..."
	cd cli && $(GO) build $(GOFLAGS) $(LDFLAGS) -o ../$(BIN_DIR)/capsule ./cmd/capsule
	@echo "✅ CLI built → $(BIN_DIR)/capsule"

build-frontend: ## Build the Next.js frontend
	@echo "🔨 Building frontend..."
	cd frontend && pnpm install --frozen-lockfile && pnpm build
	@echo "✅ Frontend built"

# ══════════════════════════════════════════════
# TEST
# ══════════════════════════════════════════════

test: test-backend test-cli test-frontend ## Run all tests

test-backend: ## Run backend tests
	@echo "🧪 Testing backend..."
	cd backend && $(GO) test -race -coverprofile=coverage.out ./...
	@echo "✅ Backend tests passed"

test-cli: ## Run CLI tests
	@echo "🧪 Testing CLI..."
	cd cli && $(GO) test -race -coverprofile=coverage.out ./...
	@echo "✅ CLI tests passed"

test-frontend: ## Run frontend tests
	@echo "🧪 Testing frontend..."
	cd frontend && pnpm test --ci
	@echo "✅ Frontend tests passed"

test-integration: ## Run integration tests (requires running services)
	@echo "🧪 Running integration tests..."
	cd backend && $(GO) test -tags=integration -race -v ./...
	@echo "✅ Integration tests passed"

# ══════════════════════════════════════════════
# LINT
# ══════════════════════════════════════════════

lint: lint-backend lint-cli lint-frontend ## Run all linters

lint-backend: ## Lint backend Go code
	@echo "🔍 Linting backend..."
	cd backend && golangci-lint run --timeout=5m ./...
	@echo "✅ Backend lint passed"

lint-cli: ## Lint CLI Go code
	@echo "🔍 Linting CLI..."
	cd cli && golangci-lint run --timeout=5m ./...
	@echo "✅ CLI lint passed"

lint-frontend: ## Lint frontend TypeScript code
	@echo "🔍 Linting frontend..."
	cd frontend && pnpm lint
	@echo "✅ Frontend lint passed"

# ══════════════════════════════════════════════
# DEVELOPMENT
# ══════════════════════════════════════════════

dev: ## Start the full development environment
	@echo "🚀 Starting development environment..."
	docker compose up -d postgres redis
	@echo "⏳ Waiting for services..."
	@sleep 3
	@echo ""
	@echo "Services running:"
	@echo "  PostgreSQL: localhost:5432"
	@echo "  Redis:      localhost:6379"
	@echo ""
	@echo "Start the backend:  cd backend && go run ./cmd/server"
	@echo "Start the frontend: cd frontend && pnpm dev"

dev-all: ## Start all services including backend and frontend via Docker
	docker compose up -d
	@echo "✅ All services started"
	@echo "  Backend:  http://localhost:8080"
	@echo "  Frontend: http://localhost:3000"

# ══════════════════════════════════════════════
# DOCKER
# ══════════════════════════════════════════════

docker-build: ## Build all Docker images
	@echo "🐳 Building Docker images..."
	docker build -t capsule-server:$(VERSION) -f backend/Dockerfile .
	docker build -t capsule-frontend:$(VERSION) -f frontend/Dockerfile .
	@echo "✅ Docker images built"

docker-up: ## Start all services with Docker Compose
	docker compose up -d
	@echo "✅ Services started"

docker-down: ## Stop all Docker Compose services
	docker compose down
	@echo "✅ Services stopped"

docker-logs: ## Tail Docker Compose logs
	docker compose logs -f --tail=100

# ══════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════

migrate-up: ## Apply migrations (auto-run on server startup; this starts the server to trigger them)
	@echo "Migrations run automatically on server startup."
	@echo "To apply migrations, start the server: cd backend && go run ./cmd/server"

migrate-down: ## Down migrations not supported (write a new .up.sql to reverse changes)
	@echo "Down migrations are not supported."
	@echo "Create a new migration to reverse schema changes: make migrate-create NAME=revert_foo"

migrate-create: ## Create a new migration (usage: make migrate-create NAME=create_users)
	@if [ -z "$(NAME)" ]; then echo "Usage: make migrate-create NAME=migration_name"; exit 1; fi
	@echo "Creating migration: $(NAME)"
	@mkdir -p backend/internal/repository/migrations
	@touch backend/internal/repository/migrations/$$(date +%Y%m%d%H%M%S)_$(NAME).up.sql
	@touch backend/internal/repository/migrations/$$(date +%Y%m%d%H%M%S)_$(NAME).down.sql
	@echo "✅ Migration files created"

# ══════════════════════════════════════════════
# CLEAN
# ══════════════════════════════════════════════

clean: ## Clean build artifacts
	@echo "🧹 Cleaning..."
	rm -rf $(BIN_DIR)/
	rm -rf backend/coverage.out
	rm -rf cli/coverage.out
	rm -rf frontend/.next/
	rm -rf frontend/node_modules/
	rm -rf dist/
	@echo "✅ Clean complete"

# ══════════════════════════════════════════════
# HELP
# ══════════════════════════════════════════════

help: ## Show this help message
	@echo "Capsule Makefile"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
