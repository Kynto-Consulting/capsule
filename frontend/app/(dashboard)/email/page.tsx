'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageSpinner } from '@/components/ui/spinner'
import { usePageTitle } from '@/lib/use-page-title'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'
import {
  LayoutDashboard, Globe, Send, FileText, Ban,
  Copy, Check, RefreshCw, ChevronDown, ChevronRight, Plus, Trash2,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DNSRecord { type: string; host: string; value: string; status: string }
interface DNSRecordsResponse { domain: string; records: DNSRecord[]; dkim_status: string; verification_status: string }
interface EmailLog { id: string; project_id: string; domain: string; from: string; to: string; subject: string; status: string; message_id?: string; created_at: string }
interface Suppression { email: string; reason: string; created_at: string }
interface EmailStats { sent_last_24h: number; quota_24h: number; sending_enabled: boolean }

interface EmailSetup { id: string; project_id: string; name: string; engine: string; db_name: string; status: string; created_at: string; projectName?: string; orgId?: string }
interface SMTPOps { smtp_host: string; smtp_port: string; smtp_user: string; smtp_pass: string; verified_from: string }

type Section = 'overview' | 'domains' | 'send' | 'logs' | 'suppressions'

// ─── Small helpers ─────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <button onClick={copy} className="p-1 rounded hover:bg-[--bg-overlay] text-[--text-muted] hover:text-[--text-primary] transition-colors">
      {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  )
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

function dnsStatusVariant(s: string): 'success' | 'warning' | 'info' {
  if (s === 'verified' || s === 'success') return 'success'
  if (s === 'recommended') return 'info'
  return 'warning'
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const NAV: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={15} /> },
  { key: 'domains', label: 'Domains', icon: <Globe size={15} /> },
  { key: 'send', label: 'Send', icon: <Send size={15} /> },
  { key: 'logs', label: 'Logs', icon: <FileText size={15} /> },
  { key: 'suppressions', label: 'Suppressions', icon: <Ban size={15} /> },
]

