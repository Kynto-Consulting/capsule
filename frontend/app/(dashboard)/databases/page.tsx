'use client'

import { useState } from 'react'
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import { usePageTitle } from '@/lib/use-page-title'
import type { Database, ListResponse, Project, Organization } from '@/lib/types'

function listOrgDatabases(token: string, orgId: string) {
  return api.get<ListResponse<Database>>(`/api/v1/orgs/${orgId}/databases`, token)
}

function dbStatusBadge(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'available') return 'success'
  if (status === 'provisioning') return 'warning'
  if (status === 'failed') return 'error'
  return 'default'
}

function engineColor(engine: string): string {
  switch (engine) {
    case 'postgres':      return 'bg-blue-500'
    case 'mysql':         return 'bg-orange-400'
    case 'mariadb':       return 'bg-amber-500'
    case 'redis':         return 'bg-red-500'
    case 'mongodb':       return 'bg-green-500'
    case 'cassandra':     return 'bg-sky-400'
    case 'clickhouse':    return 'bg-yellow-400'
    case 'elasticsearch': return 'bg-teal-400'
    case 'cockroachdb':   return 'bg-purple-500'
    default:              return 'bg-[--text-muted]'
  }
}

interface FlatDatabase extends Database {
  projectName: string
  orgId: string
}

export default function DatabasesPage() {
  usePageTitle('Databases · Capsule')
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })
  const orgs = orgsRes?.data ?? []

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

  // Fetch databases at the org level (includes all + standalone)
  const orgDbQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['databases-org', org.id],
      queryFn: () => listOrgDatabases(token, org.id),
      enabled: orgs.length > 0,
    })),
  })

  const allDatabases: FlatDatabase[] = orgDbQueries
    .flatMap((q, i) => {
      const org = orgs[i]
      if (!org) return []
      return (q.data?.data ?? []).map((d) => {
        const proj = allProjects.find((p) => p.id === d.project_id)
        return {
          ...d,
          projectName: proj?.name ?? '—',
          orgId: org.id,
        }
      })
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const dbsLoading = orgDbQueries.some((q) => q.isLoading)
  const isLoading = orgsLoading || projectsLoading || dbsLoading

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Databases</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">
            {isLoading ? '…' : `${allDatabases.length} database${allDatabases.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowModal(true)}>Add database</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <PageSpinner />
        </div>
      ) : allDatabases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center bg-[--bg-raised] rounded-[--radius-lg] border border-dashed border-[rgba(255,255,255,0.08)]">
          <div className="w-12 h-12 rounded-[--radius-lg] bg-[--bg-surface] border border-[--border] flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-[--text-primary]">No databases yet</p>
            <p className="text-xs text-[--text-muted] mt-1 max-w-xs">Provision a PostgreSQL, MySQL, or Redis database.</p>
          </div>
          <Button size="sm" onClick={() => setShowModal(true)}>Create Database</Button>
        </div>
      ) : (
        <div className="rounded-[--radius-lg] border border-[--border] overflow-hidden">
          <div
            className="grid text-[11px] font-medium text-[--text-muted] uppercase tracking-wide px-4 py-2.5"
            style={{
              gridTemplateColumns: '1fr 100px 110px 120px 90px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <span>Name</span>
            <span>Engine</span>
            <span>Status</span>
            <span>Project</span>
            <span className="text-right">Created</span>
          </div>
          {allDatabases.map((d) => (
            <div
              key={d.id}
              className="grid items-center px-4 py-3 text-sm"
              style={{
                gridTemplateColumns: '1fr 100px 110px 120px 90px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
            >
              <span className="text-[--text-primary] font-medium font-mono truncate pr-4">{d.name}</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${engineColor(d.engine)}`} />
                <span className="text-xs text-[--text-secondary] capitalize">{d.engine}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {d.status === 'provisioning' && (
                  <span className="w-3 h-3 rounded-full border border-yellow-400 border-t-transparent animate-spin flex-shrink-0" />
                )}
                <Badge variant={dbStatusBadge(d.status)}>
                  {d.status === 'provisioning' ? 'Provisioning…' : d.status}
                </Badge>
              </span>
              <span className="text-xs text-[--text-muted] truncate">{d.projectName}</span>
              <span className="text-xs text-[--text-muted] text-right">{formatRelative(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddDatabaseModal
          orgs={orgs}
          projects={allProjects}
          token={token}
          onClose={() => setShowModal(false)}
          onCreated={(orgId) => {
            qc.invalidateQueries({ queryKey: ['databases-org', orgId] })
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

const ENGINE_OPTIONS = [
  { value: 'postgres',      label: 'PostgreSQL' },
  { value: 'mysql',         label: 'MySQL' },
  { value: 'mariadb',       label: 'MariaDB' },
  { value: 'redis',         label: 'Redis' },
  { value: 'mongodb',       label: 'MongoDB' },
  { value: 'cassandra',     label: 'Cassandra' },
  { value: 'clickhouse',    label: 'ClickHouse' },
  { value: 'elasticsearch', label: 'Elasticsearch' },
  { value: 'cockroachdb',   label: 'CockroachDB' },
]

function AddDatabaseModal({
  orgs,
  projects,
  token,
  onClose,
  onCreated,
}: {
  orgs: Organization[]
  projects: (Project & { orgId: string })[]
  token: string
  onClose: () => void
  onCreated: (orgId: string) => void
}) {
  const [orgId, setOrgId] = useState(orgs[0]?.id ?? '')
  const [projectId, setProjectId] = useState('none')
  const [engine, setEngine] = useState('postgres')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const orgProjects = projects.filter((p) => p.orgId === orgId)

  const projectOptions = [
    { value: 'none', label: 'No project (standalone)' },
    ...orgProjects.map((p) => ({ value: p.id, label: p.name })),
  ]

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (projectId === 'none') {
        return api.post(`/api/v1/orgs/${orgId}/databases`, { name, engine, version: 'latest' }, token)
      }
      return api.post(
        `/api/v1/orgs/${orgId}/projects/${projectId}/databases`,
        { name, engine, version: 'latest' },
        token
      )
    },
    onSuccess: () => onCreated(orgId),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[--bg-surface] border border-[--border] rounded-[--radius-xl] p-6 w-full max-w-sm flex flex-col gap-4 shadow-[--shadow]">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[--text-primary]">Add database</h2>
          <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-secondary] transition-colors text-lg leading-none">&times;</button>
        </div>

        <div className="flex flex-col gap-3">
          {orgs.length > 1 && (
            <Select
              label="Organization"
              value={orgId}
              onChange={(v) => { setOrgId(v); setProjectId('none') }}
              options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            />
          )}

          <Select
            label="Project"
            value={projectId}
            onChange={(v) => setProjectId(v)}
            options={projectOptions}
          />

          <Select
            label="Engine"
            value={engine}
            onChange={(v) => setEngine(v)}
            options={ENGINE_OPTIONS}
          />

          <Input
            label="Name"
            placeholder="my-database"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-[--danger]">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutate()} loading={isPending} disabled={!name || !orgId}>
            Create
          </Button>
        </div>
      </div>
    </div>
  )
}
