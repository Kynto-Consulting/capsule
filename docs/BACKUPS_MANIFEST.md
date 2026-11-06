# Backup manifest format (schema 1)

Every project backup run writes `projects/<projectID>/manifest/<RFC3339>-<runID>.json.enc`, and every platform
backup run writes `platform/<RFC3339>-<runID>.inventory.json.enc`. Both are encrypted with the same envelope as
data backups (see `docs/SELF_HOSTING.md`, "Backups") and contain **references only, never secret values**:
environment variable *names* are listed, their values live encrypted in Capsule's database, and database
credentials stay encrypted there too.

The `"schema"` field is `1`. Any incompatible change bumps it; readers (the future `recover` procedure) must
refuse a schema they do not know. New optional fields may be added without a bump.

## Project manifest

| Field | Meaning |
| --- | --- |
| `schema`, `generated_at`, `run_id` | format version, UTC time, backup run id |
| `project` | `id`, `org_id`, `slug`, `runtime`, `deploy_type`, `health_path` (when known) |
| `deployment` | last successful deployment (absent if none): `id`, `version`, `git_sha`, `image_tag`, `image_id`, `image_digests` (RepoDigests), `source_key` (key of the source archive `deployments/<projectID>/<uuid>.tar.gz` in the artifacts bucket), `container_port`, `host_port` |
| `container` | the app container as it ran (absent if not present): `name` (`capsule-app-<12 hex>`), `image`, `restart_policy`, `networks`, `memory_limit_bytes`, `cpu_limit_nanos`, `published_ports` (`container_port` like `3000/tcp`, `host_port`), `health_test` |
| `volumes` | named volumes of the app container: `name`, `mount_point` (normally `capsule-data-<projectID>` at `/data`) |
| `objects` (snapshot kind, not a manifest field) | buckets of the project in Capsule object storage are archived as `projects/<projectID>/objects/...tar.gz.enc` (see `docs/OBJECT_STORAGE.md`); the manifest carries no object data or keys. To rebuild a project restore that snapshot after the volume |
| `env_var_names` | sorted names of the project's environment variables |
| `databases[]` | per project database: `id`, `name`, `engine`, `version`, `image`, `db_name`, `host_port`, `container` (`capsule-db-<id>`), `volumes[]`, `restart_policy`, `container_present` |

To rebuild a project: rebuild the image from `deployment.source_key` (or pull `image_digests`), re-create the volumes
and restore the latest `volume` snapshot, re-create each database container from `databases[].image` with its
volume, restore its dump with the credentials stored in Capsule's database, then start the app container with
the recorded port, restart policy, network and limits and the env vars from Capsule's database.

### Example

```json
{
  "schema": 1,
  "generated_at": "2026-11-02T07:00:03Z",
  "run_id": "5d0c2b3e-3b0e-4f1e-9f6a-0c8f3b1a7e11",
  "project": {
    "id": "0f9e7c1a-4f0a-4d0e-8d55-2a3b8f6b9c10",
    "org_id": "8a1b6c2d-7e3f-4a50-9b61-1c2d3e4f5a6b",
    "slug": "shop",
    "runtime": "node",
    "deploy_type": "docker"
  },
  "deployment": {
    "id": "c3d4e5f6-0a1b-4c2d-8e3f-4a5b6c7d8e9f",
    "version": "v7",
    "git_sha": "9fceb02d0ae598e95dc970b74767f19372d61af8",
    "image_tag": "capsule-app-0f9e7c1a4f0a:v7",
    "image_id": "sha256:3b1f...",
    "image_digests": ["598806201852.dkr.ecr.us-east-1.amazonaws.com/capsule/shop@sha256:ab12..."],
    "source_key": "deployments/0f9e7c1a-4f0a-4d0e-8d55-2a3b8f6b9c10/7b6a5f4e-3d2c-4b1a-9f8e-7d6c5b4a3f2e.tar.gz",
    "container_port": 3000,
    "host_port": 41001
  },
  "container": {
    "name": "capsule-app-0f9e7c1a4f0a",
    "image": "capsule-app-0f9e7c1a4f0a",
    "restart_policy": "unless-stopped",
    "networks": ["capsule-prod_capsule-net"],
    "memory_limit_bytes": 0,
    "cpu_limit_nanos": 0,
    "published_ports": [{"container_port": "3000/tcp", "host_port": "41001"}]
  },
  "volumes": [{"name": "capsule-data-0f9e7c1a-4f0a-4d0e-8d55-2a3b8f6b9c10", "mount_point": "/data"}],
  "env_var_names": ["API_KEY", "DATABASE_URL"],
  "databases": [
    {
      "id": "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
      "name": "main",
      "engine": "postgres",
      "version": "16",
      "image": "postgres:16",
      "db_name": "shop",
      "host_port": 41234,
      "container": "capsule-db-e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
      "volumes": [{"name": "7c0d...", "mount_point": "/var/lib/postgresql/data"}],
      "restart_policy": "unless-stopped",
      "container_present": true
    }
  ]
}
```

## Platform inventory

`schema`, `generated_at`, `run_id`, `volumes` (`docker volume ls` names), `ps` (`docker ps -a` lines: names, image,
status, ports, tab-separated) and `containers[]`: `name`, `image`, `image_id`, `status`, `restart_policy`, `networks`,
`published_ports`, `mounts[]` (`type`, `name`, `source`, `destination`), `env_names` (names only), `health_test`.
It covers every container on the host: the core (backend, frontend, redis, git, git-proxy) and project and
database containers.

The platform files object (`...files.tar.gz.enc`) is a tar.gz with paths relative to the host: `capsule/docker-compose*.yml`,
`capsule/.env`, `capsule/certs/...`, and `docker/daemon.json` when present. It is only ever stored encrypted.
