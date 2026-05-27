'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Badge, statusToBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageSpinner } from '@/components/ui/spinner'
import { SkeletonCard } from '@/components/ui/skeleton'
import { formatRelative, slugify } from '@/lib/utils'
import { usePageTitle } from '@/lib/use-page-title'
import { useAuthStore } from '@/stores/auth'
import { listOrgs, createOrg } from '@/lib/orgs'
import { listProjects, createProject } from '@/lib/projects'
import { api } from '@/lib/api'
import type { Organization, Project } from '@/lib/types'

const runtimeColors: Record<string, string> = {
  go:     'bg-[rgba(0,173,216,0.1)] text-[#00add8]',
  node:   'bg-[rgba(104,184,103,0.1)] text-[#68b867]',
  python: 'bg-[rgba(255,212,59,0.1)] text-[#ffd43b]',
  rust:   'bg-[rgba(222,95,57,0.1)] text-[#de5f39]',
}

export default function ProjectsPage() {
  usePageTitle('Projects · Capsule')
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()

  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })

  const orgs = orgsRes?.data ?? []
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null)
  const orgId = activeOrgId ?? orgs[0]?.id ?? null

  const { data: projectsRes, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', orgId],
    queryFn: () => listProjects(token, orgId!),
    enabled: !!orgId,
  })

  const projects: (Project & { _orgId: string })[] = (projectsRes?.data ?? []).map(p => ({ ...p, _orgId: orgId! }))

  const [showCreateOrg, setShowCreateOrg] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [deletingProject, setDeletingProject] = useState<(Project & { _orgId: string }) | null>(null)

  if (orgsLoading) return <PageSpinner />

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* No org state */}
      {orgs.length === 0 && !showCreateOrg && (
        <EmptyOrgState onCreate={() => setShowCreateOrg(true)} />
      )}

      {orgs.length === 0 && showCreateOrg && (
        <CreateOrgForm
          token={token}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['orgs'] })
            setShowCreateOrg(false)
          }}
          onCancel={() => setShowCreateOrg(false)}
        />
      )}

      {orgs.length > 0 && (
        <>
          {/* Org switcher */}
          {orgs.length > 1 && (
            <OrgSwitcher orgs={orgs} activeId={orgId} onChange={setActiveOrgId} />
          )}

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-[--text-primary]">Projects</h1>
              <p className="text-sm text-[--text-muted] mt-0.5">
                {projectsLoading ? '…' : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <Button size="sm" onClick={() => setShowCreateProject(true)}>
              <PlusIcon /> New project
            </Button>
          </div>

          {/* Create project modal */}
          {showCreateProject && orgId && (
            <CreateProjectModal
              token={token}
              orgId={orgId}
              onSuccess={() => {
                qc.invalidateQueries({ queryKey: ['projects', orgId] })
                setShowCreateProject(false)
              }}
              onClose={() => setShowCreateProject(false)}
            />
          )}

          {/* AWS Credits and Cost Widget */}
          <AWSBillingWidget token={token} />

          {/* Delete confirmation modal */}
          {deletingProject && (
            <DeleteProjectModal
              projectSlug={deletingProject.slug}
              onConfirm={async () => {
                await api.delete(`/api/v1/orgs/${deletingProject._orgId}/projects/${deletingProject.id}`, token)
                qc.invalidateQueries({ queryKey: ['projects', orgId] })
                qc.invalidateQueries({ queryKey: ['all-projects'] })
                setDeletingProject(null)
              }}
              onClose={() => setDeletingProject(null)}
            />
          )}

          {/* Grid */}
          {projectsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1,2,3].map(i => <SkeletonCard key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((project) => (
                <div key={project.id} className="relative group/card">
                  <Link href={`/projects/${project.slug}`}>
                    <Card hover className="p-4 h-full flex flex-col gap-3">
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
                      <div className="flex items-center justify-between mt-auto pt-2 border-t border-[--border] gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-[4px] flex-shrink-0 ${runtimeColors[project.runtime] ?? 'bg-[--bg-overlay] text-[--text-muted]'}`}>
                            {project.runtime || 'auto'}
                          </span>
                          {project.deploy_type && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-[4px] flex-shrink-0 bg-[rgba(255,255,255,0.04)] text-[--text-muted]">
                              {project.deploy_type}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-[--text-muted] flex-shrink-0">{formatRelative(project.updated_at)}</span>
                      </div>
                    </Card>
                  </Link>
                  {/* Trash icon — shown on card hover, positioned top-right */}
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); setDeletingProject(project) }}
                    title="Delete project"
                    className="absolute top-2.5 right-2.5 p-1.5 rounded-[--radius-sm] opacity-0 group-hover/card:opacity-100 transition-opacity bg-[--bg-surface] border border-[rgba(239,68,68,0.2)] text-[--text-muted] hover:text-[--error] hover:border-[rgba(239,68,68,0.5)] hover:bg-[rgba(239,68,68,0.08)] z-10"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                </div>
              ))}

              {/* New project card */}
              <button
                onClick={() => setShowCreateProject(true)}
                className="rounded-[--radius-lg] border border-dashed border-[rgba(255,255,255,0.08)] bg-transparent hover:border-[rgba(255,255,255,0.15)] hover:bg-[--bg-surface] transition-all duration-200 p-4 flex flex-col items-center justify-center gap-2 text-[--text-muted] hover:text-[--text-secondary] min-h-[108px] group"
              >
                <div className="w-8 h-8 rounded-[--radius-sm] border border-dashed border-[rgba(255,255,255,0.08)] group-hover:border-[rgba(255,255,255,0.15)] flex items-center justify-center transition-colors">
                  <PlusIcon />
                </div>
                <span className="text-xs">New project</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AWSBillingWidget({ token }: { token: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['aws-billing'],
    queryFn: async () => {
      const res = await api.get<{
        total_spend: number
        currency: string
        period: string
        remaining_credits: number
        credit_expiration: string
        active_resources: {
          app_servers: number
          rds_databases: number
          s3_buckets: number
          custom_domains: number
        }
      }>('/api/v1/aws/billing', token)
      return res
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  if (isLoading || !data) return null

  const pct = (data.remaining_credits / 1000.0) * 100

  return (
    <Card className="p-5 mb-6 bg-[rgba(255,255,255,0.01)] border-[rgba(255,255,255,0.05)] shadow-[0_4px_30px_rgba(0,0,0,0.4)] backdrop-blur-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[--text-muted]">AWS Spend & Credits</h3>
          <div className="flex items-baseline gap-4 mt-2">
            <div>
              <p className="text-2xl font-bold text-[--text-primary] font-mono">${data.total_spend.toFixed(2)}</p>
              <p className="text-[10px] text-[--text-muted]">Monthly Spend ({data.period})</p>
            </div>
            <div className="h-8 w-[1px] bg-[--border] self-center" />
            <div>
              <p className="text-2xl font-bold text-[--accent-light] font-mono">${data.remaining_credits.toFixed(2)}</p>
              <p className="text-[10px] text-[--text-muted]">Remaining Credits (Exp: {data.credit_expiration})</p>
            </div>
          </div>
        </div>

        {/* Progress Bar & Resources */}
        <div className="flex-1 max-w-md">
          <div className="flex justify-between text-[10px] text-[--text-secondary] mb-1 font-mono">
            <span>Credits Consumption</span>
            <span>{pct.toFixed(1)}% remaining</span>
          </div>
          <div className="w-full h-1.5 bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden border border-[rgba(255,255,255,0.02)]">
            <div 
              className="h-full bg-gradient-to-r from-[--accent-dim] to-[--accent-light] rounded-full transition-all duration-500" 
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-[--text-muted]">
            <span>🖥️ {data.active_resources.app_servers} Serverless Apps</span>
            <span>💾 {data.active_resources.rds_databases} Databases</span>
            <span>🪣 {data.active_resources.s3_buckets} Buckets</span>
            <span>🌐 {data.active_resources.custom_domains} Domains</span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function EmptyOrgState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-center">
      <div className="w-12 h-12 rounded-[--radius-lg] bg-[--bg-raised] flex items-center justify-center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
      <div>
        <h2 className="text-base font-semibold text-[--text-primary]">No organization yet</h2>
        <p className="text-sm text-[--text-muted] mt-1">Create an organization to start managing projects.</p>
      </div>
      <Button onClick={onCreate}>Create organization</Button>
    </div>
  )
}

function OrgSwitcher({ orgs, activeId, onChange }: { orgs: Organization[]; activeId: string | null; onChange: (id: string) => void }) {
  return (
    <div className="flex gap-2 mb-6">
      {orgs.map(org => (
        <button
          key={org.id}
          onClick={() => onChange(org.id)}
          className={`text-xs px-3 py-1.5 rounded-[--radius-sm] border transition-colors ${
            activeId === org.id || (!activeId && org === orgs[0])
              ? 'border-[--border-strong] bg-[--bg-raised] text-[--text-primary]'
              : 'border-[--border] bg-transparent text-[--text-muted] hover:border-[--border-strong] hover:text-[--text-secondary]'
          }`}
        >
          {org.name}
        </button>
      ))}
    </div>
  )
}

function CreateOrgForm({ token, onSuccess, onCancel }: { token: string; onSuccess: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => createOrg(token, { name, slug }),
    onSuccess,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="max-w-md mx-auto mt-16">
      <h1 className="text-xl font-semibold text-[--text-primary] mb-1">Create organization</h1>
      <p className="text-sm text-[--text-muted] mb-6">Organizations group your projects and team members.</p>
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={name}
          onChange={e => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)) }}
          placeholder="Acme Inc"
        />
        <Input
          label="Slug"
          value={slug}
          onChange={e => setSlug(slugify(e.target.value))}
          placeholder="acme"
          hint="Used in URLs. Lowercase letters, numbers, and hyphens."
        />
        {error && <p className="text-xs text-[--danger]">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={() => mutate()} loading={isPending} disabled={!name || !slug}>Create</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}

function CreateProjectModal({ token, orgId, onSuccess, onClose }: { token: string; orgId: string; onSuccess: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [runtime, setRuntime] = useState('')
  const [error, setError] = useState('')

  const { mutate, isPending } = useMutation({
    mutationFn: () => createProject(token, orgId, { name, slug, repo_url: repoUrl, runtime }),
    onSuccess,
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[--bg-surface] border border-[--border] rounded-[--radius-lg] p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-[--text-primary] mb-4">New project</h2>
        <div className="flex flex-col gap-4">
          <Input
            label="Name"
            value={name}
            onChange={e => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)) }}
            placeholder="my-service"
          />
          <Input
            label="Slug"
            value={slug}
            onChange={e => setSlug(slugify(e.target.value))}
            placeholder="my-service"
          />
          <Input
            label="Repository URL"
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/org/repo"
            hint="Optional"
          />
          <Select
            label="Runtime"
            value={runtime}
            onChange={(v) => setRuntime(v)}
            options={[
              { value: 'go', label: 'Go' },
              { value: 'node', label: 'Node.js' },
              { value: 'python', label: 'Python' },
              { value: 'rust', label: 'Rust' },
            ]}
            placeholder="Auto-detect"
          />
          {error && <p className="text-xs text-[--danger]">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button onClick={() => mutate()} loading={isPending} disabled={!name || !slug}>Create project</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
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

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function DeleteProjectModal({ projectSlug, onConfirm, onClose }: { projectSlug: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await onConfirm()
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete project')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-[--bg-surface] border border-[rgba(239,68,68,0.3)] rounded-[--radius-lg] p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-[--text-primary] mb-1">Delete project</h2>
        <p className="text-sm text-[--text-muted] mb-4 leading-relaxed">
          This action is irreversible. All deployments, databases, and resources will be permanently removed.
          Type <span className="font-mono text-[--text-primary] bg-[--bg-raised] px-1 rounded">{projectSlug}</span> to confirm.
        </p>
        <div className="flex flex-col gap-3">
          <Input
            placeholder={projectSlug}
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            autoFocus
          />
          {deleteError && <p className="text-xs text-[--error]">{deleteError}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={deleting}
              disabled={confirmText !== projectSlug}
            >
              Delete project
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={deleting}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
