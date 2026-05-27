import type { NextConfig } from 'next'

const BACKEND_INTERNAL = process.env.BACKEND_INTERNAL_URL ?? 'http://capsule-backend:8080'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    return [
      // ── Apps subdomain proxy ──────────────────────────────────────────────
      // *.apps.tumi-ai.com/* → backend /_proxy/{subdomain}/*
      {
        source: '/:path+',
        has: [{ type: 'host', value: '(?<subdomain>[^.]+)\\.apps\\.tumi-ai\\.com' }],
        destination: `${BACKEND_INTERNAL}/_proxy/:subdomain/:path+`,
      },
      {
        source: '/',
        has: [{ type: 'host', value: '(?<subdomain>[^.]+)\\.apps\\.tumi-ai\\.com' }],
        destination: `${BACKEND_INTERNAL}/_proxy/:subdomain/`,
      },
    ]
  },
}

export default nextConfig
