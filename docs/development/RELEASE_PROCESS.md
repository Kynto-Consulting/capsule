# Capsule Release Process

This document details the step-by-step process for preparing, testing, and executing a new release of the **Capsule** platform.

---

## 1. Versioning Strategy

Capsule strictly follows **Semantic Versioning 2.0.0 (SemVer)**:
- **MAJOR** version for incompatible API or database changes (e.g., `v2.0.0`).
- **MINOR** version for backwards-compatible features (e.g., adding a Bedrock model proxy, new CLI flags) (e.g., `v1.1.0`).
- **PATCH** version for backwards-compatible bug fixes (e.g., fixing connection string formats) (e.g., `v1.0.1`).

---

## 2. Release Steps

### Step 1: Verification on Staging
Before tagging a release, the current `main` branch must pass all testing checks on Staging:
- All unit, integration, and CLI tests are passing.
- Uptime checks show green for 48 hours.
- Playwright E2E visual dashboard test suites pass.

### Step 2: Changelog Compilation
Generate the release notes summarizing:
- **New Features** (categorized by module: Dashboard, CLI, Backend).
- **Bug Fixes**.
- **Contributors**.
- **Breaking Changes & Migration Steps** (specifically, if any SQL migrations are destructive).

### Step 3: Git Tagging
Tag the release on the `main` branch. This triggers the GitHub Actions CD compilation:
```bash
git checkout main
git pull origin main
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### Step 4: Verification of Compiled Assets
Once the GitHub Release Workflow completes:
- Verify that compiled CLI binaries for Linux, Darwin (AMD/ARM), and Windows are attached correctly.
- Verify that multi-architecture Docker images are uploaded to the GitHub Container Registry (`ghcr.io`).

### Step 5: Distribution & Announcement
- Update homebrew formulas for macOS developers if applicable.
- Notify the team via Discord/Slack release channels with the changelog.
