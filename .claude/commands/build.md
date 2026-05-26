# Build Commands — Capsule

## Overview

This document describes how to build each component of the Capsule project.

---

## Prerequisites

| Tool       | Minimum Version | Purpose              |
|------------|-----------------|----------------------|
| Go         | 1.22+           | Backend & CLI        |
| Node.js    | 20+             | Frontend (Next.js)   |
| pnpm       | 9+              | Frontend pkg manager |
| Docker     | 24+             | Container builds     |
| Make       | 3.81+           | Build orchestration  |

---

## Build All Components

```bash
make build
```

This runs the backend, frontend, and CLI builds sequentially.

---

## Backend (Go API Server)

```bash
# From project root
cd backend
go build -o ../bin/capsule-server ./cmd/server

# With version info embedded
go build -ldflags "-X main.version=$(git describe --tags --always) -X main.commit=$(git rev-parse --short HEAD) -X main.buildDate=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o ../bin/capsule-server ./cmd/server
```

### Build flags

| Flag              | Description                         |
|-------------------|-------------------------------------|
| `-race`           | Enable race detector (dev only)     |
| `-trimpath`       | Remove file system paths from binary|
| `-ldflags "-s -w"`| Strip debug info for smaller binary |

---

## Frontend (Next.js Dashboard)

```bash
# From project root
cd frontend

# Install dependencies
pnpm install

# Development build
pnpm dev

# Production build
pnpm build

# Export static assets (if applicable)
pnpm export
```

### Environment Variables

Create `frontend/.env.local` for local development:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080
```

---

## CLI (capsule-cli)

```bash
# From project root
cd cli
go build -o ../bin/capsule ./cmd/capsule

# Cross-compile for Linux
GOOS=linux GOARCH=amd64 go build -o ../bin/capsule-linux-amd64 ./cmd/capsule

# Cross-compile for macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o ../bin/capsule-darwin-arm64 ./cmd/capsule

# Cross-compile for Windows
GOOS=windows GOARCH=amd64 go build -o ../bin/capsule-windows-amd64.exe ./cmd/capsule
```

---

## Docker Builds

```bash
# Build all images
make docker-build

# Build individual images
docker build -t capsule-server:latest -f backend/Dockerfile .
docker build -t capsule-frontend:latest -f frontend/Dockerfile .
```

---

## Verify Builds

```bash
# Backend
./bin/capsule-server --version

# CLI
./bin/capsule version

# Frontend (check build output)
ls -la frontend/.next/
```

---

## Troubleshooting

| Issue                        | Solution                                      |
|------------------------------|-----------------------------------------------|
| `go: module not found`       | Run `go mod tidy` in the component directory  |
| `pnpm: command not found`    | Install via `npm install -g pnpm`             |
| Binary too large             | Add `-ldflags "-s -w"` to strip debug symbols |
| CGO errors on cross-compile  | Set `CGO_ENABLED=0`                           |
