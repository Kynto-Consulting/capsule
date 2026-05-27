'use client'

import { useEffect } from 'react'
import { setRefreshCallback } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

/**
 * Registers the token-refresh callback with the API client once on mount.
 * Must be rendered inside a component tree that has access to the auth store
 * (i.e. after Zustand hydration). Place it in the dashboard layout so it is
 * only active for authenticated pages.
 */
export function RefreshSetup() {
  useEffect(() => {
    setRefreshCallback(() => useAuthStore.getState().refreshSession())
  }, [])

  return null
}
