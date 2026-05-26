'use client'

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/spinner'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'

interface APIKey {
	id: string
	name: string
	prefix: string
	last_used_at?: string
	created_at: string
}

interface ChatMessage {
	role: 'user' | 'assistant'
	content: string
}

export default function AIPage() {
	const { accessToken } = useAuthStore()
	const token = accessToken!
	const qc = useQueryClient()

	const [activeTab, setActiveTab] = useState<'chat' | 'keys'>('chat')
	const [chatInput, setChatInput] = useState('')
	const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
		{ role: 'assistant', content: 'Hi there! I am your Capsule Bedrock Assistant. I can help you configure Dockerfiles, analyze build failures, suggest cost optimizations, or verify Route53 setups. Ask me anything!' },
	])
	const [isSending, setIsSending] = useState(false)
	const [newKeyName, setNewKeyName] = useState('')
	const [createdKeyPlain, setCreatedKeyPlain] = useState<{ name: string; key: string } | null>(null)
	const [generatingKey, setGeneratingKey] = useState(false)

	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [chatHistory])

	// Fetch API Keys
	const { data: keysRes, isLoading: keysLoading } = useQuery({
		queryKey: ['api-keys'],
		queryFn: () => api.get<{ data: APIKey[] }>('/api/v1/ai/keys', token),
		enabled: activeTab === 'keys',
	})
	const keys = keysRes?.data ?? []

	// Mutations
	const createKeyMutation = useMutation({
		mutationFn: async (name: string) => {
			return api.post<{ name: string; key: string }>('/api/v1/ai/keys', { name }, token)
		},
		onSuccess: (data) => {
			qc.invalidateQueries({ queryKey: ['api-keys'] })
			setCreatedKeyPlain(data)
			setNewKeyName('')
			setGeneratingKey(false)
		},
	})

	const revokeKeyMutation = useMutation({
		mutationFn: async (id: string) => {
			return api.delete(`/api/v1/ai/keys/${id}`, token)
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['api-keys'] })
		},
	})

	async function handleSendChat() {
		if (!chatInput.trim()) return
		const prompt = chatInput
		setChatHistory(prev => [...prev, { role: 'user', content: prompt }])
		setChatInput('')
		setIsSending(true)

		try {
			const res = await api.post<{ choices: Array<{ message: { content: string } }> }>(
				'/api/v1/ai/chat',
				{
					model: 'claude-haiku-4.5',
					messages: [
						...chatHistory.map(h => ({ role: h.role, content: h.content })),
						{ role: 'user', content: prompt },
					],
				},
				token
			)
			const reply = res.choices?.[0]?.message?.content || 'Received empty response from assistant.'
			setChatHistory(prev => [...prev, { role: 'assistant', content: reply }])
		} catch (err: any) {
			setChatHistory(prev => [...prev, { role: 'assistant', content: 'Error querying AI assistant: ' + err.message }])
		} finally {
			setIsSending(false)
		}
	}

	function handleCreateKey() {
		if (!newKeyName) return
		createKeyMutation.mutate(newKeyName)
	}

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-6 flex flex-col h-[calc(100vh-3.5rem)]">
			{/* Header */}
			<div className="flex justify-between items-center flex-shrink-0">
				<div>
					<h1 className="text-xl font-semibold text-[--text-primary]">AI & Keys</h1>
					<p className="text-xs text-[--text-muted]">
						Interact with Capsule Bedrock AI proxy or generate keys for OpenAI-compatible client integrations.
					</p>
				</div>

				{/* Tabs */}
				<div className="flex bg-[--bg-raised] rounded-[--radius-sm] p-0.5 border border-[--border]">
					<button
						onClick={() => setActiveTab('chat')}
						className={`px-3 py-1.5 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
							activeTab === 'chat' ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary]' : 'text-[--text-muted] hover:text-[--text-secondary]'
						}`}
					>
						Chat Assistant
					</button>
					<button
						onClick={() => setActiveTab('keys')}
						className={`px-3 py-1.5 text-xs font-semibold rounded-[--radius-xs] transition-colors ${
							activeTab === 'keys' ? 'bg-[rgba(255,255,255,0.06)] text-[--text-primary]' : 'text-[--text-muted] hover:text-[--text-secondary]'
						}`}
					>
						API Tokens
					</button>
				</div>
			</div>

			{activeTab === 'chat' ? (
				/* Interactive AI Chat console */
				<div className="flex-1 flex flex-col min-h-0 bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] overflow-hidden">
					{/* Message Area */}
					<div className="flex-1 overflow-y-auto p-4 space-y-4">
						{chatHistory.map((msg, i) => (
							<div
								key={i}
								className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
							>
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
						<div ref={scrollRef} />
					</div>

					{/* Chat Prompt */}
					<div className="border-t border-[--border] p-3 flex gap-2 items-center flex-shrink-0 bg-[--bg-surface]">
						<Input
							placeholder="Ask about your Capsule infrastructure, Dockerfiles, or cost estimation..."
							value={chatInput}
							onChange={e => setChatInput(e.target.value)}
							onKeyDown={e => e.key === 'Enter' && handleSendChat()}
							className="flex-1 text-xs"
							disabled={isSending}
						/>
						<Button size="sm" onClick={handleSendChat} loading={isSending} disabled={!chatInput.trim()}>
							Send
						</Button>
					</div>
				</div>
			) : (
				/* API Tokens Manager */
				<div className="flex-1 overflow-y-auto space-y-6">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
						{/* Active keys */}
						<div className="md:col-span-2 space-y-4">
							{keysLoading ? (
								<PageSpinner />
							) : keys.length === 0 ? (
								<div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-8 text-center text-sm text-[--text-muted]">
									No API keys created yet. Generate one in the panel to authorize external clients.
								</div>
							) : (
								keys.map(k => (
									<div
										key={k.id}
										className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 flex justify-between items-center"
									>
										<div>
											<h3 className="font-semibold text-sm text-[--text-primary]">{k.name}</h3>
											<p className="text-[10px] text-[--text-muted] font-mono mt-1">
												Prefix: <span className="text-[--text-secondary]">{k.prefix}</span> | ID: {k.id}
											</p>
											{k.last_used_at && (
												<p className="text-[9px] text-[--text-muted] font-mono">
													Last used: {new Date(k.last_used_at).toLocaleDateString()}
												</p>
											)}
										</div>
										<button
											onClick={() => revokeKeyMutation.mutate(k.id)}
											className="text-xs text-[--danger] hover:opacity-80 transition-opacity"
										>
											Revoke
										</button>
									</div>
								))
							)}
						</div>

						{/* Create key sidebar panel */}
						<div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-4">
							<h3 className="font-semibold text-sm text-[--text-primary]">Generate API Token</h3>
							<Input
								label="Key Name"
								placeholder="e.g. production-server"
								value={newKeyName}
								onChange={e => setNewKeyName(e.target.value)}
							/>
							<Button size="sm" className="w-full" onClick={handleCreateKey} loading={createKeyMutation.isPending} disabled={!newKeyName}>
								Generate
							</Button>

							{createdKeyPlain && (
								<div className="bg-green-950/20 border border-green-500/30 rounded-[--radius-sm] p-3 space-y-2 font-mono text-[10px]">
									<p className="text-green-400 font-semibold text-xs mb-1">Key Generated!</p>
									<p className="text-[9px] text-[--text-muted] leading-relaxed mb-2">
										Copy this token now. For safety, it will never be displayed in plain text again:
									</p>
									<div className="bg-black/40 rounded p-2 select-all break-all text-[--text-primary]">
										{createdKeyPlain.key}
									</div>
									<Button size="sm" variant="outline" className="w-full mt-1 text-[9px] h-6" onClick={() => setCreatedKeyPlain(null)}>
										Done
									</Button>
								</div>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
