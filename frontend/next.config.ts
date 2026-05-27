import type { NextConfig } from 'next'

const BACKEND_INTERNAL = process.env.BACKEND_INTERNAL_URL ?? 'http://capsule-backend:8080'

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async rewrites() {
    // beforeFiles = run BEFORE route matching, so subdomain traffic never
    // hits the dashboard pages.
    return {
      beforeFiles: [
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
      ],
      afterFiles: [],
      fallback: [],
    }
  },
}

export default nextConfig
