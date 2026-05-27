'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIModelPricing {
  input_per_1k_tokens: number
  output_per_1k_tokens: number
}

interface AIModel {
  id: string
  name: string
  provider: string
  bedrock_id: string
  description: string
  context_window: number
  max_output: number
  pricing: AIModelPricing
  capabilities: {
    text_generation: boolean
    code_generation: boolean
    vision_analysis: boolean
    function_calling: boolean
    streaming: boolean
  }
  tags: string[]
}

interface APIKey {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at?: string
  usage_count: number
  rate_limit_rpm: number
  ip_allowlist: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

type ActiveTab = 'playground' | 'models' | 'keys'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtContextWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M tokens`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K tokens`
  return `${n} tokens`
}

function fmtPrice(price: number): string {
  return `$${price.toFixed(3)}`
}

const PROVIDER_COLORS: Record<string, string> = {
  anthropic: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  amazon: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  meta: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  mistral: 'bg-green-500/15 text-green-300 border-green-500/25',
}

function ProviderBadge({ provider }: { provider: string }) {
  const cls = PROVIDER_COLORS[provider.toLowerCase()] ?? 'bg-[--bg-overlay] text-[--text-secondary] border-[--border]'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full border capitalize ${cls}`}>
      {provider}
    </span>
  )
}

const EXAMPLE_PROMPTS = [
  'Explain my Dockerfile and suggest improvements',
  'What\'s the best way to set up a Node.js app for production?',
  'Generate a docker-compose.yml for a full-stack app with postgres and redis',
  'Analyze costs: I have 3 apps, 2 databases, 1 S3 bucket',
]

// ─── Tab Nav ─────────────────────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: ActiveTab; onChange: (t: ActiveTab) => void }) {
  const tabs: { id: ActiveTab; label: string }[] = [
    { id: 'playground', label: 'Playground' },
    { id: 'models', label: 'Models' },
    { id: 'keys', label: 'API Keys' },
  ]
  return (
    <div className="flex bg-[--bg-raised] rounded-[--radius-sm] p-0.5 border border-[--border]">
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
            active === t.id
              ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary]'
              : 'text-[--text-muted] hover:text-[--text-secondary]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Playground Tab ───────────────────────────────────────────────────────────

function PlaygroundTab({
  token,
  onSwitchToModels,
}: {
  token: string
  onSwitchToModels: () => void
}) {
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! I\'m your Capsule AI Assistant. Ask me about Dockerfiles, infrastructure setup, cost optimization, or anything else.' },
  ])
  const [isSending, setIsSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: modelsRes, isLoading: modelsLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<{ data: AIModel[] }>('/api/v1/ai/models', token),
  })
  const models = modelsRes?.data ?? []

  useEffect(() => {
    if (models.length > 0 && !selectedModelId) {
      setSelectedModelId(models[0].id)
    }
  }, [models, selectedModelId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const selectedModel = models.find(m => m.id === selectedModelId)

  async function handleSend() {
    if (!chatInput.trim() || isSending) return
    const prompt = chatInput
    setChatInput('')
    const nextHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }]
    setChatHistory(nextHistory)
    setIsSending(true)
    try {
      const res = await api.post<{ choices: Array<{ message: { content: string } }> }>(
        '/api/v1/ai/chat',
        {
          model: selectedModelId || 'nova-lite',
          messages: nextHistory.map(h => ({ role: h.role, content: h.content })),
        },
        token
      )
      const reply = res.choices?.[0]?.message?.content ?? 'Received an empty response.'
      setChatHistory(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setChatHistory(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Left panel — chat */}
      <div className="flex-1 flex flex-col min-h-0 bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] overflow-hidden" style={{ flex: '2 1 0%' }}>
        {/* Model selector */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[--border] bg-[--bg-surface] flex-shrink-0">
          <span className="text-xs text-[--text-muted] font-medium">Model:</span>
          {modelsLoading ? (
            <span className="text-xs text-[--text-muted]">Loading…</span>
          ) : (
            <select
              value={selectedModelId}
              onChange={e => setSelectedModelId(e.target.value)}
              className="text-xs font-semibold bg-[--bg-raised] border border-[--border] text-[--text-primary] rounded-full px-3 py-1 focus:outline-none focus:border-[--border-focus] cursor-pointer"
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.provider})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-[--radius-lg] px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[--accent] text-white font-medium'
                    : 'bg-[--bg-surface] text-[--text-primary] border border-[--border] whitespace-pre-wrap'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isSending && (
            <div className="flex justify-start">
              <div className="bg-[--bg-surface] border border-[--border] rounded-[--radius-lg] px-4 py-3">
                <span className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <span key={i} className="w-1.5 h-1.5 bg-[--text-muted] rounded-full animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Input */}
        <div className="border-t border-[--border] p-3 flex gap-2 items-center flex-shrink-0 bg-[--bg-surface]">
          <Input
            placeholder="Ask about Dockerfiles, infrastructure, cost estimations…"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            className="flex-1 text-xs"
            disabled={isSending}
          />
          <Button size="sm" onClick={handleSend} loading={isSending} disabled={!chatInput.trim()}>
            Send
          </Button>
        </div>
      </div>

      {/* Right panel — info + examples */}
      <div className="flex flex-col gap-4 overflow-y-auto" style={{ flex: '1 1 0%', minWidth: 0 }}>
        {/* Model Info */}
        {selectedModel ? (
          <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-[--text-primary] leading-tight">{selectedModel.name}</h3>
              <ProviderBadge provider={selectedModel.provider} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="bg-[--bg-surface] rounded-[--radius-sm] p-2 border border-[--border]">
                <p className="text-[--text-muted] mb-0.5">Context</p>
                <p className="text-[--text-primary] font-semibold">{fmtContextWindow(selectedModel.context_window)}</p>
              </div>
              <div className="bg-[--bg-surface] rounded-[--radius-sm] p-2 border border-[--border]">
                <p className="text-[--text-muted] mb-0.5">Max output</p>
                <p className="text-[--text-primary] font-semibold">{fmtContextWindow(selectedModel.max_output)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: 'text_generation', label: 'Text', icon: '📝' },
                  { key: 'code_generation', label: 'Code', icon: '💻' },
                  { key: 'vision_analysis', label: 'Vision', icon: '👁' },
                  { key: 'function_calling', label: 'Functions', icon: '⚙' },
                ] as const
              ).map(cap => {
                const enabled = selectedModel.capabilities[cap.key]
                return (
                  <span
                    key={cap.key}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border font-medium ${
                      enabled
                        ? 'bg-[--accent-dim] text-[--accent-light] border-[--border-strong]'
                        : 'bg-[--bg-overlay] text-[--text-muted] border-[--border] opacity-40'
                    }`}
                  >
                    <span>{cap.icon}</span>{cap.label}
                  </span>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 text-xs text-[--text-muted] text-center">
            Select a model to view details
          </div>
        )}

        {/* Example prompts */}
        <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-2">
          <h4 className="text-[10px] font-semibold text-[--text-muted] uppercase tracking-wider mb-2">Example prompts</h4>
          {EXAMPLE_PROMPTS.map((prompt, i) => (
            <button
              key={i}
              onClick={() => setChatInput(prompt)}
              className="w-full text-left text-xs text-[--text-secondary] bg-[--bg-surface] border border-[--border] rounded-[--radius-sm] px-3 py-2 hover:bg-[--bg-overlay] hover:text-[--text-primary] hover:border-[--border-strong] transition-colors leading-snug"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Models Tab ───────────────────────────────────────────────────────────────

function ModelsTab({
  token,
  onUseModel,
}: {
  token: string
  onUseModel: (modelId: string) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: modelsRes, isLoading } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => api.get<{ data: AIModel[] }>('/api/v1/ai/models', token),
  })
  const models = modelsRes?.data ?? []

  if (isLoading) return <PageSpinner />

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {models.map(m => {
          const isExpanded = expandedId === m.id
          return (
            <div key={m.id} className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-3 flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-[--text-primary]">{m.name}</h3>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    <ProviderBadge provider={m.provider} />
                    {m.tags.map(tag => (
                      <span key={tag} className="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-[--bg-overlay] text-[--text-muted] border border-[--border]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description */}
              <p className={`text-xs text-[--text-secondary] leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                {m.description}
              </p>
              {m.description.length > 80 && (
                <button
                  onClick={() => setExpandedId(isExpanded ? null : m.id)}
                  className="text-[10px] text-[--accent-light] hover:opacity-80 transition-opacity self-start -mt-1"
                >
                  {isExpanded ? 'Show less' : 'Show more'}
                </button>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="bg-[--bg-surface] rounded-[--radius-sm] p-2 border border-[--border]">
                  <p className="text-[--text-muted]">Context window</p>
                  <p className="text-[--text-primary] font-semibold mt-0.5">{fmtContextWindow(m.context_window)}</p>
                </div>
                <div className="bg-[--bg-surface] rounded-[--radius-sm] p-2 border border-[--border]">
                  <p className="text-[--text-muted]">Max output</p>
                  <p className="text-[--text-primary] font-semibold mt-0.5">{fmtContextWindow(m.max_output)}</p>
                </div>
              </div>

              {/* Pricing */}
              <p className="text-[10px] text-[--text-muted]">
                Input: <span className="text-[--text-secondary] font-medium">{fmtPrice(m.pricing.input_per_1k_tokens)} / 1K tokens</span>
                {' · '}
                Output: <span className="text-[--text-secondary] font-medium">{fmtPrice(m.pricing.output_per_1k_tokens)} / 1K tokens</span>
              </p>

              {/* Capabilities */}
              <div className="flex gap-2">
                {(
                  [
                    { key: 'text_generation', label: 'Text', icon: '📝' },
                    { key: 'code_generation', label: 'Code', icon: '💻' },
                    { key: 'vision_analysis', label: 'Vision', icon: '👁' },
                    { key: 'function_calling', label: 'Functions', icon: '⚙' },
                  ] as const
                ).map(cap => {
                  const enabled = m.capabilities[cap.key]
                  return (
                    <span
                      key={cap.key}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border font-medium ${
                        enabled
                          ? 'bg-[--accent-dim] text-[--accent-light] border-[--border-strong]'
                          : 'bg-[--bg-overlay] text-[--text-muted] border-[--border] opacity-40'
                      }`}
                    >
                      <span>{cap.icon}</span>{cap.label}
                    </span>
                  )
                })}
              </div>

              {/* Action */}
              <div className="pt-1 mt-auto">
                <Button variant="outline" size="sm" className="w-full" onClick={() => onUseModel(m.id)}>
                  Use in Playground
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────

function APIKeysTab({ token }: { token: string }) {
  const qc = useQueryClient()
  const [newKeyName, setNewKeyName] = useState('')
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null)
  const [expandedKeyId, setExpandedKeyId] = useState<string | null>(null)
  const [editState, setEditState] = useState<Record<string, { rate_limit_rpm: string; ip_allowlist: string }>>({})
  const [copied, setCopied] = useState(false)

  const { data: keysRes, isLoading } = useQuery({
    queryKey: ['ai-keys'],
    queryFn: () => api.get<{ data: APIKey[] }>('/api/v1/ai/keys', token),
  })
  const keys = keysRes?.data ?? []

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<{ name: string; key: string }>('/api/v1/ai/keys', { name }, token),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['ai-keys'] })
      setCreatedKey(data)
      setNewKeyName('')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, rate_limit_rpm, ip_allowlist }: { id: string; rate_limit_rpm: number; ip_allowlist: string }) =>
      api.patch(`/api/v1/ai/keys/${id}`, { rate_limit_rpm, ip_allowlist }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-keys'] }),
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/ai/keys/${id}`, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-keys'] }),
  })

  function startEdit(k: APIKey) {
    setEditState(prev => ({
      ...prev,
      [k.id]: { rate_limit_rpm: String(k.rate_limit_rpm), ip_allowlist: k.ip_allowlist ?? '' },
    }))
    setExpandedKeyId(k.id)
  }

  function saveEdit(id: string) {
    const s = editState[id]
    if (!s) return
    updateMutation.mutate({
      id,
      rate_limit_rpm: parseInt(s.rate_limit_rpm, 10) || 0,
      ip_allowlist: s.ip_allowlist.trim().split('\n').filter(Boolean).join(','),
    })
    setExpandedKeyId(null)
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
        {/* Key list */}
        <div className="md:col-span-2 space-y-3">
          {isLoading ? (
            <PageSpinner />
          ) : keys.length === 0 ? (
            <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-8 text-center text-sm text-[--text-muted]">
              No API keys yet. Generate one to get started.
            </div>
          ) : (
            keys.map(k => (
              <div key={k.id} className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] overflow-hidden">
                <div className="p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[--text-primary] truncate">{k.name}</h3>
                    <p className="text-[10px] font-mono text-[--text-muted] mt-0.5">
                      <span className="text-[--text-secondary]">{k.prefix}</span>…
                      <span className="mx-2 opacity-40">|</span>
                      Created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at && (
                        <> · Last used {new Date(k.last_used_at).toLocaleDateString()}</>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge variant="default">{k.usage_count} requests</Badge>
                      {k.rate_limit_rpm > 0 && (
                        <Badge variant="warning">RPM: {k.rate_limit_rpm}</Badge>
                      )}
                      {k.ip_allowlist && k.ip_allowlist.length > 0 && (
                        <Badge variant="info">IP filtered</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => expandedKeyId === k.id ? setExpandedKeyId(null) : startEdit(k)}
                    >
                      Settings
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(k.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>

                {/* Expanded settings */}
                {expandedKeyId === k.id && editState[k.id] && (
                  <div className="border-t border-[--border] bg-[--bg-surface] p-4 space-y-3">
                    <Input
                      label="Rate Limit (RPM)"
                      type="number"
                      placeholder="0 = unlimited"
                      value={editState[k.id].rate_limit_rpm}
                      onChange={e => setEditState(prev => ({ ...prev, [k.id]: { ...prev[k.id], rate_limit_rpm: e.target.value } }))}
                    />
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-[--text-secondary] uppercase tracking-wider">IP Allowlist</label>
                      <textarea
                        rows={3}
                        placeholder="Leave blank to allow all IPs&#10;One IP per line"
                        value={editState[k.id].ip_allowlist}
                        onChange={e => setEditState(prev => ({ ...prev, [k.id]: { ...prev[k.id], ip_allowlist: e.target.value } }))}
                        className="w-full rounded-[--radius] text-xs bg-[--bg-surface] text-[--text-primary] border border-[--border] placeholder:text-[--text-muted] focus:outline-none focus:border-[--border-focus] focus:shadow-[0_0_0_3px_var(--accent-dim)] p-3 resize-none transition-all duration-150"
                      />
                    </div>
                    <Button size="sm" onClick={() => saveEdit(k.id)} loading={updateMutation.isPending}>
                      Save changes
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Sidebar — create + integration guide */}
        <div className="space-y-4">
          {/* Create key */}
          <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[--text-primary]">Generate API Key</h3>
            <Input
              label="Key Name"
              placeholder="e.g. production-server"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newKeyName && createMutation.mutate(newKeyName)}
            />
            <Button
              className="w-full"
              size="sm"
              onClick={() => createMutation.mutate(newKeyName)}
              loading={createMutation.isPending}
              disabled={!newKeyName.trim()}
            >
              Generate
            </Button>

            {createdKey && (
              <div className="bg-green-950/20 border border-green-500/30 rounded-[--radius-sm] p-3 space-y-2">
                <p className="text-green-400 font-semibold text-xs">Key generated!</p>
                <p className="text-[9px] text-[--text-muted] leading-relaxed">
                  Copy this now — it will never be shown again.
                </p>
                <div className="bg-black/50 rounded-[--radius-xs] p-2 font-mono text-[10px] text-[--text-primary] break-all select-all">
                  {createdKey.key}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => copyKey(createdKey.key)}>
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" onClick={() => setCreatedKey(null)}>
                    Done
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Integration guide */}
          <div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-3">
            <h3 className="text-sm font-semibold text-[--text-primary]">Integration Guide</h3>
            <p className="text-xs text-[--text-muted] leading-relaxed">
              Compatible with any OpenAI SDK — just change the{' '}
              <code className="text-[--accent-light] font-mono text-[10px]">base_url</code> and{' '}
              <code className="text-[--accent-light] font-mono text-[10px]">api_key</code>.
            </p>
            <div className="bg-black rounded-[--radius-sm] p-3 text-[10px] font-mono leading-relaxed overflow-x-auto">
              <div>
                <span className="text-[#c586c0]">from</span>
                <span className="text-[#d4d4d4]"> openai </span>
                <span className="text-[#c586c0]">import</span>
                <span className="text-[#d4d4d4]"> OpenAI</span>
              </div>
              <div className="mt-1">
                <span className="text-[#9cdcfe]">client</span>
                <span className="text-[#d4d4d4]"> = OpenAI(</span>
              </div>
              <div className="ml-4">
                <span className="text-[#9cdcfe]">api_key</span>
                <span className="text-[#d4d4d4]">=</span>
                <span className="text-[#ce9178]">&quot;YOUR_CSK_KEY&quot;</span>
                <span className="text-[#d4d4d4]">,</span>
              </div>
              <div className="ml-4">
                <span className="text-[#9cdcfe]">base_url</span>
                <span className="text-[#d4d4d4]">=</span>
                <span className="text-[#ce9178]">&quot;https://api.tumi-ai.com/api/v1/ai&quot;</span>
              </div>
              <div>
                <span className="text-[#d4d4d4]">)</span>
              </div>
              <div className="mt-1">
                <span className="text-[#9cdcfe]">response</span>
                <span className="text-[#d4d4d4]"> = client.chat.completions.create(</span>
              </div>
              <div className="ml-4">
                <span className="text-[#9cdcfe]">model</span>
                <span className="text-[#d4d4d4]">=</span>
                <span className="text-[#ce9178]">&quot;nova-lite&quot;</span>
                <span className="text-[#d4d4d4]">,</span>
              </div>
              <div className="ml-4">
                <span className="text-[#9cdcfe]">messages</span>
                <span className="text-[#d4d4d4]">=[&#123;</span>
                <span className="text-[#ce9178]">&quot;role&quot;</span>
                <span className="text-[#d4d4d4]">: </span>
                <span className="text-[#ce9178]">&quot;user&quot;</span>
                <span className="text-[#d4d4d4]">, </span>
                <span className="text-[#ce9178]">&quot;content&quot;</span>
                <span className="text-[#d4d4d4]">: </span>
                <span className="text-[#ce9178]">&quot;Hello!&quot;</span>
                <span className="text-[#d4d4d4]">&#125;]</span>
              </div>
              <div>
                <span className="text-[#d4d4d4]">)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIPage() {
  const { accessToken } = useAuthStore()
  const token = accessToken!
  const [activeTab, setActiveTab] = useState<ActiveTab>('playground')
  const [playgroundModelId, setPlaygroundModelId] = useState<string>('')

  function handleUseModel(modelId: string) {
    setPlaygroundModelId(modelId)
    setActiveTab('playground')
  }

  return (
    <div className="p-6 max-w-6xl mx-auto flex flex-col h-[calc(100vh-3.5rem)] gap-5">
      {/* Header */}
      <div className="flex justify-between items-center flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-[--text-primary]">AI & Keys</h1>
          <p className="text-xs text-[--text-muted]">
            Chat with AI models, browse the model catalog, or manage API keys for OpenAI-compatible integrations.
          </p>
        </div>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>

      {activeTab === 'playground' && (
        <PlaygroundTab
          token={token}
          onSwitchToModels={() => setActiveTab('models')}
        />
      )}
      {activeTab === 'models' && (
        <ModelsTab token={token} onUseModel={handleUseModel} />
      )}
      {activeTab === 'keys' && (
        <APIKeysTab token={token} />
      )}
    </div>
  )
}
