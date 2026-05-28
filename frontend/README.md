# Capsule Frontend

The Capsule web dashboard — built with Next.js 16, TypeScript, Tailwind CSS, and shadcn/ui.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, standalone output) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 |
| Components | shadcn/ui + lucide-react |
| Server state | TanStack React Query 5 |
| Client state | Zustand 5 |
| Testing | Vitest + @vitejs/plugin-react |

---

## Prerequisites

- **Node.js** 18+
- **pnpm** (the lockfile is pnpm-format — do not use npm or yarn)

---

## Local Setup

1. Install dependencies:
   ```bash
   cd frontend
   pnpm install
   ```

2. Create your local environment file:
   ```bash
   cp .env.example .env.local
   ```

3. Start the development server:
   ```bash
   pnpm dev
   ```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Environment Variables

| Variable | Example | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8080` | Capsule backend API base URL |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8080` | WebSocket URL for real-time events |
| `NEXT_PUBLIC_APP_DOMAIN` | `apps.capsule.dev` | Base domain for deployed app subdomains |
| `BACKEND_INTERNAL_URL` | `http://capsule-backend:8080` | Internal backend URL used by Next.js rewrites (build-time, not public) |

`NEXT_PUBLIC_*` variables are embedded at build time. For a production image, pass them as build arguments so the correct API host is baked in.

---

## Project Structure

```
frontend/
├── app/                    # Next.js App Router pages and layouts
│   ├── (auth)/             # Auth routes (login, register)
│   ├── (dashboard)/        # Dashboard routes (protected)
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Root redirect
├── components/
│   ├── layout/             # Shell, nav, sidebar components
│   ├── ui/                 # shadcn/ui primitives
│   └── providers.tsx       # React Query + Zustand providers
├── lib/
│   ├── api.ts              # Typed API client (fetch wrapper)
│   ├── types.ts            # Shared TypeScript types
│   └── utils.ts            # Utility helpers (cn, formatters)
├── stores/
│   └── auth.ts             # Zustand auth store (token, user)
└── next.config.ts          # Next.js config (rewrites, standalone output)
```

---

## Key Patterns

**Server vs Client Components** — Pages and layouts are React Server Components by default. Add `'use client'` only when a component needs browser APIs, event handlers, or client-side hooks. Keep data-fetching in Server Components where possible.

**React Query for server state** — All API calls that need caching, refetching, or loading states go through `@tanstack/react-query`. Queries are defined close to the components that use them.

**Zustand for client state** — Session-level state (auth tokens, user identity) lives in Zustand stores under `stores/`. Do not use Zustand for data that is fetched from the server.

**Proxy rewrites** — `next.config.ts` rewrites `*.apps.<domain>/*` traffic to the backend `/_proxy/<subdomain>/` route before any route matching, so subdomain app traffic is never handled by Next.js pages.

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server (hot reload) |
| `pnpm build` | Production build (output: `.next/`) |
| `pnpm start` | Serve the production build locally |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Run TypeScript compiler check (no emit) |
| `pnpm test` | Run Vitest unit tests |

Or from the repo root: `make build-frontend`, `make test-frontend`, `make lint-frontend`.
