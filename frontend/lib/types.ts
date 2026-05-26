export interface User {
  id: string
  email: string
  name: string
  role: string
  avatar_url?: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  owner_id: string
  plan: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  org_id: string
  name: string
  slug: string
  repo_url: string
  branch: string
  build_strategy: string
  runtime: string
  serverless: boolean
  replicas: number
  status: string
  labels: string[]
  created_at: string
  updated_at: string
}

export interface ListResponse<T> {
  data: T[]
  meta: { page: number; per_page: number; total: number }
}
