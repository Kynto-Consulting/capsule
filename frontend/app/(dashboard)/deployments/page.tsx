'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { PageSpinner } from '@/components/ui/spinner'
import { formatRelative } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'
import type { Deployment, ListResponse, Project } from '@/lib/types'

function listDeployments(token: string, orgId: string, projectId: string) {
  return api.get<ListResponse<Deployment>>(
    `/api/v1/orgs/${orgId}/projects/${projectId}/deployments`,
    token
  )
}

type StatusColor = {
  dot: string
  label: string
}

function statusColor(status: string): StatusColor {
  const map: Record<string, StatusColor> = {
    queued:    { dot: 'bg-[--text-muted]', label: 'text-[--text-muted]' },
    building:  { dot: 'bg-yellow-400',     label: 'text-yellow-400' },
    deploying: { dot: 'bg-blue-400',       label: 'text-blue-400' },
    success:   { dot: 'bg-green-400',      label: 'text-green-400' },
    failed:    { dot: 'bg-red-400',        label: 'text-red-400' },
    cancelled: { dot: 'bg-[--text-muted]', label: 'text-[--text-muted]' },
  }
  return map[status] ?? { dot: 'bg-[--text-muted]', label: 'text-[--text-muted]' }
}

interface FlatDeployment extends Deployment {
  projectName: string
  projectSlug: string
  orgId: string
}

export default function DeploymentsPage() {
  const { accessToken } = useAuthStore()
  const token = accessToken!

  // Step 1: fetch orgs
  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })
  const orgs = orgsRes?.data ?? []

  // Step 2: fetch projects for each org
  const projectQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['projects', org.id],
      queryFn: () => listProjects(token, org.id),
      enabled: orgs.length > 0,
    })),
  })

  const allProjects: (Project & { orgId: string })[] = projectQueries.flatMap((q, i) =>
    (q.data?.data ?? []).map((p) => ({ ...p, orgId: orgs[i]?.id ?? '' }))
  )
  const projectsLoading = projectQueries.some((q) => q.isLoading)

  // Step 3: fetch deployments for each project
  const deploymentQueries = useQueries({
    queries: allProjects.map((project) => ({
      queryKey: ['deployments', project.orgId, project.id],
      queryFn: () => listDeployments(token, project.orgId, project.id),
      enabled: allProjects.length > 0,
    })),
  })

  const allDeployments: FlatDeployment[] = deploymentQueries
    .flatMap((q, i) => {
      const project = allProjects[i]
      if (!project) return []
      return (q.data?.data ?? []).map((d) => ({
        ...d,
        projectName: project.name,
        projectSlug: project.slug,
        orgId: project.orgId,
      }))
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)

  const deploymentsLoading = deploymentQueries.some((q) => q.isLoading)
  const isLoading = orgsLoading || projectsLoading || deploymentsLoading

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Deployments</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">
            {isLoading ? '…' : `${allDeployments.length} deployment${allDeployments.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <PageSpinner />
        </div>
      ) : allDeployments.length === 0 ? (
        <EmptyState />
      ) : (
        <DeploymentTable deployments={allDeployments} />
      )}
    </div>
  )
}

function DeploymentTable({ deployments }: { deployments: FlatDeployment[] }) {
  return (
    <div className="rounded-[--radius-lg] border border-[--border] overflow-hidden">
      {/* Table head */}
      <div
        className="grid text-[11px] font-medium text-[--text-muted] uppercase tracking-wide px-4 py-2.5"
        style={{
          gridTemplateColumns: '1fr 120px 100px 80px 90px',
          borderBottom: '1px solid rgba(255,255,255,0.055)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <span>Project</span>
        <span>Status</span>
        <span>Trigger</span>
        <span>Commit</span>
        <span className="text-right">Time</span>
      </div>

      {/* Rows */}
      {deployments.map((d) => {
        const sc = statusColor(d.status)
        return (
          <Link
            key={d.id}
            href={`/projects/${d.projectSlug}`}
            className="grid items-center px-4 py-3 text-sm hover:bg-[rgba(255,255,255,0.03)] transition-colors"
            style={{
              gridTemplateColumns: '1fr 120px 100px 80px 90px',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
            }}
          >
            {/* Project name */}
            <span className="text-[--text-primary] font-medium truncate pr-4">
              {d.projectName}
            </span>

            {/* Status */}
            <span className={`flex items-center gap-1.5 ${sc.label}`}>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
              <span className="capitalize text-xs">{d.status}</span>
            </span>

            {/* Trigger */}
            <span className="text-[--text-muted] text-xs capitalize">{d.trigger}</span>

            {/* Git SHA */}
            <span className="text-[--text-muted] text-xs font-mono">
              {d.git_sha ? d.git_sha.slice(0, 7) : '—'}
            </span>

            {/* Time */}
            <span className="text-[--text-muted] text-xs text-right">
              {formatRelative(d.created_at)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
      <div className="w-10 h-10 rounded-[--radius-lg] bg-[--bg-raised] border border-[--border] flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-medium text-[--text-primary]">No deployments yet</p>
        <p className="text-xs text-[--text-muted] mt-1">
          Deployments will appear here once you push to a connected project.{' '}
          <Link href="/projects" className="text-[--accent-light] hover:underline">
            View projects
          </Link>
        </p>
      </div>
    </div>
  )
}
