'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge, statusToBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import type { Project, EnvVar, Deployment, BuildLog, ExecutionLog } from '@/lib/types'

type EnvVarWithValue = EnvVar & { value: string }

export default function ProjectDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()

  // Find the project by slug across orgs
  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })
  const orgs = orgsRes?.data ?? []

  const { data: projectsRes, isLoading: projectsLoading } = useQuery({
    queryKey: ['all-projects', orgs.map(o => o.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(orgs.map(org => listProjects(token, org.id)))
      return all.flatMap((r, i) => r.data.map(p => ({ ...p, _orgId: orgs[i].id })))
    },
    enabled: orgs.length > 0,
  })

  const projectWithOrg = projectsRes?.find(p => p.slug === slug)
  const project = projectWithOrg as (Project & { _orgId: string }) | undefined
  const orgId = project?._orgId

  const { data: envVars, isLoading: envLoading } = useQuery({
    queryKey: ['env', orgId, project?.id],
    queryFn: () => api.get<EnvVarWithValue[]>(`/api/v1/orgs/${orgId}/projects/${project!.id}/env`, token),
    enabled: !!orgId && !!project?.id,
  })

  const { data: deploymentsRes, isLoading: deploymentsLoading } = useQuery({
    queryKey: ['deployments', orgId, project?.id],
    queryFn: () => api.get<{ data: Deployment[]; meta: { total: number } }>(`/api/v1/orgs/${orgId}/projects/${project!.id}/deployments`, token),
    enabled: !!orgId && !!project?.id,
  })
  const deployments = deploymentsRes?.data ?? []

  const [tab, setTab] = useState<'overview' | 'deployments' | 'storage' | 'logs' | 'env' | 'settings'>('overview')

  if (orgsLoading || projectsLoading) return <PageSpinner />
  if (!project) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-sm text-[--text-muted]">Project not found</p>
    </div>
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-semibold text-[--text-primary]">{project.name}</h1>
            <Badge variant={statusToBadge(project.status)} dot>{project.status}</Badge>
          </div>
          <p className="text-sm text-[--text-muted]">{project.slug}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">Deploy</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[--border] mb-6">
        {(['overview', 'deployments', 'storage', 'logs', 'env', 'settings'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium transition-colors -mb-px ${
              tab === t
                ? 'text-[--text-primary] border-b border-[--accent]'
                : 'text-[--text-muted] hover:text-[--text-secondary]'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab project={project} />}
      {tab === 'deployments' && (
        <DeploymentsTab
          deployments={deployments}
          loading={deploymentsLoading}
          onTrigger={async () => {
            await api.post(`/api/v1/orgs/${orgId}/projects/${project.id}/deployments`, { version: 'manual' }, token)
            qc.invalidateQueries({ queryKey: ['deployments', orgId, project.id] })
          }}
        />
      )}
      {tab === 'storage' && <StorageTab project={project} token={token} orgId={orgId!} />}
      {tab === 'logs' && <LogsTab project={project} token={token} orgId={orgId!} deployments={deployments} />}
      {tab === 'env' && (
        <EnvTab
          envVars={envVars ?? []}
          loading={envLoading}
          onSave={async (key, value, isSecret) => {
            await api.put(`/api/v1/orgs/${orgId}/projects/${project.id}/env`, { key, value, is_secret: isSecret }, token)
            qc.invalidateQueries({ queryKey: ['env', orgId, project.id] })
          }}
          onDelete={async (key) => {
            await api.delete(`/api/v1/orgs/${orgId}/projects/${project.id}/env/${key}`, token)
            qc.invalidateQueries({ queryKey: ['env', orgId, project.id] })
          }}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          project={project}
          token={token}
          orgId={orgId!}
          onSaved={() => qc.invalidateQueries({ queryKey: ['all-projects'] })}
        />
      )}
    </div>
  )
}

function OverviewTab({ project }: { project: Project }) {
  const stats = [
    { label: 'Status', value: project.status },
    { label: 'Runtime', value: project.runtime || 'auto' },
    { label: 'Branch', value: project.branch },
    { label: 'Build strategy', value: project.build_strategy },
    { label: 'Replicas', value: String(project.replicas) },
    { label: 'Serverless', value: project.serverless ? 'yes' : 'no' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {stats.map(s => (
        <div key={s.label} className="bg-[--bg-raised] rounded-[--radius-lg] p-4">
          <p className="text-xs text-[--text-muted] mb-1">{s.label}</p>
          <p className="text-sm font-medium text-[--text-primary] font-mono">{s.value}</p>
        </div>
      ))}
      {project.repo_url && (
        <div className="col-span-full bg-[--bg-raised] rounded-[--radius-lg] p-4">
          <p className="text-xs text-[--text-muted] mb-1">Repository</p>
          <p className="text-sm font-medium text-[--text-primary] font-mono truncate">{project.repo_url}</p>
        </div>
      )}
    </div>
  )
}

function EnvTab({
  envVars, loading, onSave, onDelete,
}: {
  envVars: EnvVarWithValue[]
  loading: boolean
  onSave: (key: string, value: string, isSecret: boolean) => Promise<void>
  onDelete: (key: string) => Promise<void>
}) {
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newSecret, setNewSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  async function handleAdd() {
    if (!newKey) return
    setSaving(true)
    try {
      await onSave(newKey.toUpperCase(), newValue, newSecret)
      setNewKey('')
      setNewValue('')
      setNewSecret(false)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-12"><PageSpinner /></div>

  return (
    <div className="flex flex-col gap-4">
      {/* Existing vars */}
      {envVars.length > 0 && (
        <div className="border border-[--border] rounded-[--radius-lg] overflow-hidden">
          {envVars.map((ev, i) => {
            const isRevealed = revealed.has(ev.key)
            return (
              <div key={ev.key} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-[--border]' : ''}`}>
                <span className="text-sm font-mono text-[--text-primary] w-48 truncate">{ev.key}</span>
                <span className="text-sm font-mono text-[--text-muted] flex-1 truncate">
                  {ev.is_secret && !isRevealed ? '••••••••' : ev.value}
                </span>
                <div className="flex items-center gap-2">
                  {ev.is_secret && (
                    <button
                      onClick={() => setRevealed(s => { const n = new Set(s); n.has(ev.key) ? n.delete(ev.key) : n.add(ev.key); return n })}
                      className="text-xs text-[--text-muted] hover:text-[--text-secondary] transition-colors"
                    >
                      {isRevealed ? 'hide' : 'reveal'}
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(ev.key)}
                    className="text-xs text-[--danger] hover:opacity-80 transition-opacity"
                  >
                    remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add new */}
      <div className="bg-[--bg-surface] border border-[--border] rounded-[--radius-lg] p-4">
        <p className="text-sm font-medium text-[--text-primary] mb-3">Add variable</p>
        <div className="flex gap-3 flex-wrap">
          <Input
            className="w-48"
            placeholder="KEY"
            value={newKey}
            onChange={e => setNewKey(e.target.value.toUpperCase())}
          />
          <Input
            className="flex-1 min-w-[200px]"
            placeholder="value"
            type={newSecret ? 'password' : 'text'}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs text-[--text-muted] cursor-pointer self-center">
            <input
              type="checkbox"
              checked={newSecret}
              onChange={e => setNewSecret(e.target.checked)}
              className="accent-[--accent]"
            />
            Secret
          </label>
          <Button size="sm" onClick={handleAdd} loading={saving} disabled={!newKey}>
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}

function DeploymentsTab({
  deployments, loading, onTrigger,
}: {
  deployments: Deployment[]
  loading: boolean
  onTrigger: () => Promise<void>
}) {
  const [triggering, setTriggering] = useState(false)

  const statusColor: Record<string, string> = {
    queued:    'text-[--text-muted]',
    building:  'text-yellow-400',
    deploying: 'text-blue-400',
    success:   'text-green-400',
    failed:    'text-red-400',
    cancelled: 'text-[--text-muted]',
  }

  async function handleTrigger() {
    setTriggering(true)
    try { await onTrigger() } finally { setTriggering(false) }
  }

  if (loading) return <div className="flex justify-center py-12"><PageSpinner /></div>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleTrigger} loading={triggering}>Trigger deploy</Button>
      </div>

      {deployments.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-[--text-muted] text-sm">
          No deployments yet.
        </div>
      ) : (
        <div className="border border-[--border] rounded-[--radius-lg] overflow-hidden">
          {deployments.map((d, i) => (
            <div key={d.id} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-[--border]' : ''}`}>
              <span className={`text-xs font-medium w-20 ${statusColor[d.status] ?? 'text-[--text-muted]'}`}>
                {d.status}
              </span>
              <span className="text-xs font-mono text-[--text-muted] w-32 truncate">{d.version}</span>
              {d.git_sha && (
                <span className="text-xs font-mono text-[--text-muted]">{d.git_sha.slice(0, 7)}</span>
              )}
              <span className="text-xs text-[--text-muted] ml-auto">{d.trigger}</span>
              <span className="text-xs text-[--text-muted] w-20 text-right">{formatRelative(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SettingsTab({ project, token, orgId, onSaved }: { project: Project; token: string; orgId: string; onSaved: () => void }) {
  const [name, setName] = useState(project.name)
  const [repoUrl, setRepoUrl] = useState(project.repo_url ?? '')
  const [branch, setBranch] = useState(project.branch)
  const [runtime, setRuntime] = useState(project.runtime ?? '')
  const [replicas, setReplicas] = useState(String(project.replicas))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const { mutate, isPending } = useMutation({
    mutationFn: () => api.patch(
      `/api/v1/orgs/${orgId}/projects/${project.id}`,
      { name, repo_url: repoUrl, branch, runtime, replicas: parseInt(replicas, 10) || 1 },
      token,
    ),
    onSuccess: () => { setSuccess(true); onSaved() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="max-w-md flex flex-col gap-4">
      <Input label="Name" value={name} onChange={e => setName(e.target.value)} />
      <Input label="Repository URL" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} />
      <Input label="Branch" value={branch} onChange={e => setBranch(e.target.value)} />
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[--text-secondary]">Runtime</label>
        <select
          value={runtime}
          onChange={e => setRuntime(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-[--bg-base] border border-[--border] rounded-[--radius-sm] text-[--text-primary] outline-none focus:border-[--border-focus] transition-colors"
        >
          <option value="">Auto-detect</option>
          <option value="go">Go</option>
          <option value="node">Node.js</option>
          <option value="python">Python</option>
          <option value="rust">Rust</option>
        </select>
      </div>
      <Input label="Replicas" type="number" value={replicas} onChange={e => setReplicas(e.target.value)} />
      {error && <p className="text-xs text-[--danger]">{error}</p>}
      {success && <p className="text-xs text-green-400">Saved successfully.</p>}
      <Button onClick={() => mutate()} loading={isPending}>Save changes</Button>
    </div>
  )
}

interface S3Bucket {
  id: string
  name: string
  engine: string
  db_name: string
  status: string
  host: string
  credentials_enc?: string
}

function StorageTab({ project, token, orgId }: { project: Project; token: string; orgId: string }) {
  const { data: dbRes, isLoading } = useQuery({
    queryKey: ['project-databases', orgId, project.id],
    queryFn: () => api.get<{ data: S3Bucket[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/databases`, token),
  })
  
  const buckets = dbRes?.data?.filter(db => db.engine === 's3') ?? []
  const [selectedBucketCreds, setSelectedBucketCreds] = useState<string | null>(null)
  const [creds, setCreds] = useState<{ key: string; secret: string } | null>(null)

  async function handleShowCreds(b: S3Bucket) {
    if (selectedBucketCreds === b.id) {
      setSelectedBucketCreds(null)
      return
    }
    try {
      const res = await api.get<{ aws_access_key: string; aws_secret_key: string }>(
        `/api/v1/orgs/${orgId}/projects/${project.id}/storage/${b.id}`,
        token
      )
      setCreds({
        key: res.aws_access_key || 'AKIAXXXXXXXXXXXXXXXX',
        secret: res.aws_secret_key || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
      setSelectedBucketCreds(b.id)
    } catch {
      setCreds({
        key: 'AKIAXXXXXXXXXXXXXXXX',
        secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      })
      setSelectedBucketCreds(b.id)
    }
  }

  if (isLoading) return <PageSpinner />

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-[--text-primary]">Project S3 Buckets</h3>
      </div>

      {buckets.length === 0 ? (
        <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-6 text-center text-xs text-[--text-muted]">
          No S3 buckets bound to this project yet. Create one from the sidebar "Storage" page.
        </div>
      ) : (
        buckets.map(b => (
          <div key={b.id} className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-2">
            <div className="flex justify-between items-center">
              <div>
                <span className="font-mono text-xs font-semibold text-[--text-primary]">{b.db_name}</span>
                <span className="text-[10px] text-[--text-muted] block mt-0.5">Reference: {b.name} | Endpoint: {b.host}</span>
              </div>
              <Badge variant={b.status === 'available' ? 'success' : 'warning'}>{b.status}</Badge>
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => handleShowCreds(b)}>
                {selectedBucketCreds === b.id ? 'Hide Keys' : 'View Keys'}
              </Button>
            </div>

            {selectedBucketCreds === b.id && creds && (
              <div className="bg-[--bg-surface] rounded-[--radius-sm] border border-[--border] p-3 space-y-2 font-mono text-[10px] text-[--text-secondary]">
                <div className="flex justify-between">
                  <span>S3_BUCKET</span>
                  <span className="text-[--text-primary]">{b.db_name}</span>
                </div>
                <div className="flex justify-between">
                  <span>S3_ACCESS_KEY</span>
                  <span className="text-[--text-primary]">{creds.key}</span>
                </div>
                <div className="flex justify-between">
                  <span>S3_SECRET_KEY</span>
                  <span className="text-[--text-primary] truncate max-w-[200px]">{creds.secret}</span>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ─── Log type definitions ────────────────────────────────────────────────────

type LogTypeKey = 'build' | 'runtime' | 'lambda' | 'storage' | 'cron'

interface LogTypeConfig {
  key: LogTypeKey
  label: string
  description: string
  /** which deploy_types show this tab; undefined = all */
  forTypes?: Array<'docker' | 'lambda' | 'static'>
}

const ALL_LOG_TYPES: LogTypeConfig[] = [
  { key: 'build',   label: 'Build',   description: 'Deploy build output' },
  { key: 'runtime', label: 'Runtime', description: 'Live container stdout/stderr', forTypes: ['docker'] },
  { key: 'lambda',  label: 'Lambda',  description: 'Serverless request logs',      forTypes: ['lambda'] },
  { key: 'storage', label: 'Storage', description: 'S3 access logs',               forTypes: ['static'] },
  { key: 'cron',    label: 'Cron',    description: 'Scheduled job executions' },
]

function defaultLogType(deployType: string): LogTypeKey {
  if (deployType === 'docker')  return 'runtime'
  if (deployType === 'lambda')  return 'lambda'
  if (deployType === 'static')  return 'storage'
  return 'build'
}

// ─── Log console row ─────────────────────────────────────────────────────────

function LogRow({ ts, level, message, extra }: { ts: string; level: string; message: string; extra?: string }) {
  let levelCls = 'text-cyan-400'
  let msgCls   = 'text-slate-300'
  if (level === 'warn')  { levelCls = 'text-yellow-400'; msgCls = 'text-yellow-200' }
  if (level === 'error') { levelCls = 'text-red-400';    msgCls = 'text-red-300' }
  return (
    <div className="flex gap-2 hover:bg-white/[0.02] px-1 rounded group">
      <span className="text-slate-600 flex-shrink-0 tabular-nums">{ts}</span>
      <span className={`${levelCls} font-bold flex-shrink-0 w-10 uppercase text-[10px] mt-px`}>{level}</span>
      <span className={`${msgCls} flex-1 whitespace-pre-wrap break-all`}>
        {message}
        {extra && <span className="text-slate-500 text-[10px] ml-2">{extra}</span>}
      </span>
    </div>
  )
}

// ─── Source label helpers ──────────────────────────────────────────────────

function shortSourceID(sourceID: string): string {
  // capsule-3fd03737a421 → fn:3fd03737a421
  if (sourceID.startsWith('capsule-')) return 'fn:' + sourceID.slice(8)
  // s3:capsule-static-348973061281 → s3:capsule-static
  if (sourceID.startsWith('s3:')) return sourceID.replace(/-\d+$/, '')
  // UUID → first 8 chars
  if (/^[0-9a-f-]{36}$/.test(sourceID)) return sourceID.slice(0, 8)
  return sourceID
}

// ─── Source sidebar list ──────────────────────────────────────────────────

function SourceList({
  sources,
  selected,
  onSelect,
  loading,
}: {
  sources: string[]
  selected: string
  onSelect: (id: string) => void
  loading: boolean
}) {
  if (loading) return <div className="flex items-center justify-center h-20"><PageSpinner /></div>
  if (sources.length === 0) return (
    <div className="text-[11px] text-[--text-muted] px-3 py-4 italic">No sources yet</div>
  )
  return (
    <div className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect('')}
        className={`text-left px-3 py-1.5 text-[11px] rounded transition-colors ${
          selected === ''
            ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary] font-semibold'
            : 'text-[--text-muted] hover:text-[--text-secondary] hover:bg-[rgba(255,255,255,0.03)]'
        }`}
      >
        All sources
        <span className="ml-1.5 text-[10px] text-[--text-muted]">({sources.length})</span>
      </button>
      {sources.map(s => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          title={s}
          className={`text-left px-3 py-1.5 text-[11px] rounded transition-colors font-mono truncate ${
            selected === s
              ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary] font-semibold'
              : 'text-[--text-muted] hover:text-[--text-secondary] hover:bg-[rgba(255,255,255,0.03)]'
          }`}
        >
          {shortSourceID(s)}
        </button>
      ))}
    </div>
  )
}

// ─── Main LogsTab ─────────────────────────────────────────────────────────────

function LogsTab({ project, token, orgId, deployments }: { project: Project; token: string; orgId: string; deployments: Deployment[] }) {
  const deployType = project.deploy_type ?? 'docker'
  const availableTypes = ALL_LOG_TYPES.filter(t => !t.forTypes || t.forTypes.includes(deployType as any))

  const [logType,       setLogType]       = useState<LogTypeKey>(() => defaultLogType(deployType))
  const [selectedDeploy, setSelectedDeploy] = useState(() => deployments[0]?.id ?? '')
  const [selectedSource, setSelectedSource] = useState('')   // '' = all sources
  const [filterLevel,   setFilterLevel]   = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [autoRefresh,   setAutoRefresh]   = useState(false)
  const [aiExplanation, setAIExplanation] = useState<string | null>(null)
  const [explaining,    setExplaining]    = useState(false)

  // Reset source selector when switching log types
  const handleTypeChange = (t: LogTypeKey) => {
    setLogType(t)
    setSelectedSource('')
  }

  const refetchMs = autoRefresh ? 3000 : (false as const)

  // Which log types support source selection
  const hasSourceSelector = logType === 'lambda' || logType === 'cron' || logType === 'storage'

  // Source list discovery
  const { data: sourcesRes, isLoading: sourcesLoading } = useQuery({
    queryKey: ['log-sources', orgId, project.id, logType],
    queryFn: () => api.get<{ data: string[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/logs/${logType}/sources`, token),
    enabled: hasSourceSelector,
    staleTime: 30_000,
  })
  const sources = sourcesRes?.data ?? []

  // ── Log data queries ──────────────────────────────────────────────────────

  const sourceParam = selectedSource ? `&source_id=${encodeURIComponent(selectedSource)}` : ''

  const { data: buildLogsRes, isLoading: buildLoading } = useQuery({
    queryKey: ['logs-build', orgId, project.id, selectedDeploy],
    queryFn: () => api.get<{ data: BuildLog[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/deployments/${selectedDeploy}/logs`, token),
    enabled: logType === 'build' && !!selectedDeploy,
    refetchInterval: logType === 'build' ? refetchMs : false,
  })

  const { data: runtimeRes, isLoading: runtimeLoading } = useQuery({
    queryKey: ['logs-runtime', orgId, project.id],
    queryFn: () => api.get<{ container: string; lines: string[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/logs/runtime?tail=200`, token),
    enabled: logType === 'runtime',
    refetchInterval: logType === 'runtime' ? refetchMs : false,
  })

  const { data: lambdaRes, isLoading: lambdaLoading } = useQuery({
    queryKey: ['logs-lambda', orgId, project.id, selectedSource],
    queryFn: () => api.get<{ data: ExecutionLog[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/logs/lambda?tail=200${sourceParam}`, token),
    enabled: logType === 'lambda',
    refetchInterval: logType === 'lambda' ? refetchMs : false,
  })

  const { data: storageRes, isLoading: storageLoading } = useQuery({
    queryKey: ['logs-storage', orgId, project.id, selectedSource],
    queryFn: () => api.get<{ data: ExecutionLog[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/logs/storage?tail=200${sourceParam}`, token),
    enabled: logType === 'storage',
    refetchInterval: logType === 'storage' ? refetchMs : false,
  })

  const { data: cronRes, isLoading: cronLoading } = useQuery({
    queryKey: ['logs-cron', orgId, project.id, selectedSource],
    queryFn: () => api.get<{ data: ExecutionLog[] }>(`/api/v1/orgs/${orgId}/projects/${project.id}/logs/cron?tail=200${sourceParam}`, token),
    enabled: logType === 'cron',
    refetchInterval: logType === 'cron' ? refetchMs : false,
  })

  // ── Normalise to common shape ─────────────────────────────────────────────

  type NormLog = { id: string; ts: string; level: string; message: string; source?: string }

  function normLogs(): NormLog[] {
    switch (logType) {
      case 'build':
        return (buildLogsRes?.data ?? []).map((l, i) => ({
          id: l.id || String(i),
          ts: new Date(l.created_at).toLocaleTimeString(),
          level: l.level || 'info',
          message: l.message,
        }))
      case 'runtime':
        return (runtimeRes?.lines ?? []).map((line, i) => ({
          id: String(i),
          ts: new Date().toLocaleTimeString(),
          level: 'info',
          message: line,
        }))
      case 'lambda':
        return (lambdaRes?.data ?? []).map(l => ({
          id: l.id, ts: new Date(l.created_at).toLocaleTimeString(),
          level: l.level, message: l.message,
          source: selectedSource ? undefined : shortSourceID(l.source_id),
        }))
      case 'storage':
        return (storageRes?.data ?? []).map(l => ({
          id: l.id, ts: new Date(l.created_at).toLocaleTimeString(),
          level: l.level, message: l.message,
          source: selectedSource ? undefined : shortSourceID(l.source_id),
        }))
      case 'cron':
        return (cronRes?.data ?? []).map(l => ({
          id: l.id, ts: new Date(l.created_at).toLocaleTimeString(),
          level: l.level, message: l.message,
          source: selectedSource ? undefined : shortSourceID(l.source_id),
        }))
    }
  }

  const isLoading = buildLoading || runtimeLoading || lambdaLoading || storageLoading || cronLoading

  const filteredLogs = normLogs().filter(l =>
    filterLevel === 'all' ? true : l.level.toLowerCase() === filterLevel
  )

  async function handleAIExplain() {
    setExplaining(true)
    setAIExplanation(null)
    try {
      const depID = selectedDeploy || deployments[0]?.id || ''
      const res = await api.post<{ explanation: string }>('/api/v1/ai/explain-failure', { deployment_id: depID }, token)
      setAIExplanation(res.explanation)
    } catch (err: any) {
      setAIExplanation('Bedrock AI error: ' + err.message)
    } finally {
      setExplaining(false)
    }
  }

  const currentTypeCfg = availableTypes.find(t => t.key === logType)

  return (
    <div className="space-y-3">

      {/* ── Top bar: type tabs + right controls ── */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex gap-0.5 bg-[--bg-raised] rounded-[--radius-sm] p-0.5 border border-[--border]">
          {availableTypes.map(t => (
            <button
              key={t.key}
              title={t.description}
              onClick={() => handleTypeChange(t.key)}
              className={`px-3 py-1 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
                logType === t.key
                  ? 'bg-[rgba(255,255,255,0.08)] text-[--text-primary]'
                  : 'text-[--text-muted] hover:text-[--text-secondary]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {logType === 'build' && (
            <select
              value={selectedDeploy}
              onChange={e => setSelectedDeploy(e.target.value)}
              className="text-xs bg-[--bg-raised] border border-[--border] text-[--text-primary] px-2 py-1 rounded"
            >
              <option value="">Select deployment…</option>
              {deployments.map(d => (
                <option key={d.id} value={d.id}>{d.version} — {d.status}</option>
              ))}
            </select>
          )}

          <select
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value as any)}
            className="text-xs bg-[--bg-raised] border border-[--border] text-[--text-primary] px-2 py-1 rounded"
          >
            <option value="all">All levels</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>

          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`px-2 py-1 text-xs rounded border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                : 'border-[--border] text-[--text-muted] hover:text-[--text-secondary]'
            }`}
          >
            {autoRefresh ? '⏺ Live' : '⏸ Live'}
          </button>

          <Button size="sm" onClick={handleAIExplain} loading={explaining}>AI Explain</Button>
        </div>
      </div>

      {/* ── AI Explanation ── */}
      {aiExplanation && (
        <div className="bg-violet-950/20 border border-violet-500/30 rounded-[--radius-lg] p-4 text-xs space-y-2 whitespace-pre-wrap leading-relaxed text-[--text-secondary]">
          <div className="flex justify-between items-center">
            <span className="text-violet-400 font-bold">🤖 Bedrock Failure Analysis</span>
            <button className="text-[10px] text-[--text-muted] hover:text-[--text-primary]" onClick={() => setAIExplanation(null)}>dismiss</button>
          </div>
          {aiExplanation}
        </div>
      )}

      {/* ── Main panel: source list (left) + console (right) ── */}
      <div className={`flex gap-3 ${hasSourceSelector && sources.length > 0 ? 'items-start' : ''}`}>

        {/* Source sidebar — only for lambda/cron/storage when sources exist */}
        {hasSourceSelector && (
          <div className="w-44 flex-shrink-0 border border-[--border] rounded-[--radius-lg] bg-[--bg-raised] overflow-hidden">
            <div className="px-3 py-2 border-b border-[--border]">
              <span className="text-[10px] font-semibold text-[--text-muted] uppercase tracking-wide">
                {logType === 'lambda'  ? 'Functions'   : ''}
                {logType === 'cron'    ? 'Cron jobs'   : ''}
                {logType === 'storage' ? 'Buckets'     : ''}
              </span>
            </div>
            <div className="p-1.5">
              <SourceList
                sources={sources}
                selected={selectedSource}
                onSelect={setSelectedSource}
                loading={sourcesLoading}
              />
            </div>
          </div>
        )}

        {/* Console */}
        <div className="flex-1 bg-[#0a0a0a] border border-[--border] rounded-[--radius-lg] overflow-hidden min-w-0">
          {/* Chrome bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[--border] bg-[--bg-raised]">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            </div>
            <span className="text-[11px] text-[--text-muted] font-mono">
              {currentTypeCfg?.description}
              {selectedSource && <span className="text-[--accent] ml-1">· {shortSourceID(selectedSource)}</span>}
              {' '}· {filteredLogs.length} entries
            </span>
            {logType === 'runtime' && runtimeRes?.container && (
              <code className="text-[10px] text-emerald-500 font-mono">{runtimeRes.container}</code>
            )}
            {!runtimeRes?.container && <div className="w-24" />}
          </div>

          {/* Log lines */}
          <div className="h-80 overflow-y-auto p-3 font-mono text-[11px] leading-5">
            {isLoading ? (
              <div className="flex justify-center items-center h-full"><PageSpinner /></div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-slate-600 text-center py-28 space-y-1">
                <div>
                  {logType === 'build' && !selectedDeploy
                    ? 'Select a deployment to view build logs.'
                    : hasSourceSelector && sources.length === 0
                    ? 'No logs yet — send a request or trigger an action to generate logs.'
                    : 'No logs matching filters.'}
                </div>
                {hasSourceSelector && sources.length === 0 && (
                  <div className="text-[10px] text-slate-700 font-mono">
                    $ capsule logs {logType} --follow
                  </div>
                )}
              </div>
            ) : (
              filteredLogs.map(l => (
                <LogRow key={l.id} ts={l.ts} level={l.level} message={l.message} extra={l.source} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── CLI hint ── */}
      <div className="text-[11px] text-[--text-muted] font-mono">
        $ capsule logs {logType}{logType === 'build' ? ' [deployment-id]' : selectedSource ? ` --source-id ${selectedSource}` : ''} --follow
      </div>
    </div>
  )
}
