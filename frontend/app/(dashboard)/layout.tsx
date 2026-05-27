'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Sidebar } from '@/components/layout/sidebar'
import { useAuthStore } from '@/stores/auth'
import { PageSpinner } from '@/components/ui/spinner'
import { RefreshSetup } from '@/components/refresh-setup'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { accessToken } = useAuthStore()
  const [hydrated, setHydrated] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login')
  }, [hydrated, accessToken, router])

  if (!hydrated) return <PageSpinner />
  if (!accessToken) return null

  return (
    <div className="flex h-full">
      <RefreshSetup />

      {/* Desktop sidebar — hidden on mobile, always visible on md+ */}
      <div className="hidden md:flex h-full">
        <Sidebar isMobileOpen={false} onMobileClose={() => {}} />
      </div>

      {/* Mobile sidebar overlay */}
      <div className="md:hidden">
        <Sidebar isMobileOpen={isMobileOpen} onMobileClose={() => setIsMobileOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <header
          className="flex items-center h-14 px-4 md:hidden flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: 'var(--bg-subtle)' }}
        >
          <button
            onClick={() => setIsMobileOpen(true)}
            className="text-[--text-muted] hover:text-[--text-secondary] transition-colors p-1 rounded"
            aria-label="Open menu"
          >
            {/* Hamburger icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Image src="/logo.png" alt="Capsule" width={22} height={22} className="ml-3 rounded flex-shrink-0" />
          <span className="ml-2 text-sm font-semibold text-[--text-primary] tracking-tight">Capsule</span>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
