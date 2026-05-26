'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function DatabasesPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Databases</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">Managed database provisioning</p>
        </div>
      </div>

      {/* Coming soon card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Card className="col-span-full p-8 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-[--radius-lg] bg-[--bg-raised] border border-[--border] flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-light)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
            </svg>
          </div>
          <div className="max-w-sm">
            <h2 className="text-base font-semibold text-[--text-primary]">Databases coming soon</h2>
            <p className="text-sm text-[--text-muted] mt-2 leading-relaxed">
              Capsule will automatically provision and manage databases when you create a project.
              Postgres, Redis, and more — zero configuration required.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Button variant="outline" size="sm" disabled>
              Learn more
            </Button>
            <span className="text-xs text-[--text-muted] px-2 py-0.5 rounded-full border border-[--border] bg-[--bg-raised]">
              In development
            </span>
          </div>
        </Card>
      </div>
    </div>
  )
}
