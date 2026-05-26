# Capsule — CLI Reference

> **Version:** 1.0.0  
> **Last Updated:** 2026-05-26  
> **Binary:** `capsule`  
> **Language:** Go (statically linked)

---

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start](#2-quick-start)
3. [Configuration](#3-configuration)
4. [Authentication](#4-authentication)
5. [Command Reference](#5-command-reference)
6. [Environment Variables](#6-environment-variables)
7. [Output Formats](#7-output-formats)
8. [Shell Completion](#8-shell-completion)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Installation

### macOS / Linux (curl)

```bash
curl -fsSL https://get.capsule.dev | sh
```

### macOS (Homebrew)

```bash
brew tap kynto/capsule
brew install capsule
```

### Windows (PowerShell)

```powershell
irm https://get.capsule.dev/windows | iex
```

### Windows (Scoop)

```powershell
scoop bucket add kynto https://github.com/kynto/scoop-bucket
scoop install capsule
```

### From Source

```bash
git clone https://github.com/kynto/capsule.git
cd capsule
go build -o capsule ./cmd/cli
sudo mv capsule /usr/local/bin/
```

### Docker

```bash
docker run --rm -it kynto/capsule:latest capsule --help
```

### Verify Installation

```bash
capsule version
# capsule v1.0.0 (build abc1234, 2026-05-26)
```

---

## 2. Quick Start

```bash
# 1. Login to your Capsule instance
capsule login --host https://capsule.example.com

# 2. Initialize a project in your app directory
cd ~/my-app
capsule init --name "my-app"

# 3. Deploy
capsule deploy

# 4. View logs
capsule logs --follow

# 5. Add a database
capsule db create --name main-db --engine postgres --version 15

# 6. Set environment variables
capsule env set DATABASE_URL="postgresql://..." NODE_ENV=production

# 7. Add a custom domain
capsule domains add api.example.com

# 8. Create a backup
capsule backup create --type full --encrypt
```

---

## 3. Configuration

### Project Configuration File

When you run `capsule init`, a `.capsule/config.json` file is created in your project root:

```json
{
  "project_id": "770e8400-e29b-41d4-a716-446655440002",
  "project_name": "my-app",
  "host": "https://capsule.example.com",
  "branch": "main",
  "build_strategy": "auto",
  "runtime": "auto",
  "container_port": 8080,
  "health_check_path": "/health",
  "health_check_timeout": 30,
  "deploy": {
    "drain_timeout": 30,
    "pre_deploy_command": "",
    "post_deploy_command": ""
  },
  "ignore": [
    ".git",
    "node_modules",
    ".env",
    ".capsule"
  ]
}
```

### Global Configuration

Stored at `~/.capsule/config.json`:

```json
{
  "default_host": "https://capsule.example.com",
  "auth": {
    "token": "cap_1a2b3c4d5e6f...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_at": "2027-05-26T08:46:40Z"
  },
  "output_format": "table",
  "color": true,
  "telemetry": false
}
```

### `.capsuleignore` File

Works like `.gitignore`. Controls which files are excluded from deployment bundles:

```
# .capsuleignore
.git
.env
.env.local
node_modules
__pycache__
*.test.go
*.spec.ts
.DS_Store
.capsule
```

---

## 4. Authentication

### Login Flow

```mermaid
sequenceDiagram
    participant User
    participant CLI as capsule CLI
    participant Browser
    participant API as Capsule API

    User->>CLI: capsule login
    CLI->>CLI: Open browser to login page
    CLI->>API: POST /auth/device-code
    API-->>CLI: device_code, user_code, verification_url
    CLI->>Browser: Open verification_url
    User->>Browser: Enter user_code, authenticate
    Browser->>API: POST /auth/device-authorize
    CLI->>API: Poll POST /auth/device-token
    API-->>CLI: access_token, refresh_token
    CLI->>CLI: Store tokens in ~/.capsule/config.json
    CLI-->>User: ✓ Logged in as dev@example.com
```

### Token-Based Auth (Non-Interactive)

For CI/CD or headless environments:

```bash
# Generate token in Dashboard or via API
export CAPSULE_TOKEN="cap_1a2b3c4d5e6f..."
capsule deploy
```

### Auth Commands

```bash
# Interactive login (opens browser)
capsule login --host https://capsule.example.com

# Login with token directly
capsule login --token cap_1a2b3c4d5e6f...

# Check current auth status
capsule auth status

# Logout (clears stored tokens)
capsule logout

# Show current user
capsule auth whoami
```

---

## 5. Command Reference

### Global Flags

These flags are available on every command:

| Flag | Short | Description | Default |
|---|---|---|---|
| `--host` | `-H` | Capsule server URL | `~/.capsule/config.json` value |
| `--token` | `-t` | API token | Stored token |
| `--output` | `-o` | Output format: `table`, `json`, `quiet` | `table` |
| `--no-color` | | Disable colored output | `false` |
| `--verbose` | `-v` | Enable verbose/debug output | `false` |
| `--help` | `-h` | Show help for a command | |
| `--version` | `-V` | Show CLI version | |

---

### `capsule init`

Initialize a project in the current directory.

```
capsule init [flags]
```

| Flag | Short | Description | Default |
|---|---|---|---|
| `--name` | `-n` | Project name | Directory name |
| `--repo` | `-r` | Git repository URL | Auto-detect from `.git` |
| `--branch` | `-b` | Default branch | `main` |
| `--build-strategy` | | `auto`, `dockerfile`, `buildpack`, `static` | `auto` |
| `--serverless` | | Deploy as Lambda function | `false` |
| `--port` | `-p` | Application port | `8080` |

**Examples:**

```bash
# Initialize with defaults (auto-detect everything)
capsule init

# Initialize with a specific name and port
capsule init --name "payment-api" --port 3000

# Initialize for serverless deployment
capsule init --name "webhook-handler" --serverless

# Initialize with explicit build strategy
capsule init --name "static-site" --build-strategy static
```

---

### `capsule deploy`

Deploy the current project.

```
capsule deploy [flags]
```

| Flag | Short | Description | Default |
|---|---|---|---|
| `--branch` | `-b` | Branch to deploy | Config value or `main` |
| `--commit` | `-c` | Specific commit SHA | HEAD |
| `--message` | `-m` | Deploy message/note | |
| `--no-build` | | Skip build, redeploy current image | `false` |
| `--force` | `-f` | Skip confirmation prompts | `false` |
| `--follow` | | Follow build logs in real-time | `true` |
| `--timeout` | | Deploy timeout in seconds | `600` |
| `--serverless` | | Deploy as Lambda (override) | Project config |

**Examples:**

```bash
# Deploy current directory
capsule deploy

# Deploy a specific branch
capsule deploy --branch feature/new-api

# Deploy with a message
capsule deploy --message "Fix payment processing bug"

# Quick redeploy without rebuilding
capsule deploy --no-build

# Deploy without following logs
capsule deploy --no-follow

# Deploy with extended timeout
capsule deploy --timeout 1200
```

---

### `capsule logs`

View application logs.

```
capsule logs [flags]
```

| Flag | Short | Description | Default |
|---|---|---|---|
| `--follow` | `-f` | Stream logs in real-time | `false` |
| `--source` | `-s` | Log source: `app`, `build`, `worker`, `all` | `app` |
| `--level` | `-l` | Min log level: `debug`, `info`, `warn`, `error` | `info` |
| `--since` | | Show logs since (e.g. `5m`, `1h`, `2026-05-26`) | `1h` |
| `--lines` | `-n` | Number of recent lines | `100` |
| `--search` | | Filter logs by text | |

**Examples:**

```bash
# Follow real-time application logs
capsule logs --follow

# View last 50 error logs
capsule logs --level error --lines 50

# View build logs for the latest deployment
capsule logs --source build

# Search for specific text in logs
capsule logs --search "connection refused" --since 24h

# View all log sources
capsule logs --source all --follow
```

---

### `capsule db`

Manage PostgreSQL databases.

#### `capsule db create`

```
capsule db create [flags]
```

| Flag | Short | Description | Default |
|---|---|---|---|
| `--name` | `-n` | Database name | Required |
| `--engine` | `-e` | Database engine | `postgres` |
| `--version` | | Engine version | `15` |

```bash
capsule db create --name main-db
capsule db create --name analytics-db --version 16
```

#### `capsule db list`

```bash
capsule db list
# ┌──────────────┬──────────┬─────────┬──────────┬───────────┐
# │ NAME         │ ENGINE   │ VERSION │ STATUS   │ SIZE      │
# ├──────────────┼──────────┼─────────┼──────────┼───────────┤
# │ main-db      │ postgres │ 15      │ running  │ 128 MB    │
# │ analytics-db │ postgres │ 16      │ running  │ 512 MB    │
# └──────────────┴──────────┴─────────┴──────────┴───────────┘
```

#### `capsule db delete`

```bash
capsule db delete main-db
capsule db delete main-db --delete-data  # also removes volume
```

#### `capsule db status`

```bash
capsule db status main-db
# Status:      running
# Uptime:      3d 12h 45m
# Connections:  5 / 100
# Size:        128 MB
# CPU:         2.3%
# Memory:      64 MB
```

#### `capsule db backup`

```bash
capsule db backup main-db
capsule db backup main-db --storage s3 --encrypt
```

#### `capsule db restore`

```bash
capsule db restore main-db --backup-id d40e8400...
capsule db restore main-db --from-file backup.sql.enc --decrypt
```

#### `capsule db connection-string`

```bash
capsule db connection-string main-db
# postgresql://capsule_user:s3cur3p4ss@capsule-db-dd0e8400.internal:5432/main_db?sslmode=require

capsule db connection-string main-db --format env
# DATABASE_URL=postgresql://capsule_user:s3cur3p4ss@...
```

---

### `capsule redis`

Manage Redis instances.

#### `capsule redis create`

```bash
capsule redis create --name app-cache
capsule redis create --name sessions --memory 512
```

| Flag | Short | Description | Default |
|---|---|---|---|
| `--name` | `-n` | Instance name | Required |
| `--version` | | Redis version | `7` |
| `--memory` | | Max memory in MB | `256` |

#### `capsule redis list`

```bash
capsule redis list
```

#### `capsule redis delete`

```bash
capsule redis delete app-cache
```

#### `capsule redis status`

```bash
capsule redis status app-cache
# Status:       running
# Memory:       64 / 256 MB
# Keys:         15,420
# Hit Rate:     94.2%
# Connections:  3
```

#### `capsule redis flush`

```bash
capsule redis flush app-cache
capsule redis flush app-cache --confirm  # skip prompt
```

#### `capsule redis connection-string`

```bash
capsule redis connection-string app-cache
# redis://:s3cur3p4ss@capsule-redis-ff0e8400.internal:6379/0
```

---

### `capsule domains`

Manage custom domains.

#### `capsule domains add`

```bash
capsule domains add api.example.com
capsule domains add api.example.com --dns-provider external
```

| Flag | Description | Default |
|---|---|---|
| `--dns-provider` | `route53` or `external` | `route53` |

#### `capsule domains list`

```bash
capsule domains list
# ┌─────────────────────┬──────────┬─────┬────────────────┐
# │ DOMAIN              │ STATUS   │ SSL │ EXPIRES        │
# ├─────────────────────┼──────────┼─────┼────────────────┤
# │ api.example.com     │ active   │ ✓   │ 2026-08-24     │
# │ app.example.com     │ pending  │ ✗   │ —              │
# └─────────────────────┴──────────┴─────┴────────────────┘
```

#### `capsule domains remove`

```bash
capsule domains remove api.example.com
```

#### `capsule domains verify`

```bash
capsule domains verify api.example.com
```

#### `capsule domains ssl-status`

```bash
capsule domains ssl-status api.example.com
# Issuer:      Let's Encrypt Authority X3
# Issued:      2026-05-26
# Expires:     2026-08-24 (90 days)
# Auto-Renew:  enabled
```

---

### `capsule env`

Manage environment variables.

#### `capsule env set`

```bash
# Set one variable
capsule env set DATABASE_URL="postgresql://..."

# Set multiple variables
capsule env set NODE_ENV=production PORT=3000 LOG_LEVEL=info

# Set from a file
capsule env set --from-file .env.production

# Set as secret (masked in output)
capsule env set --secret API_KEY="sk-live-abc123"

# Set with specific scope
capsule env set --scope build NODE_ENV=production
```

| Flag | Description | Default |
|---|---|---|
| `--secret` | Mark as secret (masked in list) | Auto-detect |
| `--scope` | `runtime`, `build`, `both` | `runtime` |
| `--from-file` | Load from .env file | |
| `--no-restart` | Don't restart after setting | `false` |

#### `capsule env list`

```bash
capsule env list
# ┌──────────────┬────────────────────┬────────┬─────────┐
# │ KEY          │ VALUE              │ SECRET │ SCOPE   │
# ├──────────────┼────────────────────┼────────┼─────────┤
# │ DATABASE_URL │ ***REDACTED***     │ ✓      │ runtime │
# │ NODE_ENV     │ production         │ ✗      │ both    │
# │ PORT         │ 3000               │ ✗      │ runtime │
# │ API_KEY      │ ***REDACTED***     │ ✓      │ runtime │
# └──────────────┴────────────────────┴────────┴─────────┘
```

#### `capsule env get`

```bash
capsule env get DATABASE_URL
# postgresql://capsule_user:s3cur3p4ss@host:5432/main_db
```

#### `capsule env delete`

```bash
capsule env delete API_KEY
```

#### `capsule env pull`

Download all env vars as a `.env` file:

```bash
capsule env pull
# Wrote 4 variables to .env

capsule env pull --output .env.production
# Wrote 4 variables to .env.production

capsule env pull --include-secrets
# Wrote 4 variables to .env (including secrets)
```

---

### `capsule backup`

Backup and restore operations.

#### `capsule backup create`

```bash
# Backup a specific database
capsule backup create --type database --name main-db

# Full platform backup
capsule backup create --type full --encrypt

# Backup everything (alias for full + encrypt)
capsule package --everything
```

| Flag | Description | Default |
|---|---|---|
| `--type` | `database`, `redis`, `platform`, `full` | Required |
| `--name` | Resource name (for db/redis) | |
| `--encrypt` | AES-256 encrypt the backup | `true` |
| `--storage` | `s3`, `local` | `s3` |
| `--output` | Local output path (for local storage) | Auto-generated |

#### `capsule backup list`

```bash
capsule backup list
# ┌────────────────┬──────────┬───────────┬──────────┬───────────┐
# │ ID             │ TYPE     │ RESOURCE  │ SIZE     │ CREATED   │
# ├────────────────┼──────────┼───────────┼──────────┼───────────┤
# │ d40e8400...    │ database │ main-db   │ 128 MB   │ 2h ago    │
# │ d40e8401...    │ full     │ platform  │ 1.2 GB   │ 1d ago    │
# └────────────────┴──────────┴───────────┴──────────┴───────────┘
```

#### `capsule backup download`

```bash
capsule backup download d40e8400... --output ./backup.tar.enc
```

#### `capsule backup restore`

```bash
capsule backup restore d40e8400... --target main-db
capsule backup restore d40e8400... --target main-db --confirm
```

---

### `capsule package`

Export or import complete platform state.

```bash
# Export everything
capsule package --everything
# ✓ Exporting platform database...
# ✓ Exporting 3 databases...
# ✓ Exporting 2 Redis instances...
# ✓ Exporting environment variables...
# ✓ Exporting domain configurations...
# ✓ Exporting Traefik config...
# ✓ Encrypting (AES-256-GCM)...
# ✓ Package saved: capsule-package-2026-05-26.tar.enc (1.2 GB)

# Import on a new server
capsule package import capsule-package-2026-05-26.tar.enc
```

---

### `capsule server`

Manage cluster servers.

```bash
capsule server list
capsule server create --name worker-2 --type t3.medium
capsule server delete worker-2
capsule server start worker-2
capsule server stop worker-2
capsule server restart worker-2
capsule server status worker-2
```

---

### `capsule worker`

Manage background worker processes.

```bash
# Create a worker
capsule worker create --name queue-processor --command "node worker.js" --replicas 2

# List workers
capsule worker list

# View worker logs
capsule worker logs queue-processor --follow

# Delete a worker
capsule worker delete queue-processor
```

---

### `capsule auth`

Authentication management.

```bash
capsule auth status     # Show current auth state
capsule auth whoami     # Show current user
capsule auth tokens     # List API tokens
capsule auth revoke     # Revoke an API token
```

---

### `capsule version`

Show CLI version and build info.

```bash
capsule version
# capsule v1.0.0
# Build:    abc1234
# Date:     2026-05-26
# Go:       go1.22.3
# OS/Arch:  darwin/arm64
```

---

### `capsule update`

Self-update the CLI binary.

```bash
capsule update
# Current: v1.0.0
# Latest:  v1.1.0
# Updating... ✓
```

---

## 6. Environment Variables

These environment variables configure the CLI without flags:

| Variable | Description | Default |
|---|---|---|
| `CAPSULE_HOST` | Capsule server URL | Config file value |
| `CAPSULE_TOKEN` | API token (overrides stored auth) | Config file value |
| `CAPSULE_OUTPUT` | Output format: `table`, `json`, `quiet` | `table` |
| `CAPSULE_NO_COLOR` | Disable colors (`1` or `true`) | `false` |
| `CAPSULE_CONFIG_DIR` | Config directory path | `~/.capsule` |
| `CAPSULE_PROJECT_ID` | Override project ID (skip config lookup) | `.capsule/config.json` value |
| `CAPSULE_DEBUG` | Enable debug logging (`1` or `true`) | `false` |
| `CAPSULE_TIMEOUT` | Default HTTP timeout in seconds | `30` |
| `CAPSULE_TLS_SKIP_VERIFY` | Skip TLS verification (dev only) | `false` |

**Priority order:** CLI flags > Environment variables > Config file > Defaults

---

## 7. Output Formats

### Table (default)

Human-readable tabular output:

```bash
capsule db list --output table
# ┌──────────────┬──────────┬─────────┬──────────┐
# │ NAME         │ ENGINE   │ VERSION │ STATUS   │
# ├──────────────┼──────────┼─────────┼──────────┤
# │ main-db      │ postgres │ 15      │ running  │
# └──────────────┴──────────┴─────────┴──────────┘
```

### JSON

Machine-readable JSON output (ideal for scripting):

```bash
capsule db list --output json
# [{"name":"main-db","engine":"postgres","version":"15","status":"running","size_mb":128}]
```

### Quiet

Minimal output (IDs only, for piping):

```bash
capsule db list --output quiet
# dd0e8400-e29b-41d4-a716-446655440010
# dd0e8400-e29b-41d4-a716-446655440011
```

### Scripting Examples

```bash
# Get project ID for piping
PROJECT_ID=$(capsule init --output quiet)

# Parse JSON with jq
capsule db list -o json | jq '.[].name'

# Loop over all projects
for id in $(capsule project list -o quiet); do
  capsule deploy --project $id
done
```

---

## 8. Shell Completion

### Bash

```bash
capsule completion bash > /etc/bash_completion.d/capsule
source /etc/bash_completion.d/capsule
```

### Zsh

```bash
capsule completion zsh > "${fpath[1]}/_capsule"
source ~/.zshrc
```

### Fish

```bash
capsule completion fish > ~/.config/fish/completions/capsule.fish
```

### PowerShell

```powershell
capsule completion powershell | Out-String | Invoke-Expression
```

---

## 9. Troubleshooting

### Common Issues

| Issue | Solution |
|---|---|
| `Error: no project found` | Run `capsule init` in your project directory |
| `Error: unauthorized` | Run `capsule login` or check `CAPSULE_TOKEN` |
| `Error: connection refused` | Verify `CAPSULE_HOST` and network connectivity |
| `Error: build timeout` | Increase `--timeout` or optimize Dockerfile |
| `Error: health check failed` | Verify your app has a `/health` endpoint |
| `TLS certificate verify failed` | Ensure server has valid SSL; use `--tls-skip-verify` for dev |

### Debug Mode

```bash
# Enable verbose output
capsule deploy --verbose

# Or via environment variable
CAPSULE_DEBUG=1 capsule deploy

# View HTTP requests/responses
CAPSULE_DEBUG=1 capsule db list 2>&1 | grep "HTTP"
```

### Reset Configuration

```bash
# Remove all stored config and tokens
rm -rf ~/.capsule

# Remove project-level config
rm -rf .capsule
```

---

> **Resumen (ES):** Referencia completa del CLI de Capsule. Incluye instrucciones de instalación para macOS/Linux/Windows, inicio rápido, formato del archivo de configuración (`.capsule/config.json`), flujo de autenticación con diagramas, referencia detallada de todos los comandos (init, deploy, logs, db, redis, domains, env, backup, package, server, worker, auth, version, update) con flags y ejemplos para cada uno, variables de entorno que afectan el comportamiento del CLI, formatos de salida (table, json, quiet), autocompletado de shell, y guía de solución de problemas.
