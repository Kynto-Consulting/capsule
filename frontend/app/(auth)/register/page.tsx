'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{
        user: { id: string; email: string; name: string; role: string }
        tokens: { access_token: string; refresh_token: string }
      }>('/api/v1/auth/register', form)
      setAuth(res.user, res.tokens.access_token, res.tokens.refresh_token)
      router.push('/projects')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass rounded-[--radius-xl] p-8 shadow-[--shadow]">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-[--radius-lg] bg-[--accent-dim] border border-[--border-strong] mb-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[--accent-light]">
            <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
            <path d="M12 3v18M3 12h18" strokeOpacity="0.4" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[--text-primary]">Create your account</h1>
        <p className="text-sm text-[--text-muted] mt-1">Start managing your infrastructure</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          type="text"
          placeholder="Jane Smith"
          value={form.name}
          onChange={set('name')}
          autoComplete="name"
          required
        />
        <Input
          label="Email"
          type="email"
          placeholder="you@example.com"
          value={form.email}
          onChange={set('email')}
          autoComplete="email"
          required
        />
        <Input
          label="Password"
          type="password"
          placeholder="Min. 8 characters"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          required
        />

        {error && (
          <p className="text-xs text-[--error] bg-[--error-dim] border border-[rgba(239,68,68,0.2)] rounded-[--radius-sm] px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-[--text-muted] mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-[--accent-light] hover:text-[--text-accent] transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  )
}