function Sidebar({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  return (
    <nav className="w-[180px] shrink-0 bg-[--bg-raised] border-r border-[--border] flex flex-col py-4 gap-0.5 px-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-[--text-muted] px-2 mb-2">Email</p>
      {NAV.map(n => (
        <button
          key={n.key}
          onClick={() => onSelect(n.key)}
          className={[
            'flex items-center gap-2.5 px-3 py-2 rounded-[--radius-sm] text-sm transition-all w-full text-left',
            active === n.key
              ? 'bg-[--accent-dim] text-[--accent-light] border-l-2 border-[--accent] pl-[10px]'
              : 'text-[--text-secondary] hover:bg-[--bg-overlay] hover:text-[--text-primary]',
          ].join(' ')}
        >
          {n.icon}
          {n.label}
        </button>
      ))}
    </nav>
  )
}

// ─── Overview Section ─────────────────────────────────────────────────────────

function OverviewSection({ emails, token }: { emails: EmailSetup[]; token: string }) {
  const first = emails[0]
  const { data: stats } = useQuery({
    queryKey: ['email-stats', first?.id],
    queryFn: () => api.get<EmailStats>(`/api/v1/orgs/${first!.orgId}/projects/${first!.project_id}/email/stats`, token),
    enabled: !!first,
    staleTime: 5 * 60 * 1000,
  })
  const { data: logsRes } = useQuery({
    queryKey: ['email-logs-recent', first?.id],
    queryFn: () => api.get<{ data: EmailLog[] }>(`/api/v1/orgs/${first!.orgId}/projects/${first!.project_id}/email/logs?limit=5`, token),
    enabled: !!first,
  })
  const recentLogs: EmailLog[] = logsRes?.data ?? []

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-[--text-primary]">Overview</h2>
        <p className="text-xs text-[--text-muted] mt-0.5">Sending activity and account status</p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Sent (24h)', value: stats ? stats.sent_last_24h.toLocaleString() : '—' },
          { label: 'Daily Quota', value: stats ? stats.quota_24h.toLocaleString() : '—' },
          { label: 'Bounce Rate', value: '0.0%' },
          { label: 'Status', value: stats ? (stats.sending_enabled ? 'enabled' : 'sandbox') : '—', colored: true, enabled: stats?.sending_enabled },
        ].map(c => (
          <div key={c.label} className="bg-[--bg-raised] border border-[--border] rounded-[--radius] p-4">
            <p className="text-[10px] uppercase tracking-wider text-[--text-muted] font-medium">{c.label}</p>
            <p className={`text-xl font-semibold mt-1 ${c.colored ? (c.enabled ? 'text-green-400' : 'text-yellow-400') : 'text-[--text-primary]'}`}>{c.value}</p>
          </div>
        ))}
      </div>
      {emails.length === 0 ? (
        <div className="border border-dashed border-[--border] rounded-[--radius-lg] p-12 text-center">
          <Globe size={32} className="mx-auto text-[--text-muted] mb-3" />
          <p className="text-sm font-medium text-[--text-primary]">No domain configured</p>
          <p className="text-xs text-[--text-muted] mt-1 mb-4">Add a sending domain to start sending emails</p>
        </div>
      ) : (
        <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] overflow-hidden">
          <div className="px-4 py-3 border-b border-[--border]">
            <p className="text-xs font-semibold text-[--text-secondary]">Recent Activity</p>
          </div>
          {recentLogs.length === 0 ? (
            <p className="text-xs text-[--text-muted] p-4">No emails sent yet.</p>
          ) : (
            recentLogs.map(log => (
              <div key={log.id} className="flex items-center gap-4 px-4 py-2.5 border-b border-[--border] last:border-0 text-xs">
                <span className="font-mono text-[--text-muted] w-36 truncate">{log.from}</span>
                <span className="font-mono text-[--text-secondary] flex-1 truncate">{log.to}</span>
                <span className="text-[--text-secondary] flex-1 truncate">{log.subject}</span>
                <Badge variant={log.status === 'sent' || log.status === 'delivered' ? 'success' : 'warning'}>{log.status}</Badge>
                <span className="text-[--text-muted] w-16 text-right">{relativeTime(log.created_at)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Domains Section ──────────────────────────────────────────────────────────

function DomainsSection({ emails, projects, token, onAddDomain }: {
  emails: EmailSetup[]; projects: Array<{ id: string; name: string; orgId: string }>;
  token: string; onAddDomain: (orgId: string, projectId: string, domain: string) => void
}) {
  const qc = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(emails[0]?.id ?? null)
  const [showAdd, setShowAdd] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [newProject, setNewProject] = useState('')
  const [smtpOpen, setSmtpOpen] = useState(false)
  const [smtpData, setSmtpData] = useState<SMTPOps | null>(null)
  const [testFrom, setTestFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const selected = emails.find(e => e.id === selectedId)

  const { data: dnsRes, refetch: refetchDns, isFetching: dnsLoading } = useQuery({
    queryKey: ['dns-records', selected?.id],
    queryFn: () => api.get<DNSRecordsResponse>(`/api/v1/orgs/${selected!.orgId}/projects/${selected!.project_id}/email/dns-records`, token),
    enabled: !!selected,
  })

  const loadSmtp = useCallback(async () => {
    if (!selected) return
    if (smtpOpen) { setSmtpOpen(false); return }
    try {
      const res = await api.get<{ domain: string; status: string; smtp_operations: SMTPOps }>(
        `/api/v1/orgs/${selected.orgId}/projects/${selected.project_id}/email/status`, token
      )
      setSmtpData(res.smtp_operations ?? null)
    } catch { setSmtpData(null) }
    setSmtpOpen(true)
  }, [selected, smtpOpen, token])

  const removeMut = useMutation({
    mutationFn: () => api.delete(`/api/v1/orgs/${selected!.orgId}/projects/${selected!.project_id}/email/domain`, token),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['all-email-setups'] }); setSelectedId(null) },
  })

  const sendTest = async () => {
    if (!selected || !testTo) return
    try {
      const res = await api.post<{ message: string }>(
        `/api/v1/orgs/${selected.orgId}/projects/${selected.project_id}/email/test`,
        { from: testFrom || undefined, to: testTo }, token
      )
      setTestResult({ ok: true, msg: res.message || 'Sent!' })
    } catch (e: unknown) {
      setTestResult({ ok: false, msg: e instanceof Error ? e.message : 'Error' })
    }
  }

  const dns: DNSRecord[] = dnsRes?.records ?? []

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Domain list */}
      <div className="w-64 border-r border-[--border] flex flex-col">
        <div className="p-3 border-b border-[--border]">
          <p className="text-xs font-semibold text-[--text-muted] uppercase tracking-wider">Domains</p>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {emails.length === 0 && <p className="text-xs text-[--text-muted] p-4">No domains yet.</p>}
          {emails.map(e => (
            <button key={e.id} onClick={() => setSelectedId(e.id)}
              className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 border-b border-[--border] transition-colors ${selectedId === e.id ? 'bg-[--accent-dim]' : 'hover:bg-[--bg-overlay]'}`}>
              <span className="font-mono text-xs text-[--text-primary] truncate">{e.db_name}</span>
              <Badge variant={e.status === 'verified' ? 'success' : 'warning'} dot>{e.status}</Badge>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[--border]">
          <Button size="sm" variant="outline" className="w-full" onClick={() => setShowAdd(v => !v)}>
            <Plus size={13} /> Add domain
          </Button>
          {showAdd && (
            <div className="mt-3 space-y-2">
              <Select
                value={newProject}
                onChange={(v) => setNewProject(v)}
                placeholder="Select project…"
                options={projects.map(p => ({ value: p.id, label: p.name }))}
              />
              <Input placeholder="yourdomain.com" value={newDomain} onChange={e => setNewDomain(e.target.value.toLowerCase())} className="h-8 text-xs" />
              <Button size="sm" className="w-full" disabled={!newProject || !newDomain}
                onClick={() => { const p = projects.find(x => x.id === newProject); if (p) { onAddDomain(p.orgId, p.id, newDomain); setShowAdd(false); setNewDomain(''); setNewProject('') } }}>
                Add
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Domain detail */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-[--text-muted] text-sm">Select a domain to view details</div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="font-mono font-semibold text-[--text-primary]">{selected.db_name}</span>
                <Badge variant={selected.status === 'verified' ? 'success' : 'warning'} dot>{selected.status}</Badge>
              </div>
              <Button size="sm" variant="danger" loading={removeMut.isPending} onClick={() => removeMut.mutate()}>
                <Trash2 size={13} /> Remove
              </Button>
            </div>

            {/* DNS Records */}
            <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[--border]">
                <p className="text-xs font-semibold text-[--text-secondary]">DNS Records</p>
                <Button size="sm" variant="ghost" onClick={() => refetchDns()} loading={dnsLoading}>
                  <RefreshCw size={12} /> Refresh
                </Button>
              </div>
              {dns.length === 0 ? (
                <p className="text-xs text-[--text-muted] p-4">No DNS records found.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-[--border] text-[--text-muted]">
                    <th className="text-left px-4 py-2 font-medium w-16">Type</th>
                    <th className="text-left px-4 py-2 font-medium">Host</th>
                    <th className="text-left px-4 py-2 font-medium">Value</th>
                    <th className="text-left px-4 py-2 font-medium w-24">Status</th>
                  </tr></thead>
                  <tbody>
                    {dns.map((r, i) => (
                      <tr key={i} className="border-b border-[--border] last:border-0 hover:bg-[--bg-overlay]">
                        <td className="px-4 py-2.5"><Badge variant={r.type === 'CNAME' ? 'info' : 'default'}>{r.type}</Badge></td>
                        <td className="px-4 py-2.5 font-mono text-[--text-muted] max-w-[160px] truncate" title={r.host}>{r.host}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[--text-secondary] max-w-[200px] truncate block" title={r.value}>{r.value}</span>
                            <CopyButton value={r.value} />
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><Badge variant={dnsStatusVariant(r.status)} dot>{r.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* SMTP Credentials */}
            <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] overflow-hidden">
              <button onClick={loadSmtp} className="flex items-center justify-between w-full px-4 py-3 hover:bg-[--bg-overlay] transition-colors">
                <p className="text-xs font-semibold text-[--text-secondary]">SMTP Credentials</p>
                {smtpOpen ? <ChevronDown size={14} className="text-[--text-muted]" /> : <ChevronRight size={14} className="text-[--text-muted]" />}
              </button>
              {smtpOpen && smtpData && (
                <div className="border-t border-[--border] p-4 font-mono text-[11px] space-y-2">
                  {Object.entries({
                    'SMTP Host': smtpData.smtp_host,
                    'SMTP Port': smtpData.smtp_port,
                    'SMTP User': smtpData.smtp_user,
                    'SMTP Pass': smtpData.smtp_pass,
                    'From Email': smtpData.verified_from,
                  }).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4">
                      <span className="text-[--text-muted] w-24 shrink-0">{k}</span>
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-[--text-primary] truncate">{v}</span>
                        <CopyButton value={v} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Send Test Email */}
            <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] p-4 space-y-3">
              <p className="text-xs font-semibold text-[--text-secondary]">Send Test Email</p>
              <div className="grid grid-cols-2 gap-3">
                <Input placeholder={`hello@${selected.db_name}`} value={testFrom} onChange={e => setTestFrom(e.target.value)} className="h-8 text-xs" />
                <Input placeholder="recipient@example.com" value={testTo} onChange={e => setTestTo(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex items-center gap-3">
                <Button size="sm" disabled={!testTo} onClick={sendTest}>Send</Button>
                {testResult && (
                  <p className={`text-xs font-mono ${testResult.ok ? 'text-green-400' : 'text-[--error]'}`}>{testResult.msg}</p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Send Section ─────────────────────────────────────────────────────────────

function SendSection({ emails, token }: { emails: EmailSetup[]; token: string }) {
  const [form, setForm] = useState({ from: '', to: '', subject: '', reply_to: '', html: '', text: '' })
  const [bodyTab, setBodyTab] = useState<'html' | 'text'>('html')
  const [result, setResult] = useState<{ ok: boolean; data: unknown } | null>(null)
  const [sending, setSending] = useState(false)
  const first = emails[0]

  const send = async () => {
    if (!first) return
    setSending(true); setResult(null)
    try {
      const res = await api.post<{ message_id: string; status: string }>(
        `/api/v1/orgs/${first.orgId}/projects/${first.project_id}/email/send`,
        { ...form, reply_to: form.reply_to || undefined }, token
      )
      setResult({ ok: true, data: res })
    } catch (e: unknown) {
      setResult({ ok: false, data: e instanceof Error ? e.message : 'Error' })
    } finally { setSending(false) }
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className="p-6 grid grid-cols-[1fr_320px] gap-6 max-w-5xl">
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-[--text-primary]">Send Email</h2>
          <p className="text-xs text-[--text-muted] mt-0.5">Compose and send a transactional email</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="From" placeholder={`hello@${first?.db_name ?? 'yourdomain.com'}`} value={form.from} onChange={f('from')} />
          <Input label="To" placeholder="user@example.com" value={form.to} onChange={f('to')} />
          <Input label="Subject" placeholder="Hello from Capsule" value={form.subject} onChange={f('subject')} className="col-span-2" />
          <Input label="Reply-To (optional)" placeholder="support@yourdomain.com" value={form.reply_to} onChange={f('reply_to')} className="col-span-2" />
        </div>
        <div>
          <div className="flex gap-0 border border-[--border] rounded-t-[--radius-sm] overflow-hidden w-fit mb-0">
            {(['html', 'text'] as const).map(t => (
              <button key={t} onClick={() => setBodyTab(t)}
                className={`px-4 py-1.5 text-xs font-medium transition-colors ${bodyTab === t ? 'bg-[--accent-dim] text-[--accent-light]' : 'text-[--text-muted] hover:text-[--text-primary]'}`}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          <textarea
            value={bodyTab === 'html' ? form.html : form.text}
            onChange={e => setForm(p => ({ ...p, [bodyTab]: e.target.value }))}
            placeholder={bodyTab === 'html' ? '<h1>Hello {{name}}!</h1>\n<p>Welcome to Capsule.</p>' : 'Hello {{name}}!\n\nWelcome to Capsule.'}
            rows={10}
            className="w-full font-mono text-xs bg-[--bg-surface] border border-t-0 border-[--border] rounded-b-[--radius-sm] rounded-tr-[--radius-sm] p-3 text-[--text-primary] placeholder:text-[--text-muted] focus:outline-none focus:border-[--border-focus] resize-y"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={send} loading={sending} disabled={!form.to || !form.subject || !first}>Send Email</Button>
          {!first && <span className="text-xs text-[--text-muted]">Configure a domain first</span>}
        </div>
        {result && (
          <div className={`rounded-[--radius] border p-3 text-xs font-mono ${result.ok ? 'bg-[--success-dim] border-[rgba(16,185,129,0.2)] text-green-300' : 'bg-[--error-dim] border-[rgba(239,68,68,0.2)] text-[--error]'}`}>
            {JSON.stringify(result.data, null, 2)}
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] p-4 space-y-3">
          <p className="text-xs font-semibold text-[--text-secondary]">cURL Example</p>
          <pre className="text-[10px] font-mono text-[--text-muted] bg-[--bg-surface] rounded-[--radius-sm] p-3 overflow-x-auto whitespace-pre-wrap">
{`curl -X POST https://capsule.app/api/v1/ \\
  orgs/{orgId}/projects/{projectId}/ \\
  email/send \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"from":"hello@domain.com",
       "to":"user@example.com",
       "subject":"Hello",
       "html":"<p>Hi!</p>"}'`}
          </pre>
        </div>
        <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] p-4 text-xs text-[--text-muted] space-y-1.5">
          <p className="font-semibold text-[--text-secondary]">Note</p>
          <p>The email API is compatible with the Resend SDK. You can use it as a drop-in replacement by pointing the base URL to your Capsule project endpoint.</p>
        </div>
      </div>
    </div>
  )
}

// ─── Logs Section ─────────────────────────────────────────────────────────────

function LogsSection({ emails, token }: { emails: EmailSetup[]; token: string }) {
  const first = emails[0]
  const { data: res } = useQuery({
    queryKey: ['email-logs', first?.id],
    queryFn: () => api.get<{ data: EmailLog[] }>(`/api/v1/orgs/${first!.orgId}/projects/${first!.project_id}/email/logs?limit=50`, token),
    enabled: !!first,
    refetchInterval: 30000,
  })
  const logs: EmailLog[] = res?.data ?? []

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h2 className="text-base font-semibold text-[--text-primary]">Logs</h2>
        <p className="text-xs text-[--text-muted] mt-0.5">Last 50 sent emails · auto-refreshes every 30s</p>
      </div>
      <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] overflow-hidden">
        {logs.length === 0 ? (
          <div className="p-10 text-center text-sm text-[--text-muted]">No emails sent yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[--border] text-[--text-muted]">
              <th className="text-left px-4 py-2.5 font-medium">From</th>
              <th className="text-left px-4 py-2.5 font-medium">To</th>
              <th className="text-left px-4 py-2.5 font-medium">Subject</th>
              <th className="text-left px-4 py-2.5 font-medium w-24">Status</th>
              <th className="text-left px-4 py-2.5 font-medium w-20">Time</th>
            </tr></thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-[--border] last:border-0 hover:bg-[--bg-overlay]">
                  <td className="px-4 py-2.5 font-mono text-[--text-muted] max-w-[140px] truncate">{log.from}</td>
                  <td className="px-4 py-2.5 font-mono text-[--text-secondary] max-w-[140px] truncate">{log.to}</td>
                  <td className="px-4 py-2.5 text-[--text-primary] max-w-[200px] truncate">{log.subject}</td>
                  <td className="px-4 py-2.5"><Badge variant={log.status === 'sent' || log.status === 'delivered' ? 'success' : 'warning'}>{log.status}</Badge></td>
                  <td className="px-4 py-2.5 text-[--text-muted]">{relativeTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Suppressions Section ─────────────────────────────────────────────────────

function SuppressionsSection({ emails, token }: { emails: EmailSetup[]; token: string }) {
  const qc = useQueryClient()
  const first = emails[0]
  const { data: res } = useQuery({
    queryKey: ['email-suppressions', first?.id],
    queryFn: () => api.get<{ data: Suppression[] }>(`/api/v1/orgs/${first!.orgId}/projects/${first!.project_id}/email/suppressions`, token),
    enabled: !!first,
  })
  const items: Suppression[] = res?.data ?? []

  const removeMut = useMutation({
    mutationFn: (email: string) => api.delete(`/api/v1/orgs/${first!.orgId}/projects/${first!.project_id}/email/suppressions/${encodeURIComponent(email)}`, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-suppressions'] }),
  })

  return (
    <div className="p-6 space-y-4 max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-[--text-primary]">Suppressions</h2>
        <p className="text-xs text-[--text-muted] mt-0.5">Addresses that have bounced or complained</p>
      </div>
      <div className="bg-[--bg-raised] border border-[--border] rounded-[--radius-lg] overflow-hidden">
        {items.length === 0 ? (
          <div className="p-10 text-center text-sm text-[--text-muted]">No suppressed addresses.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-[--border] text-[--text-muted]">
              <th className="text-left px-4 py-2.5 font-medium">Email</th>
              <th className="text-left px-4 py-2.5 font-medium w-32">Reason</th>
              <th className="text-left px-4 py-2.5 font-medium w-32">Suppressed</th>
              <th className="w-16" />
            </tr></thead>
            <tbody>
              {items.map(s => (
                <tr key={s.email} className="border-b border-[--border] last:border-0 hover:bg-[--bg-overlay]">
                  <td className="px-4 py-2.5 font-mono text-[--text-primary]">{s.email}</td>
                  <td className="px-4 py-2.5"><Badge variant={s.reason === 'BOUNCE' ? 'error' : 'warning'}>{s.reason}</Badge></td>
                  <td className="px-4 py-2.5 text-[--text-muted]">{relativeTime(s.created_at)}</td>
                  <td className="px-4 py-2.5">
                    <Button size="sm" variant="ghost" loading={removeMut.isPending} onClick={() => removeMut.mutate(s.email)}>
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function EmailPage() {
  usePageTitle('Email · Capsule')
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>('overview')

  const { data: orgsRes, isLoading: orgsLoading } = useQuery({
    queryKey: ['orgs'],
    queryFn: () => listOrgs(token),
  })
  const orgs = orgsRes?.data ?? []

  const { data: projectsRes, isLoading: projectsLoading } = useQuery({
    queryKey: ['all-projects', orgs.map(o => o.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(orgs.map(org => listProjects(token, org.id)))
      return all.flatMap((r, i) => r.data.map(p => ({ ...p, orgId: orgs[i].id })))
    },
    enabled: orgs.length > 0,
  })
  const projects = projectsRes ?? []

  const { data: emailSetups, isLoading: emailsLoading } = useQuery({
    queryKey: ['all-email-setups', projects.map(p => p.id).join(',')],
    queryFn: async () => {
      const all = await Promise.all(
        projects.map(p =>
          api.get<{ data: EmailSetup[] }>(`/api/v1/orgs/${p.orgId}/projects/${p.id}/databases`, token)
            .then(res => res.data.filter(db => db.engine === 'ses').map(db => ({ ...db, projectName: p.name, orgId: p.orgId })))
            .catch(() => [] as EmailSetup[])
        )
      )
      return all.flat()
    },
    enabled: projects.length > 0,
  })
  const emails = emailSetups ?? []

  const setupMutation = useMutation({
    mutationFn: ({ orgId, projectId, domain }: { orgId: string; projectId: string; domain: string }) =>
      api.post(`/api/v1/orgs/${orgId}/projects/${projectId}/email/setup`, { domain }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['all-email-setups'] }),
  })

  if (orgsLoading || projectsLoading || emailsLoading) return <PageSpinner />

  return (
    <div className="flex h-full min-h-0">
      <Sidebar active={section} onSelect={setSection} />
      <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
        {section === 'overview' && <OverviewSection emails={emails} token={token} />}
        {section === 'domains' && (
          <DomainsSection
            emails={emails}
            projects={projects}
            token={token}
            onAddDomain={(orgId, projectId, domain) => setupMutation.mutate({ orgId, projectId, domain })}
          />
        )}
        {section === 'send' && <SendSection emails={emails} token={token} />}
        {section === 'logs' && <LogsSection emails={emails} token={token} />}
        {section === 'suppressions' && <SuppressionsSection emails={emails} token={token} />}
      </div>
    </div>
  )
}
