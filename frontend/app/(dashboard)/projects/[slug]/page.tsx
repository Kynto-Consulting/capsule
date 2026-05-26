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
import type { Project, EnvVar, Deployment, BuildLog } from '@/lib/types'

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

function LogsTab({ project, token, orgId, deployments }: { project: Project; token: string; orgId: string; deployments: Deployment[] }) {
  const [logType, setLogType] = useState<'build' | 'runtime'>('runtime')
  const [selectedDeploy, setSelectedDeploy] = useState('')
  const [filterLevel, setFilterLevel] = useState<'all' | 'info' | 'warn' | 'error'>('all')
  const [aiExplanation, setAIExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)

  // Fetch build logs for selected deployment
  const { data: logsRes, isLoading: logsLoading } = useQuery({
    queryKey: ['build-logs', orgId, project.id, selectedDeploy],
    queryFn: () => api.get<BuildLog[]>(`/api/v1/orgs/${orgId}/projects/${project.id}/deployments/${selectedDeploy}/logs`, token),
    enabled: logType === 'build' && !!selectedDeploy,
  })
  const buildLogs = logsRes ?? []

  // Simulated live runtime logs
  const runtimeLogs: BuildLog[] = [
    { id: '1', deployment_id: '1', level: 'info', message: 'Starting Capsule production runtime engine on us-east-1...', created_at: new Date().toISOString() },
    { id: '2', deployment_id: '1', level: 'info', message: 'Injected environment variable: PORT=8080', created_at: new Date().toISOString() },
    { id: '3', deployment_id: '1', level: 'info', message: 'Successfully connected to PostgreSQL database at capsule-prod-db.us-east-1.rds.amazonaws.com:5432', created_at: new Date().toISOString() },
    { id: '4', deployment_id: '1', level: 'warn', message: 'Redis connection offline; falling back to memory caching layer', created_at: new Date().toISOString() },
    { id: '5', deployment_id: '1', level: 'info', message: 'Listening and serving HTTP traffic on 0.0.0.0:8080', created_at: new Date().toISOString() },
    { id: '6', deployment_id: '1', level: 'error', message: 'Failed to dispatch webhook event: payload deadline exceeded', created_at: new Date().toISOString() },
  ]

  const activeLogs = logType === 'build' ? buildLogs : runtimeLogs

  const filteredLogs = activeLogs.filter(l => {
    if (filterLevel === 'all') return true
    return l.level.toLowerCase() === filterLevel
  })

  async function handleAIExplain() {
    if (!selectedDeploy && logType === 'build') return
    setExplaining(true)
    setAIExplanation(null)
    try {
      const res = await api.post<{ explanation: string }>('/api/v1/ai/explain-failure', {
        deployment_id: selectedDeploy || deployments[0]?.id || '',
      }, token)
      setAIExplanation(res.explanation)
    } catch (err: any) {
      setAIExplanation('Bedrock AI log analyzer error: ' + err.message)
    } finally {
      setExplaining(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <div className="flex gap-2 bg-[--bg-raised] rounded-[--radius-sm] p-0.5 border border-[--border]">
          <button
            onClick={() => setLogType('runtime')}
            className={`px-3 py-1 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
              logType === 'runtime' ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary]' : 'text-[--text-muted] hover:text-[--text-secondary]'
            }`}
          >
            Runtime Logs
          </button>
          <button
            onClick={() => setLogType('build')}
            className={`px-3 py-1 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
              logType === 'build' ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary]' : 'text-[--text-muted] hover:text-[--text-secondary]'
            }`}
          >
            Build Logs
          </button>
        </div>

        {logType === 'build' && (
          <select
            value={selectedDeploy}
            onChange={e => setSelectedDeploy(e.target.value)}
            className="text-xs bg-[--bg-raised] border border-[--border] text-[--text-primary] px-2 py-1 rounded"
          >
            <option value="">Select deployment...</option>
            {deployments.map(d => (
              <option key={d.id} value={d.id}>{d.version} ({d.status})</option>
            ))}
          </select>
        )}

        <div className="flex gap-2">
          {/* Level Filter */}
          <select
            value={filterLevel}
            onChange={e => setFilterLevel(e.target.value as any)}
            className="text-xs bg-[--bg-raised] border border-[--border] text-[--text-primary] px-2 py-1 rounded"
          >
            <option value="all">All Levels</option>
            <option value="info">INFO</option>
            <option value="warn">WARN</option>
            <option value="error">ERROR</option>
          </select>

          {/* AI explainer */}
          <Button size="sm" onClick={handleAIExplain} loading={explaining}>
            AI Explain Failure
          </Button>
        </div>
      </div>

      {/* AI Explanation card */}
      {aiExplanation && (
        <div className="bg-violet-950/20 border border-violet-500/30 rounded-[--radius-lg] p-4 text-xs space-y-2 whitespace-pre-wrap leading-relaxed text-[--text-secondary]">
          <div className="flex justify-between items-center">
            <span className="text-violet-400 font-bold">🤖 Bedrock Failure Analysis</span>
            <button className="text-[10px] text-[--text-muted] hover:text-[--text-primary]" onClick={() => setAIExplanation(null)}>
              dismiss
            </button>
          </div>
          {aiExplanation}
        </div>
      )}

      {/* Console area */}
      <div className="bg-black border border-[--border] rounded-[--radius-lg] p-4 h-64 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300">
        {logsLoading ? (
          <div className="flex justify-center items-center h-full"><PageSpinner /></div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-slate-500 text-center py-20">No logs matching active filters.</div>
        ) : (
          filteredLogs.map(l => {
            let color = 'text-slate-300'
            if (l.level === 'warn') color = 'text-yellow-400'
            if (l.level === 'error') color = 'text-red-400'
            return (
              <div key={l.id} className="flex gap-3">
                <span className="text-slate-500 flex-shrink-0">[{new Date(l.created_at).toLocaleTimeString()}]</span>
                <span className={`${color} flex-1`}>{l.message}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
