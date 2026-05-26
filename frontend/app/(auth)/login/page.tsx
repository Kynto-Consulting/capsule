'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export default function LoginPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post<{
        user: { id: string; email: string; name: string; role: string }
        tokens: { access_token: string; refresh_token: string }
      }>('/api/v1/auth/login', { email, password })
      setAuth(res.user, res.tokens.access_token, res.tokens.refresh_token)
      router.push('/projects')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass rounded-[--radius-xl] p-8 shadow-[--shadow]">
      {/* Brand */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-[--radius-lg] bg-[--accent-dim] border border-[--border-strong] mb-4">
          <CapsuleIcon />
        </div>
        <h1 className="text-xl font-semibold text-[--text-primary]">Welcome back</h1>
        <p className="text-sm text-[--text-muted] mt-1">Sign in to your Capsule workspace</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {error && (
          <p className="text-xs text-[--error] bg-[--error-dim] border border-[rgba(239,68,68,0.2)] rounded-[--radius-sm] px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-[--text-muted] mt-6">
        No account?{' '}
        <Link href="/register" className="text-[--accent-light] hover:text-[--text-accent] transition-colors">
          Create one
        </Link>
      </p>
    </div>
  )
}

function CapsuleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[--accent-light]">
      <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M12 3v18M3 12h18" strokeOpacity="0.4" />
    </svg>
  )
}
