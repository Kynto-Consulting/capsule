# Contributing to Capsule

Thank you for your interest in contributing to Capsule! 🎉 This guide will help you get started.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Branching Strategy](#branching-strategy)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)

---

## Code of Conduct

This project adheres to a Code of Conduct. By participating, you are expected to uphold a respectful and inclusive environment for everyone.

---

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/capsule.git
   cd capsule
   ```
3. **Add upstream** remote:
   ```bash
   git remote add upstream https://github.com/Kynto/capsule.git
   ```
4. **Install dependencies** and verify the setup:
   ```bash
   make dev
   make test
   ```

---

## Development Setup

### Prerequisites

| Tool    | Version | Installation                          |
|---------|---------|---------------------------------------|
| Go      | 1.22+   | [go.dev/dl](https://go.dev/dl/)       |
| Node.js | 20+     | [nodejs.org](https://nodejs.org/)     |
| pnpm    | 9+      | `npm install -g pnpm`                |
| Docker  | 24+     | [docker.com](https://www.docker.com/) |
| Make    | 3.81+   | Usually pre-installed                 |
| golangci-lint | latest | [golangci-lint.run](https://golangci-lint.run/) |

### Setup Steps

```bash
# 1. Start infrastructure dependencies
docker compose up -d postgres redis

# 2. Run database migrations
cd backend && go run ./cmd/server migrate up

# 3. Start the backend (terminal 1)
cd backend && go run ./cmd/server

# 4. Start the frontend (terminal 2)
cd frontend && pnpm install && pnpm dev

# 5. Build the CLI (terminal 3)
cd cli && go build -o ../bin/capsule ./cmd/capsule
```

### Verify Everything Works

```bash
make test    # All tests should pass
make lint    # No lint errors
```

---

## Branching Strategy

We use a **trunk-based** development model with short-lived feature branches.

```
main (protected)
 ├── feat/add-deployment-history
 ├── fix/env-creation-error
 ├── docs/update-api-reference
 └── chore/upgrade-go-version
```

### Branch Naming

| Prefix    | Purpose                      | Example                          |
|-----------|------------------------------|----------------------------------|
| `feat/`   | New features                 | `feat/team-management`           |
| `fix/`    | Bug fixes                    | `fix/auth-token-refresh`         |
| `docs/`   | Documentation changes        | `docs/api-endpoints`             |
| `chore/`  | Maintenance, deps, CI        | `chore/upgrade-dependencies`     |
| `refactor/` | Code refactoring           | `refactor/service-layer`         |
| `test/`   | Adding or fixing tests       | `test/env-handler-coverage`      |

### Rules

- Branch from `main`, merge back to `main`
- Keep branches short-lived (< 1 week)
- Rebase on `main` before opening a PR
- Delete the branch after merging

---

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                                |
|------------|--------------------------------------------|
| `feat`     | New feature                                |
| `fix`      | Bug fix                                    |
| `docs`     | Documentation only                         |
| `style`    | Formatting, no code change                 |
| `refactor` | Code change that neither fixes nor adds    |
| `perf`     | Performance improvement                    |
| `test`     | Adding or correcting tests                 |
| `chore`    | Build process, CI, dependencies            |
| `ci`       | CI configuration changes                   |
| `revert`   | Revert a previous commit                   |

### Scopes

| Scope      | Component                |
|------------|--------------------------|
| `backend`  | Go API server            |
| `frontend` | Next.js dashboard        |
| `cli`      | CLI tool                 |
| `infra`    | Infrastructure, Docker   |
| `docs`     | Documentation            |
| `deps`     | Dependency updates       |

### Examples

```bash
feat(backend): add environment cloning endpoint
fix(cli): handle expired tokens gracefully
docs(frontend): add component storybook examples
chore(deps): bump Go to 1.22.4
test(backend): add integration tests for auth middleware
```

### Breaking Changes

Append `!` after the type/scope, and include a `BREAKING CHANGE:` footer:

```
feat(backend)!: change environment API response format

BREAKING CHANGE: The `config` field is now a nested object instead of a string.
```

---

## Pull Request Process

1. **Ensure your branch is up to date:**
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run the full test and lint suite:**
   ```bash
   make test
   make lint
   ```

3. **Push your branch and create a PR** targeting `main`

4. **Fill out the PR template** completely:
   - Link to related issue(s)
   - Describe what changed and why
   - Include screenshots for UI changes
   - Note any migration or deployment steps

5. **Wait for CI to pass** — all checks must be green

6. **Request a review** from at least one code owner

7. **Address review feedback** promptly

8. **Squash and merge** — the PR title becomes the commit message, so follow Conventional Commits format

### PR Checklist

- [ ] Code follows the project's style guidelines
- [ ] Self-reviewed the diff
- [ ] Added/updated tests
- [ ] Updated documentation if needed
- [ ] No new linting warnings
- [ ] CI passes

---

## Coding Standards

### Go (Backend & CLI)

- Follow [Effective Go](https://go.dev/doc/effective_go)
- Wrap errors with context: `fmt.Errorf("doing X: %w", err)`
- Table-driven tests with `testify`
- Structured logging with `slog`
- Must pass `golangci-lint`

### TypeScript (Frontend)

- Strict TypeScript — no `any`
- Functional components with hooks
- Server Components by default
- Tailwind CSS utility classes
- Test with React Testing Library

### General

- Keep functions small and focused
- Document exported APIs
- Don't commit secrets or `.env` files
- Write meaningful test names

---

## Reporting Bugs

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md) to file a new issue. Include:

- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, versions)
- Logs or screenshots

---

## Requesting Features

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md). Include:

- Problem statement
- Proposed solution
- Alternatives considered

---

## Questions?

- Open a [Discussion](https://github.com/Kynto/capsule/discussions) for general questions
- Check existing issues and PRs before creating new ones

Thank you for contributing! 🚀
