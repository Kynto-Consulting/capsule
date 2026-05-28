'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'
import { usePageTitle } from '@/lib/use-page-title'

interface OrgMember {
  user_id: string
  email: string
  name: string
  role: 'admin' | 'member' | 'readonly'
  joined_at: string
}

function roleBadgeClass(role: OrgMember['role']): string {
  if (role === 'admin') return 'bg-purple-500/15 text-purple-300 border-purple-500/25'
  if (role === 'member') return 'bg-blue-500/15 text-blue-300 border-blue-500/25'
  return 'bg-[rgba(255,255,255,0.06)] text-[--text-muted] border-[--border]'
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'readonly', label: 'Read-only' },
]

function MembersSection({ orgId, token, currentUserId }: {
  orgId: string
  token: string
  currentUserId: string
}) {
  const qc = useQueryClient()
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteError, setInviteError] = useState('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => api.get<{ data: OrgMember[] }>(`/api/v1/orgs/${orgId}/members`, token),
    enabled: !!orgId,
  })

  const members = data?.data ?? []

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/orgs/${orgId}/members`, { email: inviteEmail, role: inviteRole }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', orgId] })
      setInviteEmail('')
      setInviteRole('member')
      setInviteError('')
    },
    onError: (e: Error) => setInviteError(e.message),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/api/v1/orgs/${orgId}/members/${userId}`, { role }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  })

  const removeMutation = useMutation({
    mutationFn: (userId: string) =>
      api.delete(`/api/v1/orgs/${orgId}/members/${userId}`, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  })

  return (
    <section className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border]">
      {/* Section header */}
      <div className="px-5 py-4 border-b border-[--border]">
        <h2 className="text-sm font-semibold text-[--text-primary]">Team Members</h2>
        <p className="text-xs text-[--text-muted] mt-0.5">Manage who has access to this organization.</p>
      </div>

      {/* Invite */}
      <div className="px-5 py-4 border-b border-[--border]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[--text-muted] mb-3">Invite member</p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <Input
              label="Email address"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && inviteEmail) inviteMutation.mutate()
              }}
            />
          </div>
          <div className="w-36">
            <Select
              label="Role"
              value={inviteRole}
              onChange={(v) => setInviteRole(v)}
              options={ROLE_OPTIONS}
            />
          </div>
          <Button
            size="sm"
            onClick={() => inviteMutation.mutate()}
            loading={inviteMutation.isPending}
            disabled={!inviteEmail.trim()}
            className="mb-0.5"
          >
            Invite
          </Button>
        </div>
        {inviteError && (
          <p className="text-xs text-[--danger] mt-2">{inviteError}</p>
        )}
        {inviteMutation.isSuccess && (
          <p className="text-xs text-green-400 mt-2">Invitation sent.</p>
        )}
      </div>

      {/* Members list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <PageSpinner />
        </div>
      ) : error ? (
        <div className="px-5 py-6 text-center">
          <p className="text-sm text-[--danger]">Failed to load members.</p>
        </div>
      ) : members.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-[--text-muted]">No members yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[rgba(255,255,255,0.04)]">
          {members.map((m) => {
            const isSelf = m.user_id === currentUserId
            return (
              <li key={m.user_id} className="flex items-center gap-3 px-5 py-3.5">
                {/* Avatar */}
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-xs font-semibold text-white flex-shrink-0">
                  {(m.name || m.email)[0]?.toUpperCase() ?? '?'}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[--text-primary] font-medium truncate">
                    {m.name || m.email}
                    {isSelf && (
                      <span className="ml-1.5 text-[10px] text-[--text-muted] font-normal">(you)</span>
                    )}
                  </p>
                  {m.name && (
                    <p className="text-xs text-[--text-muted] truncate">{m.email}</p>
                  )}
                </div>

                {/* Role badge */}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border flex-shrink-0 ${roleBadgeClass(m.role)}`}
                >
                  {m.role}
                </span>

                {/* Role dropdown — disabled for self */}
                <div className="w-32 flex-shrink-0">
                  <Select
                    value={m.role}
                    onChange={(v) => updateRoleMutation.mutate({ userId: m.user_id, role: v })}
                    options={ROLE_OPTIONS}
                    disabled={isSelf}
                  />
                </div>

                {/* Remove */}
                <button
                  onClick={() => {
                    if (!confirm(`Remove ${m.email} from this organization?`)) return
                    removeMutation.mutate(m.user_id)
                  }}
                  disabled={isSelf || removeMutation.isPending}
                  title={isSelf ? 'Cannot remove yourself' : 'Remove member'}
                  className={`flex-shrink-0 p-1.5 rounded transition-colors ${
                    isSelf
                      ? 'opacity-30 cursor-not-allowed text-[--text-muted]'
                      : 'text-[--text-muted] hover:text-red-400 hover:bg-[rgba(239,68,68,0.08)]'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function SettingsPage() {
  usePageTitle('Settings · Capsule')
  const router = useRouter()
  const { user, accessToken, refreshToken, clearAuth } = useAuthStore()
  const token = accessToken!

  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api.get<{ data: { id: string; name: string; slug: string }[] }>('/api/v1/orgs', token),
  })
  const orgs = orgsRes?.data ?? []
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const orgId = selectedOrgId ?? orgs[0]?.id ?? ''

  async function handleLogout() {
    try {
      if (refreshToken) {
        await api.post('/api/v1/auth/logout', { refresh_token: refreshToken }, accessToken ?? undefined)
      }
    } catch {
      // proceed anyway
    }
    clearAuth()
    router.push('/login')
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[--text-primary]">Settings</h1>
        <p className="text-xs text-[--text-muted] mt-0.5">Manage your account and organization.</p>
      </div>

      {/* Profile */}
      <section className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] divide-y divide-[--border]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[--text-primary]">Profile</h2>
        </div>
        <div className="px-5 py-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-lg font-semibold text-white flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-medium text-[--text-primary]">{user?.name ?? '—'}</p>
            <p className="text-xs text-[--text-muted]">{user?.email ?? '—'}</p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[--text-muted] bg-[--bg-surface] border border-[--border] px-2 py-0.5 rounded-full">
            {user?.role ?? 'member'}
          </span>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] text-[--text-muted] uppercase tracking-wide mb-1">Name</p>
            <p className="text-sm text-[--text-secondary]">{user?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[--text-muted] uppercase tracking-wide mb-1">Email</p>
            <p className="text-sm text-[--text-secondary]">{user?.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[--text-muted] uppercase tracking-wide mb-1">Role</p>
            <p className="text-sm text-[--text-secondary] capitalize">{user?.role ?? '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-[--text-muted] uppercase tracking-wide mb-1">User ID</p>
            <p className="text-xs text-[--text-muted] font-mono truncate">{user?.id ?? '—'}</p>
          </div>
        </div>
      </section>

      {/* Team Members */}
      {orgsLoading ? (
        <div className="flex items-center justify-center py-10">
          <PageSpinner />
        </div>
      ) : orgs.length > 0 ? (
        <>
          {/* Org selector if multiple */}
          {orgs.length > 1 && (
            <div className="flex items-center gap-3">
              <p className="text-xs text-[--text-muted] flex-shrink-0">Organization:</p>
              <div className="w-56">
                <Select
                  value={orgId}
                  onChange={(v) => setSelectedOrgId(v)}
                  options={orgs.map((o) => ({ value: o.id, label: o.name }))}
                />
              </div>
            </div>
          )}

          {orgId && (
            <MembersSection
              key={orgId}
              orgId={orgId}
              token={token}
              currentUserId={user?.id ?? ''}
            />
          )}
        </>
      ) : (
        <section className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] px-5 py-8 text-center">
          <p className="text-sm text-[--text-muted]">No organizations found.</p>
        </section>
      )}

      {/* Session */}
      <section className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] divide-y divide-[--border]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[--text-primary]">Session</h2>
        </div>
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-[--text-secondary]">Sign out</p>
            <p className="text-xs text-[--text-muted]">End your current session and return to login.</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </section>

      {/* API */}
      <section className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] divide-y divide-[--border]">
        <div className="px-5 py-4">
          <h2 className="text-sm font-semibold text-[--text-primary]">API</h2>
        </div>
        <div className="px-5 py-4 space-y-1">
          <p className="text-[10px] text-[--text-muted] uppercase tracking-wide">Endpoint</p>
          <p className="text-xs text-[--text-secondary] font-mono">
            {process.env.NEXT_PUBLIC_API_URL ?? 'https://api.tumi-ai.com'}
          </p>
        </div>
      </section>
    </div>
  )
}
