'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

export default function RegisterPage() {
  const router = useRouter()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    invite_code: '',
    onboarding_code: ''
  })
  const [onboarding, setOnboarding] = useState<{
    saved: boolean
    secret: string
    qrCodeUri: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  useEffect(() => {
    api.get<{ saved: boolean; secret: string; qr_code_uri: string }>('/api/v1/auth/onboarding/status')
      .then((res) => {
        setOnboarding({
          saved: res.saved,
          secret: res.secret,
          qrCodeUri: res.qr_code_uri
        })
      })
      .catch((err) => console.error('Failed to get onboarding status', err))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (form.onboarding_code.length !== 6) {
      setError('Authenticator code must be exactly 6 digits')
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
    <div className="glass rounded-[--radius-xl] p-8 shadow-[--shadow] max-w-[440px] w-full">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-[--radius-lg] bg-[--accent-dim] border border-[--border-strong] mb-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[--accent-light]">
            <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
            <path d="M12 3v18M3 12h18" strokeOpacity="0.4" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[--text-primary]">
          {onboarding?.saved === false ? 'Master Platform Onboarding' : 'Create your account'}
        </h1>
        <p className="text-sm text-[--text-muted] mt-1">
          {onboarding?.saved === false ? 'Configure master 2FA security to initialize Capsule' : 'Start managing your private cloud workspace'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {onboarding?.saved === false && (
          <div className="flex flex-col items-center bg-[rgba(255,255,255,0.02)] border border-[--border] p-4 rounded-[--radius-lg] text-center mb-2">
            <p className="text-xs text-[--text-primary] font-medium mb-3">Scan this QR in your Google Authenticator app:</p>
            <img 
              src={`https://chart.googleapis.com/chart?chs=160x160&cht=qr&chl=${encodeURIComponent(onboarding.qrCodeUri)}&choe=UTF-8`} 
              alt="Google 2FA Onboarding QR Code" 
              className="w-[160px] h-[160px] rounded-[--radius-md] border border-[--border] p-1 bg-[--bg-surface] mb-3"
            />
            <p className="text-[10px] text-[--text-muted]">
              Can't scan? Key: <code className="text-[--accent-light] font-mono select-all bg-[--bg-surface] px-1.5 py-0.5 rounded">{onboarding.secret}</code>
            </p>
          </div>
        )}

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
        <Input
          label="Invite Code"
          type="text"
          placeholder="Optional registration invite code"
          value={form.invite_code}
          onChange={set('invite_code')}
        />
        <Input
          label={onboarding?.saved === false ? 'Master Verification Code' : 'Global Onboarding 2FA Code'}
          type="text"
          placeholder="6-digit TOTP code"
          value={form.onboarding_code}
          onChange={set('onboarding_code')}
          maxLength={6}
          required
        />

        {error && (
          <p className="text-xs text-[--error] bg-[--error-dim] border border-[rgba(239,68,68,0.2)] rounded-[--radius-sm] px-3 py-2">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" loading={loading} className="w-full mt-2">
          {onboarding?.saved === false ? 'Complete Onboarding & Create Admin' : 'Create account'}
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
