'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://api.tumi-ai.com' : 'http://localhost:8080')

interface User {
  id: string
  email: string
  name: string
  role: string
  avatar_url?: string
}

interface RefreshResponse {
  tokens: {
    access_token: string
    refresh_token: string
  }
}

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: User, accessToken: string, refreshToken: string) => void
  clearAuth: () => void
  refreshSession: () => Promise<string | null>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      clearAuth: () =>
        set({ user: null, accessToken: null, refreshToken: null }),
      refreshSession: async () => {
        const { refreshToken, clearAuth } = get()
        if (!refreshToken) {
          clearAuth()
          return null
        }
        try {
          const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          })
          if (!res.ok) {
            clearAuth()
            return null
          }
          const data: RefreshResponse = await res.json()
          set({
            accessToken: data.tokens.access_token,
            refreshToken: data.tokens.refresh_token,
          })
          return data.tokens.access_token
        } catch {
          clearAuth()
          return null
        }
      },
    }),
    { name: 'capsule-auth' }
  )
)
