# Capsule Deploy action

Deploys a project to Capsule from GitHub Actions. It installs `@kyntocg/capsule-cli` and runs `capsule deploy` in CI mode: plain output, a non-zero exit code on failure, the final URL printed and exposed as an output, a summary on the run page, and the commit, ref, actor, run URL and PR number recorded in the deployment metadata.

## Setup

1. Create a token that can only deploy one project:

   ```bash
   capsule tokens create --name github-ci --scope deploy --project <project-id>
   ```

2. Store it and the IDs in the repository (Settings > Secrets and variables > Actions):

   | Kind | Name | Value |
   |------|------|-------|
   | secret | `CAPSULE_TOKEN` | the `cap_...` token |
   | secret | `CAPSULE_ORG_ID` | organization ID |
   | secret | `CAPSULE_PROJECT_ID` | project ID |
   | variable | `CAPSULE_API_URL` | your Capsule API URL |

   `capsule ci init --set-secrets` does steps 1 and 2 for you (needs `gh`).

Or generate the whole workflow: `capsule ci init`.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `token` | yes | | Capsule API token (`cap_...`) |
| `org-id` | yes | | Organization ID |
| `project-id` | yes | | Project ID |
| `api-url` | yes | | Capsule API URL |
| `env` | no | | Deploy-only variables, one `KEY=VALUE` per line |
| `timeout` | no | `10m` | Max time to wait for the deployment |
| `working-directory` | no | `.` | Directory to deploy (monorepos) |
| `version` | no | `latest` | `@kyntocg/capsule-cli` version to install; pin it for reproducible builds |
| `cli-package` | no | – | Full npm install spec (tarball URL, workspace path, git URL) that overrides `version`; use it while the CLI is not on npm |
| `apps-domain` | no | | Apps domain used to build the URL when the API does not return one |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | Public URL of the app (empty if it could not be determined) |
| `deployment-id` | Capsule deployment ID |

## Variables and precedence

A deployment sees three layers, highest first:

1. Deploy variables: the `env` input (or `capsule deploy --env`), only for that deployment.
2. Project variables: `capsule env set KEY=VALUE`.
3. Account variables: `capsule vars set KEY=VALUE`, shared by all projects of the organization.

## Examples

### CI then CD

```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run build

  deploy:
    needs: ci
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    concurrency: { group: capsule-deploy, cancel-in-progress: false }
    steps:
      - uses: actions/checkout@v4
      - id: capsule
        uses: kynto-consulting/capsule/actions/deploy@main
        with:
          token: ${{ secrets.CAPSULE_TOKEN }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ secrets.CAPSULE_PROJECT_ID }}
          api-url: ${{ vars.CAPSULE_API_URL }}
      - run: echo "Live at ${{ steps.capsule.outputs.url }}"
```

### Account variables and deploy-only variables

Account variables are managed outside the workflow:

```bash
capsule vars set --org <org-id> SENTRY_DSN=https://... --secret
capsule vars set --org <org-id> REGION=us-east-1 --scope both
capsule vars list --org <org-id>
```

Deploy-only overrides go in `env` and beat project and account values for that deployment:

```yaml
      - uses: kynto-consulting/capsule/actions/deploy@main
        with:
          token: ${{ secrets.CAPSULE_TOKEN }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ secrets.CAPSULE_PROJECT_ID }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          env: |
            PUBLIC_API_URL=${{ vars.PUBLIC_API_URL }}
            RELEASE=${{ github.sha }}
            FEATURE_FLAGS=${{ secrets.FEATURE_FLAGS }}
```

### Monorepo

Deploy each app to its own Capsule project, only when its folder changes:

```yaml
on:
  push:
    branches: [main]
    paths: ['apps/web/**', 'apps/api/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app:
          - { dir: apps/web, project: WEB_PROJECT_ID }
          - { dir: apps/api, project: API_PROJECT_ID }
    steps:
      - uses: actions/checkout@v4
      - uses: kynto-consulting/capsule/actions/deploy@main
        with:
          token: ${{ secrets.CAPSULE_TOKEN }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ vars[matrix.app.project] }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          working-directory: ${{ matrix.app.dir }}
```

A `deploy`-scoped token is limited to one project, so a matrix over several projects needs one token per project, or a full-access token. `capsule ci init --working-directory apps/web` generates the workflow for one app.

### Pull request previews

Capsule has no per-PR ephemeral environments. The generated workflow deploys PRs to a separate, long-lived preview project when the `CAPSULE_PREVIEW_PROJECT_ID` variable is set, and skips the job otherwise (also for PRs from forks, which cannot read secrets). Concurrent PRs overwrite each other on that project.

### Rollback

Re-deploy the previous successful deployment from a manual workflow:

```yaml
name: Rollback
on: workflow_dispatch

jobs:
  rollback:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install --global @kyntocg/capsule-cli
      - run: capsule deployments rollback
        env:
          CAPSULE_TOKEN: ${{ secrets.CAPSULE_TOKEN }}
          CAPSULE_ORG_ID: ${{ secrets.CAPSULE_ORG_ID }}
          CAPSULE_PROJECT_ID: ${{ secrets.CAPSULE_PROJECT_ID }}
          CAPSULE_API_URL: ${{ vars.CAPSULE_API_URL }}
```

Whether a `deploy`-scoped token may call rollback depends on the server's scope rules; use a full-access token for this workflow if it is rejected.

### Reusable workflow

`actions/.github/workflows/capsule-deploy.yml` wraps checkout and this action behind `workflow_call`. GitHub only resolves reusable workflows from the root `.github/workflows/` of a repository, so copy it there before calling it:

```yaml
jobs:
  deploy:
    uses: your-org/your-repo/.github/workflows/capsule-deploy.yml@main
    with:
      org-id: ${{ vars.CAPSULE_ORG_ID }}
      project-id: ${{ vars.CAPSULE_PROJECT_ID }}
      api-url: ${{ vars.CAPSULE_API_URL }}
    secrets:
      CAPSULE_TOKEN: ${{ secrets.CAPSULE_TOKEN }}
```

## Notes

- The action does not link the project or write `.capsule.json`; it sends no build strategy unless a `.capsule.json` is committed in the deployed directory.
- Hidden directories (such as `.github`), `node_modules`, `vendor` and `.gitignore` matches are not uploaded.
- Fork PRs have no secrets; the deploy and preview jobs must not run for them.
