# Capsule — REST API Reference

> **Version:** v1  
> **Base URL:** `https://<your-capsule-host>/api/v1`  
> **Last Updated:** 2026-05-26  
> **Format:** JSON (application/json)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication](#2-authentication)
3. [Common Patterns](#3-common-patterns)
4. [Auth Endpoints](#4-auth-endpoints)
5. [Projects](#5-projects)
6. [Deployments](#6-deployments)
7. [Databases](#7-databases)
8. [Redis](#8-redis)
9. [Domains](#9-domains)
10. [Environment Variables](#10-environment-variables)
11. [Servers](#11-servers)
12. [Workers](#12-workers)
13. [Backups](#13-backups)
14. [Logs](#14-logs)
15. [Error Codes](#15-error-codes)
16. [Rate Limiting](#16-rate-limiting)

---

## 1. Overview

The Capsule API is a RESTful HTTP API. All requests and responses use JSON (`application/json`), except for file uploads which use `multipart/form-data`.

### Base URL

```
https://<your-capsule-host>/api/v1
```

### Versioning

The API is versioned via URL path (`/api/v1`). Breaking changes will only be introduced in new major versions (`/api/v2`).

### Content Type

All requests must include:

```
Content-Type: application/json
```

Exceptions: file upload endpoints accept `multipart/form-data`.

---

## 2. Authentication

### Bearer Token (JWT)

Obtained via `POST /auth/login`. Include in the `Authorization` header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

- **Access token lifetime:** 15 minutes
- **Refresh token lifetime:** 7 days
- Dashboard uses HttpOnly cookies for the refresh token

### API Key

Generated via `POST /auth/cli-token` or the Dashboard. Include as a header:

```
Authorization: Bearer cap_1a2b3c4d5e6f...
```

API keys use the `cap_` prefix and have configurable scopes and expiry.

### Authentication Priority

1. `Authorization: Bearer <jwt>` — checked first
2. `Authorization: Bearer cap_<api_key>` — checked if no valid JWT
3. `X-API-Key: cap_<api_key>` — alternative header for API keys

---

## 3. Common Patterns

### Pagination

List endpoints support cursor-based pagination:

```
GET /v1/projects?limit=20&cursor=eyJpZCI6IjEyMyJ9
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 20 | Items per page (max 100) |
| `cursor` | string | — | Opaque cursor from previous response |

Response includes:

```json
{
  "data": [...],
  "pagination": {
    "has_more": true,
    "next_cursor": "eyJpZCI6IjQ1NiJ9",
    "total": 42
  }
}
```

### Filtering

List endpoints accept query parameters for filtering:

```
GET /v1/deployments?project_id=xxx&status=active
```

### Sorting

```
GET /v1/projects?sort=created_at&order=desc
```

### Standard Response Envelope

**Success:**

```json
{
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-05-26T08:46:40Z"
  }
}
```

**Error:**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Project name is required",
    "details": [
      { "field": "name", "message": "must not be empty" }
    ]
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-05-26T08:46:40Z"
  }
}
```

---

## 4. Auth Endpoints

### POST /auth/register

Create a new user account.

**Request:**

```json
{
  "email": "dev@example.com",
  "password": "SecurePass123!",
  "name": "Jane Developer"
}
```

**Response (201):**

```json
{
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "dev@example.com",
      "name": "Jane Developer",
      "role": "admin",
      "created_at": "2026-05-26T08:46:40Z"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 900
  }
}
```

> **Note:** The first registered user automatically receives the `admin` role.

---

### POST /auth/login

Authenticate with email and password.

**Request:**

```json
{
  "email": "dev@example.com",
  "password": "SecurePass123!"
}
```

**Response (200):**

```json
{
  "data": {
    "user": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "dev@example.com",
      "name": "Jane Developer",
      "role": "admin"
    },
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 900
  }
}
```

**Error (401):**

```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

---

### POST /auth/refresh

Refresh an expired access token.

**Request:**

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response (200):**

```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 900
  }
}
```

---

### POST /auth/cli-token

Generate a long-lived API token for CLI usage.

**Request:**

```json
{
  "name": "CLI - MacBook Pro",
  "scopes": ["projects:read", "projects:write", "deployments:*"],
  "expires_in_days": 365
}
```

**Response (201):**

```json
{
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "CLI - MacBook Pro",
    "token": "cap_1a2b3c4d5e6f7g8h9i0j_full_token_shown_once",
    "prefix": "cap_1a2b",
    "scopes": ["projects:read", "projects:write", "deployments:*"],
    "expires_at": "2027-05-26T08:46:40Z",
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

> **⚠️ Important:** The full `token` value is shown only once. Store it securely.

---

## 5. Projects

### POST /projects

Create a new project.

**Request:**

```json
{
  "name": "My API",
  "repo_url": "https://github.com/user/my-api.git",
  "branch": "main",
  "build_strategy": "auto",
  "serverless": false,
  "replicas": 1
}
```

**Response (201):**

```json
{
  "data": {
    "id": "770e8400-e29b-41d4-a716-446655440002",
    "org_id": "880e8400-e29b-41d4-a716-446655440003",
    "name": "My API",
    "slug": "my-api",
    "repo_url": "https://github.com/user/my-api.git",
    "branch": "main",
    "build_strategy": "auto",
    "runtime": null,
    "serverless": false,
    "replicas": 1,
    "status": "created",
    "created_at": "2026-05-26T08:46:40Z",
    "updated_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /projects

List all projects in the current organization.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status |
| `search` | string | Search by name or slug |
| `sort` | string | `name`, `created_at`, `updated_at` |
| `order` | string | `asc`, `desc` |
| `limit` | int | Max items (default 20) |
| `cursor` | string | Pagination cursor |

**Response (200):**

```json
{
  "data": [
    {
      "id": "770e8400...",
      "name": "My API",
      "slug": "my-api",
      "status": "active",
      "runtime": "go",
      "replicas": 2,
      "created_at": "2026-05-26T08:46:40Z"
    }
  ],
  "pagination": {
    "has_more": false,
    "next_cursor": null,
    "total": 1
  }
}
```

---

### GET /projects/:id

Get project details.

**Response (200):**

```json
{
  "data": {
    "id": "770e8400...",
    "name": "My API",
    "slug": "my-api",
    "repo_url": "https://github.com/user/my-api.git",
    "branch": "main",
    "build_strategy": "auto",
    "runtime": "go",
    "serverless": false,
    "replicas": 2,
    "status": "active",
    "labels": { "env": "production" },
    "latest_deployment": {
      "id": "990e8400...",
      "version": "v3",
      "status": "active",
      "git_sha": "abc1234567890",
      "created_at": "2026-05-26T08:00:00Z"
    },
    "domains": ["myapi.example.com"],
    "created_at": "2026-05-26T08:46:40Z",
    "updated_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### PUT /projects/:id

Update project configuration.

**Request:**

```json
{
  "name": "My API v2",
  "branch": "develop",
  "replicas": 3
}
```

**Response (200):** Updated project object.

---

### DELETE /projects/:id

Soft-delete a project. Stops all containers and releases domains.

**Response (204):** No content.

---

### POST /projects/:id/deploy

Trigger a deployment from the linked Git repository.

**Request:**

```json
{
  "branch": "main",
  "commit": "abc1234"
}
```

**Response (202):**

```json
{
  "data": {
    "deployment_id": "990e8400...",
    "status": "building",
    "stream_url": "wss://<host>/api/v1/deployments/990e8400.../logs/stream"
  }
}
```

---

### POST /projects/:id/link

Link a local directory to an existing project (used by CLI).

**Request:**

```json
{
  "local_path": "/home/user/my-api"
}
```

**Response (200):**

```json
{
  "data": {
    "project_id": "770e8400...",
    "linked": true,
    "config_path": ".capsule/config.json"
  }
}
```

---

### POST /projects/:id/unlink

Unlink a local directory from a project.

**Response (200):**

```json
{
  "data": {
    "project_id": "770e8400...",
    "linked": false
  }
}
```

---

## 6. Deployments

### GET /deployments

List deployments with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project_id` | uuid | Required — filter by project |
| `status` | string | `pending`, `building`, `deploying`, `active`, `rolled_back`, `failed` |
| `limit` | int | Max items (default 20) |
| `cursor` | string | Pagination cursor |

**Response (200):**

```json
{
  "data": [
    {
      "id": "990e8400...",
      "project_id": "770e8400...",
      "version": "v3",
      "git_sha": "abc1234567890",
      "status": "active",
      "trigger": "manual",
      "build_duration_ms": 45200,
      "deploy_duration_ms": 12300,
      "created_at": "2026-05-26T08:00:00Z",
      "completed_at": "2026-05-26T08:01:00Z"
    }
  ],
  "pagination": { "has_more": true, "next_cursor": "..." }
}
```

---

### GET /deployments/:id

Get deployment details including build info and timing.

**Response (200):**

```json
{
  "data": {
    "id": "990e8400...",
    "project_id": "770e8400...",
    "server_id": "aa0e8400...",
    "version": "v3",
    "git_sha": "abc1234567890",
    "status": "active",
    "image_tag": "my-api:abc1234",
    "build_strategy": "dockerfile",
    "container_port": 8080,
    "build_duration_ms": 45200,
    "deploy_duration_ms": 12300,
    "trigger": "manual",
    "triggered_by": "550e8400...",
    "started_at": "2026-05-26T08:00:00Z",
    "completed_at": "2026-05-26T08:01:00Z",
    "created_at": "2026-05-26T08:00:00Z"
  }
}
```

---

### POST /deployments/:id/rollback

Roll back to this deployment version.

**Response (202):**

```json
{
  "data": {
    "deployment_id": "bb0e8400...",
    "status": "deploying",
    "rollback_from": "v4",
    "rollback_to": "v3",
    "stream_url": "wss://<host>/api/v1/deployments/bb0e8400.../logs/stream"
  }
}
```

---

### POST /deployments/:id/promote

Promote a staging/canary deployment to active.

**Response (200):**

```json
{
  "data": {
    "deployment_id": "990e8400...",
    "status": "active",
    "promoted_at": "2026-05-26T09:00:00Z"
  }
}
```

---

### GET /deployments/:id/logs

Get historical build and deploy logs.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `level` | string | Filter: `debug`, `info`, `warn`, `error` |
| `since` | string | ISO 8601 timestamp |
| `limit` | int | Max log entries (default 500) |

**Response (200):**

```json
{
  "data": [
    {
      "id": "cc0e8400...",
      "level": "info",
      "message": "Step 1/12 : FROM golang:1.22-alpine",
      "created_at": "2026-05-26T08:00:01Z"
    },
    {
      "id": "cc0e8401...",
      "level": "info",
      "message": "Step 2/12 : WORKDIR /app",
      "created_at": "2026-05-26T08:00:01Z"
    }
  ]
}
```

---

## 7. Databases

### POST /databases

Provision a new managed PostgreSQL instance.

**Request:**

```json
{
  "project_id": "770e8400...",
  "name": "main-db",
  "engine": "postgres",
  "version": "15"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "dd0e8400...",
    "project_id": "770e8400...",
    "name": "main-db",
    "engine": "postgres",
    "version": "15",
    "host": "capsule-db-dd0e8400.internal",
    "port": 5432,
    "db_name": "main_db",
    "status": "provisioning",
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /databases

List all databases.

**Query Parameters:** `project_id` (optional), `status`, `limit`, `cursor`

**Response (200):**

```json
{
  "data": [
    {
      "id": "dd0e8400...",
      "name": "main-db",
      "engine": "postgres",
      "version": "15",
      "status": "running",
      "size_mb": 128,
      "created_at": "2026-05-26T08:46:40Z"
    }
  ]
}
```

---

### GET /databases/:id

Get database details.

---

### DELETE /databases/:id

Delete a database (stops container, optionally deletes volume).

**Query Parameters:** `delete_data=true` (default `false`)

**Response (202):**

```json
{
  "data": {
    "id": "dd0e8400...",
    "status": "deleting",
    "data_deleted": false,
    "message": "Database will be stopped. Data volume retained."
  }
}
```

---

### GET /databases/:id/status

Get real-time database status and metrics.

**Response (200):**

```json
{
  "data": {
    "id": "dd0e8400...",
    "status": "running",
    "uptime_seconds": 86400,
    "connections_active": 5,
    "connections_max": 100,
    "size_mb": 128,
    "cpu_percent": 2.3,
    "memory_mb": 64
  }
}
```

---

### POST /databases/:id/backup

Create a backup of the database.

**Request:**

```json
{
  "storage_backend": "s3",
  "encrypt": true
}
```

**Response (202):**

```json
{
  "data": {
    "backup_id": "ee0e8400...",
    "status": "in_progress",
    "estimated_size_mb": 128
  }
}
```

---

### POST /databases/:id/restore

Restore a database from a backup.

**Request:**

```json
{
  "backup_id": "ee0e8400..."
}
```

**Response (202):**

```json
{
  "data": {
    "status": "restoring",
    "backup_id": "ee0e8400...",
    "message": "Database will be stopped, restored, and restarted."
  }
}
```

---

### GET /databases/:id/connection-string

Get the connection string for a database (requires auth).

**Response (200):**

```json
{
  "data": {
    "connection_string": "postgresql://capsule_user:s3cur3p4ss@capsule-db-dd0e8400.internal:5432/main_db?sslmode=require",
    "host": "capsule-db-dd0e8400.internal",
    "port": 5432,
    "user": "capsule_user",
    "database": "main_db"
  }
}
```

> **⚠️ Warning:** The password is included in the connection string. This endpoint requires authentication and is logged in the audit trail.

---

## 8. Redis

### POST /redis

Create a new managed Redis instance.

**Request:**

```json
{
  "project_id": "770e8400...",
  "name": "app-cache",
  "version": "7",
  "memory_mb": 256
}
```

**Response (201):**

```json
{
  "data": {
    "id": "ff0e8400...",
    "project_id": "770e8400...",
    "name": "app-cache",
    "version": "7",
    "host": "capsule-redis-ff0e8400.internal",
    "port": 6379,
    "status": "provisioning",
    "memory_mb": 256,
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /redis

List all Redis instances.

**Query Parameters:** `project_id`, `status`, `limit`, `cursor`

---

### DELETE /redis/:id

Delete a Redis instance.

**Query Parameters:** `delete_data=true`

**Response (202):** Status update with deletion info.

---

### GET /redis/:id/status

Get real-time Redis metrics.

**Response (200):**

```json
{
  "data": {
    "id": "ff0e8400...",
    "status": "running",
    "uptime_seconds": 43200,
    "memory_used_mb": 64,
    "memory_max_mb": 256,
    "connected_clients": 3,
    "keys_total": 15420,
    "hit_rate_percent": 94.2
  }
}
```

---

### POST /redis/:id/flush

Flush all keys from the Redis instance.

**Request:**

```json
{
  "confirm": true,
  "async": true
}
```

**Response (200):**

```json
{
  "data": {
    "flushed": true,
    "keys_removed": 15420
  }
}
```

---

### GET /redis/:id/connection-string

**Response (200):**

```json
{
  "data": {
    "connection_string": "redis://:s3cur3p4ss@capsule-redis-ff0e8400.internal:6379/0",
    "host": "capsule-redis-ff0e8400.internal",
    "port": 6379
  }
}
```

---

## 9. Domains

### POST /domains

Bind a custom domain to a project.

**Request:**

```json
{
  "project_id": "770e8400...",
  "domain_name": "api.example.com",
  "dns_provider": "route53"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "a10e8400...",
    "project_id": "770e8400...",
    "domain_name": "api.example.com",
    "record_type": "CNAME",
    "record_value": "capsule-alb-123456.us-east-1.elb.amazonaws.com",
    "verification_token": "capsule-verify-abc123def456",
    "status": "pending",
    "ssl_enabled": false,
    "dns_provider": "route53",
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### DELETE /domains/:id

Unbind a domain from a project. Removes DNS records if managed.

**Response (204):** No content.

---

### GET /domains

List all domains.

**Query Parameters:** `project_id`, `status`

---

### POST /domains/:id/verify

Manually trigger DNS verification.

**Response (200):**

```json
{
  "data": {
    "id": "a10e8400...",
    "domain_name": "api.example.com",
    "status": "active",
    "verified_at": "2026-05-26T09:00:00Z",
    "ssl_enabled": true,
    "ssl_expires_at": "2026-08-24T09:00:00Z"
  }
}
```

---

### GET /domains/:id/ssl-status

Check SSL certificate status for a domain.

**Response (200):**

```json
{
  "data": {
    "domain_name": "api.example.com",
    "ssl_enabled": true,
    "issuer": "Let's Encrypt Authority X3",
    "issued_at": "2026-05-26T09:00:00Z",
    "expires_at": "2026-08-24T09:00:00Z",
    "auto_renew": true,
    "days_until_expiry": 90
  }
}
```

---

## 10. Environment Variables

### POST /env-vars

Set one or more environment variables.

**Request:**

```json
{
  "project_id": "770e8400...",
  "variables": [
    { "key": "DATABASE_URL", "value": "postgresql://...", "is_secret": true, "scope": "runtime" },
    { "key": "NODE_ENV", "value": "production", "is_secret": false, "scope": "both" }
  ]
}
```

**Response (200):**

```json
{
  "data": {
    "set": 2,
    "variables": [
      { "key": "DATABASE_URL", "value": "***REDACTED***", "is_secret": true, "scope": "runtime" },
      { "key": "NODE_ENV", "value": "production", "is_secret": false, "scope": "both" }
    ],
    "restart_required": true
  }
}
```

---

### GET /env-vars

List environment variables for a project.

**Query Parameters:** `project_id` (required), `scope`

**Response (200):**

```json
{
  "data": [
    { "key": "DATABASE_URL", "value": "***REDACTED***", "is_secret": true, "scope": "runtime", "updated_at": "2026-05-26T08:46:40Z" },
    { "key": "NODE_ENV", "value": "production", "is_secret": false, "scope": "both", "updated_at": "2026-05-26T08:46:40Z" }
  ]
}
```

> Secrets are always redacted in list responses. Use `GET /env-vars/:key` with explicit auth.

---

### GET /env-vars/:key

Get a single environment variable value. Returns the decrypted value.

**Query Parameters:** `project_id` (required)

**Response (200):**

```json
{
  "data": {
    "key": "DATABASE_URL",
    "value": "postgresql://user:pass@host:5432/db",
    "is_secret": true,
    "scope": "runtime"
  }
}
```

---

### DELETE /env-vars/:key

Delete an environment variable.

**Query Parameters:** `project_id` (required)

**Response (204):** No content.

---

### POST /env-vars/pull

Pull all environment variables as a `.env` file (used by CLI).

**Request:**

```json
{
  "project_id": "770e8400...",
  "scope": "runtime",
  "include_secrets": true
}
```

**Response (200):**

```
Content-Type: text/plain

DATABASE_URL=postgresql://user:pass@host:5432/db
NODE_ENV=production
REDIS_URL=redis://:pass@host:6379/0
```

---

## 11. Servers

### POST /servers

Provision a new server (EC2 instance).

**Request:**

```json
{
  "name": "worker-2",
  "instance_type": "t3.medium",
  "availability_zone": "us-east-1a",
  "role": "worker"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "b20e8400...",
    "name": "worker-2",
    "instance_id": "i-0abc123def456789",
    "instance_type": "t3.medium",
    "availability_zone": "us-east-1a",
    "status": "provisioning",
    "role": "worker",
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /servers

List all servers.

---

### DELETE /servers/:id

Terminate a server.

**Response (202):**

```json
{
  "data": {
    "id": "b20e8400...",
    "status": "terminating",
    "message": "Draining connections. Containers will be rescheduled."
  }
}
```

---

### POST /servers/:id/start

Start a stopped server.

**Response (200):** Server status update.

---

### POST /servers/:id/stop

Stop a running server (preserves data).

**Response (200):** Server status update.

---

### POST /servers/:id/restart

Restart a server.

**Response (200):** Server status update.

---

### GET /servers/:id/status

Get real-time server metrics.

**Response (200):**

```json
{
  "data": {
    "id": "b20e8400...",
    "status": "running",
    "uptime_seconds": 172800,
    "cpu_percent": 35.2,
    "memory_used_mb": 1024,
    "memory_total_mb": 4096,
    "disk_used_gb": 12.5,
    "disk_total_gb": 50.0,
    "containers_running": 8,
    "network_in_mbps": 2.3,
    "network_out_mbps": 1.1,
    "last_heartbeat_at": "2026-05-26T08:46:30Z"
  }
}
```

---

## 12. Workers

### POST /workers

Create a background worker process.

**Request:**

```json
{
  "project_id": "770e8400...",
  "name": "queue-processor",
  "command": "node worker.js",
  "replicas": 2,
  "restart_policy": "on-failure"
}
```

**Response (201):**

```json
{
  "data": {
    "id": "c30e8400...",
    "project_id": "770e8400...",
    "name": "queue-processor",
    "command": "node worker.js",
    "replicas": 2,
    "status": "running",
    "restart_policy": "on-failure",
    "created_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /workers

List workers. **Query Parameters:** `project_id`

---

### DELETE /workers/:id

Stop and delete a worker.

**Response (204):** No content.

---

### GET /workers/:id/logs

Get worker logs. Same query parameters and response format as deployment logs.

---

## 13. Backups

### POST /backups

Create a backup.

**Request:**

```json
{
  "resource_type": "database",
  "resource_id": "dd0e8400...",
  "storage_backend": "s3",
  "encrypt": true
}
```

For a full platform backup:

```json
{
  "resource_type": "full",
  "storage_backend": "s3",
  "encrypt": true
}
```

**Response (202):**

```json
{
  "data": {
    "id": "d40e8400...",
    "resource_type": "database",
    "status": "in_progress",
    "started_at": "2026-05-26T08:46:40Z"
  }
}
```

---

### GET /backups

List backup history. **Query Parameters:** `resource_type`, `resource_id`, `status`, `limit`, `cursor`

---

### GET /backups/:id/download

Download a backup file.

**Response (200):** Binary stream with headers:

```
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="capsule-backup-2026-05-26.tar.enc"
Content-Length: 159383552
X-Capsule-Checksum: sha256:abc123...
X-Capsule-Encrypted: true
```

---

### POST /backups/:id/restore

Restore from a backup.

**Request:**

```json
{
  "target_resource_id": "dd0e8400...",
  "confirm": true
}
```

**Response (202):**

```json
{
  "data": {
    "status": "restoring",
    "backup_id": "d40e8400...",
    "target_resource_id": "dd0e8400...",
    "message": "Restore in progress. The resource will be restarted."
  }
}
```

---

## 14. Logs

### WebSocket: /logs/stream

Real-time log streaming via WebSocket.

**Connection:**

```
wss://<host>/api/v1/logs/stream?project_id=770e8400...&source=app
```

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project_id` | uuid | Required — target project |
| `source` | string | `app`, `build`, `worker`, `all` |
| `level` | string | Minimum level: `debug`, `info`, `warn`, `error` |

**Message Format (server → client):**

```json
{
  "type": "log",
  "data": {
    "source": "app",
    "level": "info",
    "message": "Server listening on :8080",
    "container_id": "abc123",
    "timestamp": "2026-05-26T08:46:40.123Z"
  }
}
```

**Heartbeat (server → client, every 30 s):**

```json
{
  "type": "ping",
  "timestamp": "2026-05-26T08:47:10Z"
}
```

**Client sends pong:**

```json
{
  "type": "pong"
}
```

---

### GET /logs/history

Retrieve historical logs.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project_id` | uuid | Required |
| `source` | string | `app`, `build`, `worker` |
| `level` | string | Minimum log level |
| `since` | string | ISO 8601 start time |
| `until` | string | ISO 8601 end time |
| `search` | string | Full-text search in messages |
| `limit` | int | Max entries (default 500, max 5000) |
| `cursor` | string | Pagination cursor |

**Response (200):**

```json
{
  "data": [
    {
      "source": "app",
      "level": "info",
      "message": "Server listening on :8080",
      "container_id": "abc123",
      "timestamp": "2026-05-26T08:46:40.123Z"
    }
  ],
  "pagination": { "has_more": true, "next_cursor": "..." }
}
```

---

## 15. Error Codes

### HTTP Status Codes

| Code | Meaning |
|---|---|
| `200` | OK — request succeeded |
| `201` | Created — resource created |
| `202` | Accepted — async operation started |
| `204` | No Content — successful delete |
| `400` | Bad Request — invalid input |
| `401` | Unauthorized — missing or invalid auth |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found — resource doesn't exist |
| `409` | Conflict — resource already exists or state conflict |
| `422` | Unprocessable Entity — validation failed |
| `429` | Too Many Requests — rate limit exceeded |
| `500` | Internal Server Error |
| `502` | Bad Gateway — upstream service unavailable |
| `503` | Service Unavailable — maintenance mode |

### Application Error Codes

| Code | Description |
|---|---|
| `INVALID_CREDENTIALS` | Wrong email or password |
| `TOKEN_EXPIRED` | JWT has expired |
| `TOKEN_REVOKED` | API token has been revoked |
| `VALIDATION_ERROR` | Request body validation failed |
| `RESOURCE_NOT_FOUND` | The requested resource does not exist |
| `RESOURCE_CONFLICT` | A resource with the same identifier already exists |
| `DEPLOYMENT_IN_PROGRESS` | Another deployment is currently running |
| `BUILD_FAILED` | Container build failed |
| `HEALTH_CHECK_FAILED` | Application health check timed out |
| `DNS_VERIFICATION_FAILED` | Domain DNS verification failed |
| `QUOTA_EXCEEDED` | Resource quota limit reached |
| `BACKUP_IN_PROGRESS` | A backup operation is already running |
| `RESTORE_FAILED` | Backup restore operation failed |
| `AWS_ERROR` | Upstream AWS service error |
| `RATE_LIMITED` | Too many requests |
| `INTERNAL_ERROR` | Unexpected server error |

---

## 16. Rate Limiting

### Default Limits

| Endpoint Category | Limit | Window |
|---|---|---|
| Auth endpoints | 10 requests | 1 minute |
| Read endpoints (GET) | 100 requests | 1 minute |
| Write endpoints (POST/PUT/DELETE) | 30 requests | 1 minute |
| Deploy | 5 requests | 5 minutes |
| Backup/Restore | 3 requests | 10 minutes |
| Log streaming (WebSocket) | 5 connections | concurrent |

### Rate Limit Headers

Every response includes rate limit information:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1716710800
Retry-After: 30
```

### Rate Limit Exceeded Response (429)

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 30 seconds.",
    "retry_after": 30
  }
}
```

---

> **Resumen (ES):** Referencia completa de la API REST de Capsule v1. Cubre autenticación (JWT y API keys), todos los endpoints organizados por recurso (auth, proyectos, despliegues, bases de datos, Redis, dominios, variables de entorno, servidores, workers, backups, y logs incluyendo streaming por WebSocket), ejemplos de request/response en JSON, códigos de error de aplicación, y políticas de rate limiting.
