# Capsule Actions

Composite actions for GitHub Actions and Forgejo/Gitea Actions. They wrap the Capsule CLI and API for CI/CD.

| Action | What it does |
|--------|--------------|
| [`deploy`](deploy/README.md) | Deploy a project (optionally mask secrets, wait for health) |
| [`preview`](preview/README.md) | Ephemeral per-PR preview, one PR comment, cleanup on close |
| [`wait-healthy`](#wait-healthy) | Wait for a URL to answer 2xx with retries and backoff; optional rollback |
| [`rollback`](#rollback) | `capsule deployments rollback` and require final status `success` |
| [`vars`](#vars) | Sync account or project variables from a block or file, masking secrets |

Ready-made workflows: [`templates/github-ci-cd.yml`](templates/github-ci-cd.yml) and [`templates/forgejo-ci-cd.yml`](templates/forgejo-ci-cd.yml) (ci, deploy on main, health gate with automatic rollback, PR preview with cleanup).

`_lib/capsule.sh` is shared by the actions: always keep the `actions/` folder together (or vendor all of it, see the Forgejo template).

## Common inputs

All actions that talk to the API take `token`, `org-id`, `project-id`, `api-url`, plus `version` (npm version of `@kyntocg/capsule-cli`, default `latest`; pin it) and `cli-package` (full npm spec that overrides `version`, e.g. a tarball while the CLI is not on npm). The token is passed to `curl` through stdin and masked with `::add-mask::`; it is never printed.

## deploy

See [deploy/README.md](deploy/README.md). New: `secret-env` (masked), `wait-healthy` (path), output `health`.

## preview

See [preview/README.md](preview/README.md). Inputs: `token`, `org-id`, `project-id`, `api-url`, `action` (`deploy|destroy`), `comment`, `git-token`, `provider`, `pr-number`, `ref`, `sha`, `timeout`. Outputs: `url`, `status`.

## wait-healthy

| Input | Default | Description |
|-------|---------|-------------|
| `url` | required | Base URL (e.g. deploy's `url` output) |
| `path` | `/` | Path to probe |
| `expected-status` | `2xx` | `2xx`-style class or list `200,204` |
| `retries` | `30` | Max attempts |
| `interval` | `10` | Seconds before the 2nd attempt |
| `backoff` | `1.2` | Multiplier per attempt (1 = constant) |
| `max-interval` | `30` | Cap on the wait, seconds |
| `timeout` | `10m` | Overall limit (retries or timeout, whichever first) |
| `request-timeout` | `15` | Seconds per request |
| `deployment-id` | | With credentials: also reads `health.status` from the API and stops early on `unhealthy` or a `failed` deployment |
| `rollback-on-failure` | `false` | Roll back when unhealthy (needs token, org-id, project-id, api-url) |

Outputs: `healthy`, `status-code`, `attempts`, `health`, `rolled-back`. It always fails the step when unhealthy, even after a successful rollback, so the pipeline is red.

## rollback

Inputs: `token`, `org-id`, `project-id`, `api-url`, `timeout` (default `10m`), `version`, `cli-package`. Outputs: `deployment-id`, `status`. It records the latest deployment, runs the CLI, checks that a new deployment exists and polls it; it fails unless it ends `success`. A `deploy`-scoped token may be rejected (403) by the server; use a full-access token then.

## vars

| Input | Default | Description |
|-------|---------|-------------|
| `variables` | | `KEY=VALUE` per line; blanks, `#` comments and `export ` are ignored; values are single-line |
| `file` | | `.env`-style file, combined with `variables` |
| `target` | `project` if `project-id` is set, else `account` | `account` uses `capsule vars set`, `project` uses `capsule env set` |
| `secret` | `false` | `true`: stored as secret and EVERY value is masked with `::add-mask::` before use |
| `variable-scope` | `runtime` | `build`, `runtime` or `both` |
| `dry-run` | `false` | Lists names only; no API call |

Output: `count`. Values are never printed (logs show names only). Because masking replaces every occurrence of the value in the log, very short secrets such as `1` also mask that digit elsewhere; avoid trivial values for secrets.

## Minimum GITHUB_TOKEN permissions

| Action | Needs |
|--------|-------|
| deploy, rollback, wait-healthy, vars | `contents: read` (checkout only). They authenticate to Capsule with `CAPSULE_TOKEN`, not `GITHUB_TOKEN` |
| preview (`comment: true`) | `contents: read` and `pull-requests: write` (to create/update the single comment) |
| preview (`comment: false`) | `contents: read` |

Set `permissions:` at workflow level to `contents: read` and widen per job. Fork PRs get no secrets and a read-only token; the preview action skips them.

## Monorepo examples

One workflow, one Capsule project per app, deployed only when its folder changes:

```yaml
on:
  push:
    branches: [main]
    paths: ['apps/web/**', 'apps/api/**', 'packages/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app:
          - { dir: apps/web, project: WEB_PROJECT_ID, health: /health }
          - { dir: apps/api, project: API_PROJECT_ID, health: /healthz }
    steps:
      - uses: actions/checkout@v4.2.2
      - id: capsule
        uses: kynto-consulting/capsule/actions/deploy@v1.0.0
        with:
          token: ${{ secrets[format('CAPSULE_TOKEN_{0}', matrix.app.project)] }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ vars[matrix.app.project] }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          working-directory: ${{ matrix.app.dir }}
          wait-healthy: ${{ matrix.app.health }}
```

A `deploy`-scoped token is limited to one project, hence one token per project (`CAPSULE_TOKEN_WEB_PROJECT_ID`, ...).

Per-app preview (the PR comment uses one shared marker, so with several projects in one PR the comments overwrite each other; use `comment: 'false'` on all but one):

```yaml
  preview-web:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: kynto-consulting/capsule/actions/preview@v1.0.0
        with:
          token: ${{ secrets.CAPSULE_TOKEN_WEB }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ vars.WEB_PROJECT_ID }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          action: ${{ github.event.action == 'closed' && 'destroy' || 'deploy' }}
```

Sync variables before deploying (project target, secrets masked):

```yaml
      - uses: kynto-consulting/capsule/actions/vars@v1.0.0
        with:
          token: ${{ secrets.CAPSULE_TOKEN }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ vars.WEB_PROJECT_ID }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          secret: 'true'
          variables: |
            DATABASE_URL=${{ secrets.DATABASE_URL }}
            SENTRY_DSN=${{ secrets.SENTRY_DSN }}
```

## Server requirements

`preview` needs the previews endpoints (`POST/GET/DELETE .../previews`), and the health features need `health` on deployments. When the server answers 404 or 501 the actions fail with a message saying so. Refs `@v1.0.0` are placeholders: use the tag or commit SHA you actually released.
