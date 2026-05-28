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
import type { DomainRecord, ListResponse, Organization, Project } from '@/lib/types'

function listDomainsByOrg(token: string, orgId: string) {
  return api.get<{ data: DomainRecord[] }>(
    `/api/v1/orgs/${orgId}/domains`,
    token
  )
}

function domainStatusBadge(status: string): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'active') return 'success'
  if (status === 'pending') return 'warning'
  if (status === 'failed') return 'error'
  return 'default'
}

export default function DomainsPage() {
  usePageTitle('Domains · Capsule')
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)

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

  const domainQueries = useQueries({
    queries: orgs.map((org) => ({
      queryKey: ['domains', org.id],
      queryFn: () => listDomainsByOrg(token, org.id),
      enabled: orgs.length > 0,
    })),
  })

  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]))

  const allDomains: (DomainRecord & { orgId: string })[] = domainQueries
    .flatMap((q, i) => {
      const org = orgs[i]
      if (!org) return []
      return (q.data?.data ?? []).map((d) => ({ ...d, orgId: org.id }))
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const domainsLoading = domainQueries.some((q) => q.isLoading)
  const isLoading = orgsLoading || domainsLoading

  async function handleVerify(d: DomainRecord & { orgId: string }) {
    setVerifying(d.id)
    try {
      await api.post(
        `/api/v1/orgs/${d.orgId}/domains/${d.id}/verify`,
        {},
        token
      )
      qc.invalidateQueries({ queryKey: ['domains', d.orgId] })
    } finally {
      setVerifying(null)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">Domains</h1>
          <p className="text-sm text-[--text-muted] mt-0.5">
            {isLoading ? '…' : `${allDomains.length} domain${allDomains.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowModal(true)}>Add domain</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <PageSpinner />
        </div>
      ) : allDomains.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-center">
          <div className="w-10 h-10 rounded-[--radius-lg] bg-[--bg-raised] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[--text-primary]">No domains yet</p>
            <p className="text-xs text-[--text-muted] mt-1">Add a custom domain to get started.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-[--radius-lg] border border-[--border] overflow-hidden">
          <div
            className="grid text-[11px] font-medium text-[--text-muted] uppercase tracking-wide px-4 py-2.5"
            style={{
              gridTemplateColumns: '1.5fr 110px 110px 1fr 80px 80px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <span>Domain</span>
            <span>Status</span>
            <span>Project</span>
            <span>CNAME target</span>
            <span>Created</span>
            <span />
          </div>
          {allDomains.map((d) => (
            <div
              key={d.id}
              className="grid items-center px-4 py-3 text-sm"
              style={{
                gridTemplateColumns: '1.5fr 110px 110px 1fr 80px 80px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
            >
              <span className="text-[--text-primary] font-medium font-mono truncate pr-4">{d.domain_name}</span>
              <span>
                <Badge variant={domainStatusBadge(d.status)}>{d.status}</Badge>
              </span>
              <span className="text-xs text-[--text-muted] truncate">
                {d.project_id ? (projectMap.get(d.project_id) ?? '—') : '—'}
              </span>
              <span className="text-xs text-[--text-muted] font-mono truncate pr-4">{d.record_value || '—'}</span>
              <span className="text-xs text-[--text-muted]">{formatRelative(d.created_at)}</span>
              <span className="flex justify-end">
                {d.status !== 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={verifying === d.id}
                    onClick={() => handleVerify(d)}
                  >
                    Verify
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AddDomainModal
          orgs={orgs}
          projects={allProjects}
          token={token}
          onClose={() => setShowModal(false)}
          onCreated={(orgId) => {
            qc.invalidateQueries({ queryKey: ['domains', orgId] })
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

function AddDomainModal({
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
  const [projectId, setProjectId] = useState('')
  const [domainName, setDomainName] = useState('')
  const [dnsProvider, setDnsProvider] = useState<'route53' | 'external'>('external')
  const [error, setError] = useState('')

  const orgProjects = projects.filter((p) => p.orgId === orgId)

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      if (projectId) {
        return api.post(
          `/api/v1/orgs/${orgId}/projects/${projectId}/domains`,
          { domain_name: domainName, dns_provider: dnsProvider },
          token
        )
      }
      return api.post(
        `/api/v1/orgs/${orgId}/domains`,
        { domain_name: domainName, dns_provider: dnsProvider },
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
          <h2 className="text-base font-semibold text-[--text-primary]">Add domain</h2>
          <button onClick={onClose} className="text-[--text-muted] hover:text-[--text-secondary] transition-colors text-lg leading-none">&times;</button>
        </div>

        <div className="flex flex-col gap-3">
          {orgs.length > 1 && (
            <Select
              label="Organization"
              value={orgId}
              onChange={(v) => { setOrgId(v); setProjectId('') }}
              options={orgs.map((o) => ({ value: o.id, label: o.name }))}
            />
          )}

          <Select
            label="Project (optional)"
            value={projectId}
            onChange={(v) => setProjectId(v)}
            options={[
              { value: '', label: 'No project (org-level)' },
              ...orgProjects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />

          <Input
            label="Domain name"
            placeholder="app.example.com"
            value={domainName}
            onChange={(e) => setDomainName(e.target.value)}
          />

          <Select
            label="DNS provider"
            value={dnsProvider}
            onChange={(v) => setDnsProvider(v as 'route53' | 'external')}
            options={[
              { value: 'external', label: 'External (manual CNAME)' },
              { value: 'route53', label: 'AWS Route 53' },
            ]}
          />
        </div>

        {error && <p className="text-xs text-[--danger]">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutate()} loading={isPending} disabled={!domainName}>
            Add
          </Button>
        </div>
      </div>
    </div>
  )
}
