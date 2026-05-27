'use client'

import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/lib/use-page-title'

export default function SettingsPage() {
	usePageTitle('Settings · Capsule')
	const router = useRouter()
	const { user, accessToken, refreshToken, clearAuth } = useAuthStore()

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
		<div className="p-6 max-w-2xl mx-auto space-y-6">
			<div>
				<h1 className="text-xl font-semibold text-[--text-primary]">Settings</h1>
				<p className="text-xs text-[--text-muted]">Manage your account and preferences.</p>
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
