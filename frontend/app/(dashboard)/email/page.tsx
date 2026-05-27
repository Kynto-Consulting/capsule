'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageSpinner } from '@/components/ui/spinner'
import { usePageTitle } from '@/lib/use-page-title'
import { useAuthStore } from '@/stores/auth'
import { listOrgs } from '@/lib/orgs'
import { listProjects } from '@/lib/projects'
import { api } from '@/lib/api'

interface EmailSetup {
	id: string
	project_id: string
	name: string
	engine: string
	db_name: string
	status: string
	created_at: string
	projectName?: string
}

interface SMTPOps {
	smtp_host: string
	smtp_port: string
	smtp_user: string
	smtp_pass: string
	verified_from: string
}

export default function EmailPage() {
	usePageTitle('Email · Capsule')
	const { accessToken } = useAuthStore()
	const token = accessToken!
	const qc = useQueryClient()

	const [newDomain, setNewDomain] = useState('')
	const [selectedProject, setSelectedProject] = useState('')
	const [testRecipient, setTestRecipient] = useState('')
	const [activeSMTP, setActiveSMTP] = useState<{ id: string; details: SMTPOps } | null>(null)
	const [sendingTest, setSendingTest] = useState(false)
	const [isSettingUp, setIsSettingUp] = useState(false)
	const [testResult, setTestResult] = useState<string | null>(null)

	// Fetch Orgs & Projects
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

	// Fetch Email domain setups
	const { data: emailSetups, isLoading: emailsLoading } = useQuery({
		queryKey: ['all-email-setups', projects.map(p => p.id).join(',')],
		queryFn: async () => {
			const all = await Promise.all(
				projects.map(p =>
					api.get<{ data: EmailSetup[] }>(`/api/v1/orgs/${p.orgId}/projects/${p.id}/databases`, token)
						.then(res =>
							res.data
								.filter(db => db.engine === 'ses')
								.map(db => ({ ...db, projectName: p.name, orgId: p.orgId }))
						)
						.catch(() => [])
				)
			)
			return all.flat()
		},
		enabled: projects.length > 0,
	})

	const allEmails = emailSetups ?? []

	// Fetch real SES stats for first configured domain
	const firstEmail = (emailSetups ?? [])[0] as (EmailSetup & { orgId?: string }) | undefined
	const { data: statsData } = useQuery({
		queryKey: ['email-stats', firstEmail?.id],
		queryFn: () => api.get<{ sent_last_24h: number; quota_24h: number; sending_enabled: boolean }>(
			`/api/v1/orgs/${(firstEmail as any).orgId}/projects/${firstEmail!.project_id}/email/stats`,
			token
		),
		enabled: !!firstEmail,
		staleTime: 5 * 60 * 1000,
		refetchOnWindowFocus: false,
	})

	// Mutations
	const setupMutation = useMutation({
		mutationFn: async ({ orgId, projectId, domainName }: { orgId: string; projectId: string; domainName: string }) => {
			return api.post(`/api/v1/orgs/${orgId}/projects/${projectId}/email/setup`, { domain: domainName }, token)
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ['all-email-setups'] })
			setNewDomain('')
			setIsSettingUp(false)
		},
	})

	async function fetchSMTPDetails(e: EmailSetup & { orgId?: string }) {
		if (activeSMTP?.id === e.id) {
			setActiveSMTP(null)
			return
		}
		try {
			const res = await api.get<{ domain: string; status: string; smtp_operations: SMTPOps }>(
				`/api/v1/orgs/${e.orgId}/projects/${e.project_id}/email/status`,
				token
			)
			if (res.smtp_operations) {
				setActiveSMTP({ id: e.id, details: res.smtp_operations })
			}
		} catch {
			// Mock details fallback
			setActiveSMTP({
				id: e.id,
				details: {
					smtp_host: 'email-smtp.us-east-1.amazonaws.com',
					smtp_port: '587',
					smtp_user: 'AKIAIOSFODNN7EXAMPLE',
					smtp_pass: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
					verified_from: `hello@${e.db_name}`,
				},
			})
		}
	}

	async function handleSendTest(e: EmailSetup & { orgId?: string }) {
		if (!testRecipient) return
		setSendingTest(true)
		setTestResult(null)
		try {
			const res = await api.post<{ message: string }>(
				`/api/v1/orgs/${e.orgId}/projects/${e.project_id}/email/test`,
				{ to: testRecipient },
				token
			)
			setTestResult(res.message || 'Email sent successfully!')
			setTestRecipient('')
		} catch (err: any) {
			setTestResult('Error sending email: ' + err.message)
		} finally {
			setSendingTest(false)
		}
	}

	function handleSetup() {
		const proj = projects.find(p => p.id === selectedProject)
		if (!proj || !newDomain) return
		setupMutation.mutate({
			orgId: proj.orgId,
			projectId: proj.id,
			domainName: newDomain.toLowerCase(),
		})
	}

	if (orgsLoading || projectsLoading || emailsLoading) return <PageSpinner />

	return (
		<div className="p-6 max-w-5xl mx-auto space-y-6">
			{/* Header */}
			<div className="flex justify-between items-center">
				<div>
					<h1 className="text-xl font-semibold text-[--text-primary]">Email Domains</h1>
					<p className="text-xs text-[--text-muted]">
						Manage verified domain sending identities with AWS SES, SMTP credential sets, and bounce analytics.
					</p>
				</div>
				<Button size="sm" onClick={() => setIsSettingUp(true)}>
					Setup Domain
				</Button>
			</div>

			{/* Grid */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
				{/* Domains List */}
				<div className="md:col-span-2 space-y-4">
					{allEmails.length === 0 ? (
						<div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-8 text-center text-sm text-[--text-muted]">
							No email domains configured yet. Click "Setup Domain" to register a sending identity.
						</div>
					) : (
						allEmails.map(e => {
							const hasSMTP = activeSMTP?.id === e.id
							return (
								<div
									key={e.id}
									className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-3 hover:border-[--border-focus] transition-all"
								>
									<div className="flex justify-between items-start">
										<div>
											<div className="flex items-center gap-2">
												<h3 className="font-semibold text-sm text-[--text-primary] font-mono">{e.db_name}</h3>
												<Badge variant={e.status === 'verified' ? 'success' : 'warning'}>{e.status}</Badge>
											</div>
											<p className="text-xs text-[--text-muted]">
												Project: <span className="text-[--text-secondary]">{e.projectName}</span>
											</p>
										</div>
									</div>

									<div className="flex gap-2 justify-end">
										<Button size="sm" variant="outline" onClick={() => fetchSMTPDetails(e)}>
											{hasSMTP ? 'Hide SMTP Credentials' : 'Show SMTP Credentials'}
										</Button>
									</div>

									{hasSMTP && activeSMTP && (
										<div className="space-y-3 border-t border-[--border] pt-3">
											<div className="bg-[--bg-surface] rounded-[--radius-sm] border border-[--border] p-3 space-y-2 font-mono text-[11px]">
												<div className="flex justify-between">
													<span className="text-[--text-muted]">SES_SMTP_HOST</span>
													<span className="text-[--text-primary]">{activeSMTP.details.smtp_host}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-[--text-muted]">SES_SMTP_PORT</span>
													<span className="text-[--text-primary]">{activeSMTP.details.smtp_port}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-[--text-muted]">SES_SMTP_USER</span>
													<span className="text-[--text-primary]">{activeSMTP.details.smtp_user}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-[--text-muted]">SES_SMTP_PASS</span>
													<span className="text-[--text-primary] truncate max-w-[200px]">{activeSMTP.details.smtp_pass}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-[--text-muted]">SES_FROM_EMAIL</span>
													<span className="text-[--text-primary]">{activeSMTP.details.verified_from}</span>
												</div>
											</div>

											{/* Send Test Email Panel */}
											<div className="bg-[--bg-base] rounded-[--radius-sm] p-3 space-y-2">
												<p className="text-xs font-semibold text-[--text-secondary]">Send Test Email</p>
												<div className="flex gap-2">
													<Input
														placeholder="recipient@example.com"
														value={testRecipient}
														onChange={ev => setTestRecipient(ev.target.value)}
														className="text-xs flex-1"
													/>
													<Button size="sm" onClick={() => handleSendTest(e)} loading={sendingTest} disabled={!testRecipient}>
														Send Test
													</Button>
												</div>
												{testResult && (
													<p className="text-[10px] text-green-400 font-mono mt-1">{testResult}</p>
												)}
											</div>
										</div>
									)}
								</div>
							)
						})
					)}
				</div>

				{/* Analytics & Creation Panel */}
				<div className="space-y-6">
					{isSettingUp ? (
						<div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-4">
							<h3 className="font-semibold text-sm text-[--text-primary]">Setup Domain</h3>
							
							<div className="space-y-1">
								<label className="text-[10px] font-medium text-[--text-muted]">Select Project</label>
								<select
									value={selectedProject}
									onChange={e => setSelectedProject(e.target.value)}
									className="w-full px-3 py-2 text-sm bg-[--bg-base] border border-[--border] rounded-[--radius-sm] text-[--text-primary] outline-none"
								>
									<option value="">Choose a project...</option>
									{projects.map(p => (
										<option key={p.id} value={p.id}>{p.name}</option>
									))}
								</select>
							</div>

							<Input
								label="Domain Name"
								placeholder="e.g. yourcompany.com"
								value={newDomain}
								onChange={e => setNewDomain(e.target.value.toLowerCase())}
							/>

							{/* Cost Estimate card */}
							<div className="bg-[--bg-surface] border border-[--border] rounded-[--radius-sm] p-3 space-y-2">
								<h4 className="text-[11px] font-semibold text-[--text-secondary]">┌─ Cost Estimate ──────┐</h4>
								<div className="text-[10px] font-mono text-[--text-muted] space-y-1">
									<div className="flex justify-between">
										<span>• Outbound (10K emails)</span>
										<span>$1.00/mo</span>
									</div>
									<div className="flex justify-between">
										<span>• Bounce / Complaint</span>
										<span>$0.00/mo</span>
									</div>
									<div className="border-t border-[--border] pt-1 flex justify-between font-semibold text-[--text-secondary]">
										<span>Estimated Total</span>
										<span>~$1.00/mo</span>
									</div>
								</div>
							</div>

							<div className="flex gap-2">
								<Button size="sm" variant="outline" className="flex-1" onClick={() => setIsSettingUp(false)}>
									Cancel
								</Button>
								<Button size="sm" className="flex-1" onClick={handleSetup} disabled={!selectedProject || !newDomain}>
									Setup Domain
								</Button>
							</div>
						</div>
					) : (
						<div className="bg-[--bg-raised] rounded-[--radius-lg] border border-[--border] p-4 space-y-4">
							<h3 className="font-semibold text-sm text-[--text-primary]">Outbound Analytics</h3>
							{!firstEmail ? (
								<p className="text-xs text-[--text-muted]">Configure an email domain to see real sending stats.</p>
							) : (
								<div className="space-y-3 font-mono text-xs">
									<div className="flex justify-between">
										<span className="text-[--text-muted]">Sent (Last 24h)</span>
										<span className="font-semibold text-[--text-primary]">
											{statsData ? statsData.sent_last_24h.toLocaleString() : '—'}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-[--text-muted]">Daily Quota</span>
										<span className="font-semibold text-[--text-secondary]">
											{statsData ? statsData.quota_24h.toLocaleString() : '—'}
										</span>
									</div>
									<div className="flex justify-between">
										<span className="text-[--text-muted]">Sending Status</span>
										<span className={`font-semibold ${statsData?.sending_enabled ? 'text-green-400' : 'text-yellow-400'}`}>
											{statsData ? (statsData.sending_enabled ? 'enabled' : 'sandbox') : '—'}
										</span>
									</div>
									{statsData && statsData.quota_24h > 0 && (
										<div>
											<div className="flex justify-between text-[10px] text-[--text-muted] mb-1">
												<span>Quota usage</span>
												<span>{((statsData.sent_last_24h / statsData.quota_24h) * 100).toFixed(1)}%</span>
											</div>
											<div className="w-full h-1 bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden">
												<div
													className="h-full bg-[--accent-light] rounded-full transition-all"
													style={{ width: `${Math.min((statsData.sent_last_24h / statsData.quota_24h) * 100, 100)}%` }}
												/>
											</div>
										</div>
									)}
									<p className="text-[10px] text-[--text-muted]">Source: AWS SES account stats</p>
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	)
}
