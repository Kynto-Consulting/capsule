'use client'

import Link from 'next/link'
import { Badge, statusToBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatRelative } from '@/lib/utils'

// Placeholder data until API is wired
const MOCK_PROJECTS = [
  { id: '1', name: 'api-gateway',     slug: 'api-gateway',     status: 'active',   runtime: 'go',     replicas: 2, updated_at: new Date(Date.now() - 3600000 * 2).toISOString() },
  { id: '2', name: 'web-dashboard',   slug: 'web-dashboard',   status: 'building', runtime: 'node',   replicas: 1, updated_at: new Date(Date.now() - 3600000 * 0.5).toISOString() },
  { id: '3', name: 'worker-queue',    slug: 'worker-queue',    status: 'active',   runtime: 'python', replicas: 3, updated_at: new Date(Date.now() - 86400000).toISOString() },
  { id: '4', name: 'ml-inference',    slug: 'ml-inference',    status: 'paused',   runtime: 'python', replicas: 0, updated_at: new Date(Date.now() - 86400000 * 3).toISOString() },
  { id: '5', name: 'email-service',   slug: 'email-service',   status: 'failed',   runtime: 'node',   replicas: 1, updated_at: new Date(Date.now() - 3600000 * 6).toISOString() },
  { id: '6', name: 'cron-scheduler',  slug: 'cron-scheduler',  status: 'active',   runtime: 'go',     replicas: 1, updated_at: new Date(Date.now() - 86400000 * 2).toISOString() },
]

const runtimeColors: Record<string, string> = {
  go:     'bg-[rgba(0,173,216,0.1)] text-[#00add8]',
  node:   'bg-[rgba(104,184,103,0.1)] text-[#68b867]',
  python: 'bg-[rgba(255,212,59,0.1)] text-[#ffd43b]',
  rust:   'bg-[rgba(222,95,57,0.1)] text-[#de5f39]',
}

export default function ProjectsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Projects</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">{MOCK_PROJECTS.length} projects</p>
        </div>
        <Button size="sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New project
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {MOCK_PROJECTS.map((project) => (
          <Link key={project.id} href={`/projects/${project.slug}`}>
            <Card hover className="p-4 h-full flex flex-col gap-3">
              {/* Top row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-[--radius-sm] bg-[--bg-raised] border border-[--border] flex items-center justify-center flex-shrink-0">
                    <ProjectIcon runtime={project.runtime} />
                  </div>
                  <p className="text-sm font-medium text-[--text-primary] truncate">{project.name}</p>
                </div>
                <Badge variant={statusToBadge(project.status)} dot>
                  {project.status}
                </Badge>
              </div>

              {/* Bottom row */}
              <div className="flex items-center justify-between mt-auto pt-2 border-t border-[--border]">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-[4px] ${runtimeColors[project.runtime] ?? 'bg-[--bg-overlay] text-[--text-muted]'}`}>
                  {project.runtime}
                </span>
                <div className="flex items-center gap-3 text-[11px] text-[--text-muted]">
                  <span>{project.replicas}× replica{project.replicas !== 1 ? 's' : ''}</span>
                  <span>{formatRelative(project.updated_at)}</span>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        {/* New project card */}
        <button className="rounded-[--radius-lg] border border-dashed border-[--border] bg-transparent hover:border-[--border-strong] hover:bg-[--bg-surface] transition-all duration-200 p-4 flex flex-col items-center justify-center gap-2 text-[--text-muted] hover:text-[--text-secondary] min-h-[108px] group">
          <div className="w-8 h-8 rounded-[--radius-sm] border border-dashed border-[--border] group-hover:border-[--border-strong] flex items-center justify-center transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </div>
          <span className="text-xs">New project</span>
        </button>
      </div>
    </div>
  )
}

function ProjectIcon({ runtime }: { runtime: string }) {
  const colors: Record<string, string> = { go: '#00add8', node: '#68b867', python: '#ffd43b', rust: '#de5f39' }
  const color = colors[runtime] ?? '#8b8ba7'
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  )
}
