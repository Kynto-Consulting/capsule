'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useAuthStore } from '@/stores/auth'

const features = [
  {
    icon: '⚡',
    title: 'One-click deploys',
    desc: 'Push code, Capsule builds and deploys to AWS automatically. No YAML wrangling.',
  },
  {
    icon: '🗄️',
    title: 'Managed databases',
    desc: 'PostgreSQL databases provisioned in seconds, no configuration required.',
  },
  {
    icon: '🌐',
    title: 'Custom domains',
    desc: 'Automated SSL, DNS routing, and domain verification built in.',
  },
  {
    icon: '⚙️',
    title: 'Lambda functions',
    desc: 'Deploy serverless functions without managing infrastructure.',
  },
  {
    icon: '🪣',
    title: 'S3 storage',
    desc: 'Built-in object storage with per-project buckets, ready instantly.',
  },
  {
    icon: '✉️',
    title: 'Email sending',
    desc: 'AWS SES integration with SMTP credentials, bounce tracking included.',
  },
]

export default function LandingPage() {
  const router = useRouter()
  const accessToken = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (accessToken) router.replace('/projects')
  }, [accessToken, router])

  return (
    <div
      className="relative min-h-screen bg-[--bg-base] text-[--text-primary] overflow-x-hidden"
      style={{ fontFamily: 'var(--font-sans, sans-serif)' }}
    >
      {/* Ambient glow blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -top-40 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)', filter: 'blur(80px)' }}
        />
        <div
          className="absolute top-1/2 -left-40 w-[400px] h-[400px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #4f46e5 0%, transparent 70%)', filter: 'blur(60px)' }}
        />
        <div
          className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)', filter: 'blur(80px)' }}
        />
      </div>

      {/* Nav */}
      <nav
        className="relative z-20 flex items-center justify-between px-6 py-4 max-w-6xl mx-auto"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-8">
          <Image src="/logo.png" alt="Capsule" width={28} height={28} className="rounded-md flex-shrink-0" priority />
          <span className="font-bold text-lg tracking-tight text-[--text-primary]">Capsule</span>
          <div className="hidden md:flex items-center gap-6 text-sm text-[--text-secondary]">
            <a href="#features" className="hover:text-[--text-primary] transition-colors">Features</a>
            <a href="#" className="hover:text-[--text-primary] transition-colors">Pricing</a>
            <a href="#" className="hover:text-[--text-primary] transition-colors">Docs</a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm px-4 py-1.5 rounded-[--radius] text-[--text-secondary] hover:text-[--text-primary] transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm px-4 py-1.5 rounded-[--radius] font-medium text-white transition-colors"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-20 max-w-4xl mx-auto animate-fade-up">
        <div
          className="mb-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium"
          style={{ background: 'var(--accent-dim)', color: 'var(--accent-light)', border: '1px solid var(--accent-glow)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[--accent-light] animate-pulse-dot" />
          Now in beta
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 text-gradient leading-tight">
          Deploy with confidence.
        </h1>
        <p className="text-lg md:text-xl text-[--text-secondary] max-w-2xl mb-10 leading-relaxed">
          Capsule gives your team a unified cloud control plane — provision databases, deploy apps,
          manage domains, and monitor everything from one place.
        </p>
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <Link
            href="/register"
            className="px-6 py-2.5 rounded-[--radius] font-semibold text-white text-sm transition-colors"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          >
            Get started free
          </Link>
          <Link
            href="/login"
            className="px-6 py-2.5 rounded-[--radius] font-semibold text-sm text-[--text-secondary] hover:text-[--text-primary] transition-colors"
            style={{ border: '1px solid var(--border-strong)' }}
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 px-6 py-16 max-w-6xl mx-auto">
        <h2 className="text-center text-2xl font-bold mb-2 text-[--text-primary]">Everything you need</h2>
        <p className="text-center text-[--text-secondary] mb-12 text-sm">
          Stop stitching together cloud primitives. Capsule handles the plumbing.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-[--radius-lg] p-6"
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
            >
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-[--text-primary] mb-1.5">{f.title}</h3>
              <p className="text-sm text-[--text-secondary] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        className="relative z-10 px-6 py-8 max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-[--text-secondary]"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <span>© 2025 Capsule</span>
        <div className="flex items-center gap-5">
          <a href="#" className="hover:text-[--text-primary] transition-colors">Privacy</a>
          <a href="#" className="hover:text-[--text-primary] transition-colors">Terms</a>
          <a href="#" className="hover:text-[--text-primary] transition-colors">Docs</a>
        </div>
      </footer>
    </div>
  )
}
