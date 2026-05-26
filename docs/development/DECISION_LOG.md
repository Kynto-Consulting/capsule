# Architectural Decision Records (ADR) Log

This document records the critical architectural decisions made for the **Capsule** platform, documenting the context, decisions, and consequences.

---

## ADR-001: Use Go for API Backend & CLI

### Status
Accepted

### Context
Capsule requires an extremely fast, resource-efficient backend with small memory footprint for self-hosting. It also needs a single-executable CLI binary that developers can easily download and execute without external runtime requirements (like Node.js, Python, or Ruby).

### Decision
Use **Go (Golang)** as the primary language for both the API Backend and the command-line interface (CLI).

### Consequences
- **Pros**:
  - Tiny runtime memory footprint (~20MB for backend).
  - Native cross-compilation out of the box (Linux, Darwin, Windows).
  - Excellent concurrency handling via goroutines for streaming logs and WebSockets.
  - Highly robust official AWS SDK v2.
- **Cons**:
  - Harder to write highly dynamic middleware compared to Node.js.
  - Less visual data parsing out of the box (requires structured struct mapping).

---

## ADR-002: Next.js App Router for Dashboard Visuals

### Status
Accepted

### Context
Developers expect a modern, beautiful, and highly dynamic dashboard interface. Next.js is the market leader for building developer consoles.

### Decision
Use **Next.js 14+ with App Router, Tailwind CSS, and Shadcn/UI** as the web dashboard framework.

### Consequences
- **Pros**:
  - React components allow highly dynamic elements (terminal views, real-time charts).
  - Fast page transition and Server-Side Rendering (SSR) for fast loading times.
  - Seamless environment configuration and API routing.
- **Cons**:
  - Next.js has a heavy production build compared to raw static HTML.

---

## ADR-003: Use Traefik as the Core Reverse Proxy

### Status
Accepted

### Context
Capsule dynamically provisions domains, subdomains, and ports for deployments and apps. It must request and renew Let's Encrypt SSL certificates automatically when a user binds a domain.

### Decision
Embed **Traefik** as the reverse proxy inside the core Capsule instance. Traefik communicates directly with the Docker daemon API to hot-reload routes and auto-provision TLS certificates.

### Consequences
- **Pros**:
  - Auto-discovery of routes via Docker container labels.
  - Native, seamless Let's Encrypt integration out of the box.
  - Zero-downtime hot reloading of configurations.
- **Cons**:
  - More complex to configure than static Nginx servers.

---

## ADR-004: Direct AWS SDK Integration (vs Terraform Provider)

### Status
Accepted

### Context
Capsule provisions AWS resources (EC2, Lambda, ECR, Route53, Bedrock) on the fly via the user's IAM sub-profile credentials. We considered invoking Terraform binaries under the hood, but managing local Terraform state files and processes inside dynamic API endpoints is highly error-prone.

### Decision
Use the **official AWS SDK for Go (v2)** to make direct API calls to AWS services, maintaining the state of resources in the Capsule PostgreSQL metadata database.

### Consequences
- **Pros**:
  - Extreme speed: API calls are direct HTTP requests.
  - Robust error handling: capture exact AWS errors natively in Go.
  - Zero third-party binary requirements (no need to install Terraform on the host).
- **Cons**:
  - Capsule must manually manage rollback logic for failed resource creations.
  - Schema/architecture changes require modifying Go orchestration code instead of simple HCL modifications.
