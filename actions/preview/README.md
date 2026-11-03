# Capsule Preview action

Creates or updates an ephemeral Capsule project `<slug>-pr-<n>` for a pull request, publishes ONE comment with the URL (updated on each push, found by a hidden marker), and removes the preview when the PR is closed.

## How it works

- `action: deploy` runs `capsule previews create --pr <n> --ref <ref> --sha <sha>`. If the installed CLI has no `previews` command it calls `POST /api/v1/orgs/{o}/projects/{p}/previews` with curl instead (response validated, token passed via stdin, never printed). It then reads the state back from `GET .../previews` and waits until the preview is terminal.
- `action: destroy` runs `capsule previews delete --pr <n>` (or `DELETE .../previews/{n}` as fallback). A 404 is treated as already removed.
- The SHA is the PR head SHA (not the merge commit). PRs from forks are skipped with a notice (no secrets there).
- The token needs scope `deploy` on the PARENT project.
- 401/403/404/501 from the server give explicit messages (wrong token, scope, missing feature or IDs).

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `token` | required | Capsule token (`deploy` scope on the parent project) |
| `org-id`, `project-id`, `api-url` | required | Parent project coordinates |
| `action` | `deploy` | `deploy` or `destroy` |
| `comment` | `true` | Publish/update the single PR comment |
| `git-token` | `github.token` | Token for the comment API |
| `provider` | `auto` | `auto`, `github`, `forgejo` |
| `pr-number`, `ref`, `sha` | from event | Overrides |
| `timeout` | `10m` | Wait for the preview |
| `version`, `cli-package` | `latest`, | CLI install |

Outputs: `url`, `status` (`success`, `failed`, `skipped`, `destroyed`, ...).

## Provider detection and permissions

- Forgejo/Gitea when `GITEA_ACTIONS=true`, or a `GITHUB_SERVER_URL` other than github.com whose API URL looks like `/api/v1`; otherwise GitHub. Force it with `provider`.
- GitHub: `GITHUB_TOKEN` with `pull-requests: write` (and `contents: read`). Nothing else.
- Forgejo/Gitea: `Authorization: token ...` against `<server>/api/v1`; use the job token or a `FORGEJO_TOKEN`/`GITEA_TOKEN` secret with issue write access, passed as `git-token`.
- A comment failure only produces a warning; it never fails the deployment.

## Example (GitHub)

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: read

jobs:
  preview:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: kynto-consulting/capsule/actions/preview@v1.0.0
        with:
          token: ${{ secrets.CAPSULE_TOKEN }}
          org-id: ${{ secrets.CAPSULE_ORG_ID }}
          project-id: ${{ secrets.CAPSULE_PROJECT_ID }}
          api-url: ${{ vars.CAPSULE_API_URL }}
          action: ${{ github.event.action == 'closed' && 'destroy' || 'deploy' }}
```

See `../templates/` for full workflows (including Forgejo).
