# Frontend Prompt — Next.js Dashboard Development

You are working on the **Capsule frontend**, a Next.js 14 web dashboard using the App Router.

---

## Stack

- **Next.js 14** with App Router
- **TypeScript** (strict mode)
- **Tailwind CSS** for styling
- **shadcn/ui** for component primitives
- **Zustand** for client-side state management
- **TanStack Query (React Query)** for server state and data fetching
- **React Hook Form + Zod** for form handling and validation
- **Axios** or `fetch` for API calls
- **Playwright** for E2E testing
- **Vitest** + React Testing Library for unit/component testing

---

## Directory Structure

```
frontend/
├── app/                    # App Router pages and layouts
│   ├── layout.tsx          # Root layout (providers, nav)
│   ├── page.tsx            # Landing / dashboard page
│   ├── (auth)/             # Auth route group
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (dashboard)/        # Authenticated route group
│   │   ├── layout.tsx      # Dashboard layout (sidebar, topbar)
│   │   ├── environments/
│   │   ├── deployments/
│   │   ├── settings/
│   │   └── team/
│   └── api/                # API routes (if needed for BFF)
├── components/
│   ├── ui/                 # shadcn/ui primitives (Button, Card, etc.)
│   ├── layout/             # Sidebar, Topbar, Footer
│   ├── environments/       # Feature-specific components
│   ├── deployments/
│   └── shared/             # DataTable, StatusBadge, LoadingSpinner
├── lib/
│   ├── api/                # API client, endpoint definitions
│   ├── hooks/              # Custom React hooks
│   ├── utils/              # Helper functions (cn, formatDate)
│   └── validations/        # Zod schemas
├── stores/                 # Zustand state stores
├── types/                  # TypeScript type definitions
├── e2e/                    # Playwright E2E tests
└── public/                 # Static assets
```

---

## Component Patterns

### Server Component (Default)

```tsx
// app/(dashboard)/environments/page.tsx
import { getEnvironments } from '@/lib/api/environments'
import { EnvironmentList } from '@/components/environments/EnvironmentList'

export default async function EnvironmentsPage() {
  const environments = await getEnvironments()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Environments</h1>
        <CreateEnvironmentButton />
      </div>
      <EnvironmentList environments={environments} />
    </div>
  )
}
```

### Client Component

```tsx
// components/environments/CreateEnvironmentButton.tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CreateEnvironmentDialog } from './CreateEnvironmentDialog'

export function CreateEnvironmentButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Create Environment
      </Button>
      <CreateEnvironmentDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
```

### Form Component (React Hook Form + Zod)

```tsx
'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createEnvironmentSchema, type CreateEnvironmentInput } from '@/lib/validations/environment'

export function CreateEnvironmentForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<CreateEnvironmentInput>({
    resolver: zodResolver(createEnvironmentSchema),
    defaultValues: { name: '', description: '' },
  })

  const mutation = useCreateEnvironment()

  const onSubmit = (data: CreateEnvironmentInput) => {
    mutation.mutate(data, { onSuccess })
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {/* Form fields */}
    </form>
  )
}
```

---

## State Management

### Server State (TanStack Query)

```tsx
// lib/hooks/useEnvironments.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api/client'

export function useEnvironments() {
  return useQuery({
    queryKey: ['environments'],
    queryFn: () => api.get('/api/v1/environments').then(r => r.data),
  })
}

export function useCreateEnvironment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateEnvironmentInput) =>
      api.post('/api/v1/environments', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })
}
```

### Client State (Zustand)

```tsx
// stores/useUIStore.ts
import { create } from 'zustand'

interface UIStore {
  sidebarOpen: boolean
  toggleSidebar: () => void
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: UIStore['theme']) => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  theme: 'system',
  setTheme: (theme) => set({ theme }),
}))
```

---

## API Integration

### API Client Setup

```tsx
// lib/api/client.ts
import axios from 'axios'

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token
api.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 → refresh token
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await refreshToken()
      return api(error.config)
    }
    return Promise.reject(error)
  }
)
```

---

## Styling Guidelines

1. **Use Tailwind utility classes** — no custom CSS unless absolutely necessary
2. **Use `cn()` helper** for conditional classes:
   ```tsx
   import { cn } from '@/lib/utils'
   <div className={cn('rounded-lg p-4', isActive && 'bg-primary text-white')} />
   ```
3. **shadcn/ui components** are the building blocks — customize via Tailwind, not overrides
4. **Responsive design:** mobile-first with `sm:`, `md:`, `lg:` breakpoints
5. **Dark mode:** Use `dark:` variant classes; theme switching via `next-themes`
6. **Spacing:** Use consistent spacing scale (4, 6, 8, 12, 16, 24)

---

## Testing Checklist

- [ ] Unit test utility functions and hooks
- [ ] Component tests with React Testing Library (user-centric queries)
- [ ] Mock API calls with MSW (Mock Service Worker)
- [ ] E2E tests for critical flows (login, create environment, deploy)
- [ ] Accessibility: test with `axe-core` via `@axe-core/react`
- [ ] Visual regression tests for design-system components (optional)
