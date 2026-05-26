# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | ✅ Yes             |
| < latest | ⚠️ Critical fixes only |

We recommend always running the latest version of Capsule to receive security updates.

---

## Reporting a Vulnerability

**⚠️ Please do NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in Capsule, please report it responsibly:

### Email

Send an email to **security@kynto.dev** with:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Impact assessment** — what could an attacker do?
4. **Affected component** (backend, frontend, CLI, infrastructure)
5. **Suggested fix** (if you have one)

### What to Include

- Type of vulnerability (e.g., SQL injection, XSS, authentication bypass, privilege escalation)
- Full paths and/or URLs of affected source files (if known)
- Proof of concept or exploit code (if applicable)
- Impact and severity assessment

### What to Expect

| Timeline           | Action                                                    |
|--------------------|-----------------------------------------------------------|
| **24 hours**       | Acknowledgment of your report                             |
| **72 hours**       | Initial assessment and severity classification            |
| **7 days**         | Detailed response with remediation plan                   |
| **30 days**        | Fix developed, tested, and released (critical/high)       |
| **90 days**        | Fix developed, tested, and released (medium/low)          |

We will keep you informed of our progress throughout the process.

---

## Disclosure Policy

- We follow **coordinated disclosure** — please allow us reasonable time to fix the issue before publishing
- We will credit you in the release notes (unless you prefer to remain anonymous)
- We will not take legal action against researchers who follow this policy

---

## Scope

### In Scope

- Capsule backend API server
- Capsule web dashboard
- Capsule CLI tool
- Docker images published by Kynto
- Infrastructure configurations in this repository
- Authentication and authorization mechanisms
- Data handling and storage

### Out of Scope

- Third-party services and dependencies (report to the respective maintainers)
- Social engineering attacks
- Denial of Service (DoS) attacks
- Issues in environments not maintained by Kynto
- Vulnerabilities that require physical access to the server

---

## Security Best Practices for Users

1. **Keep Capsule updated** — always run the latest version
2. **Use strong secrets** — generate `CAPSULE_SECRET_KEY` with `openssl rand -hex 32`
3. **Enable TLS** — never run production without HTTPS
4. **Restrict network access** — use security groups / firewalls to limit exposure
5. **Rotate credentials** — periodically rotate database passwords and API keys
6. **Monitor logs** — watch for unusual authentication patterns
7. **Backup regularly** — maintain encrypted backups of your database

---

## Security Features

Capsule includes several built-in security features:

- 🔐 **JWT authentication** with short-lived access tokens and refresh token rotation
- 🛡️ **Rate limiting** per IP and per user
- 🔒 **CORS** configured for specific origins only
- 📝 **Audit logging** for all administrative actions
- 🔑 **Bcrypt** password hashing with configurable cost
- 🚫 **SQL injection protection** via parameterized queries
- 📦 **Distroless Docker images** with minimal attack surface
- 🔄 **Graceful secret rotation** without downtime

---

Thank you for helping keep Capsule and its users safe! 🙏
