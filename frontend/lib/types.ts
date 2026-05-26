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

export interface Deployment {
  id: string
  project_id: string
  server_id?: string
  version: string
  git_sha?: string
  status: string
  image_tag?: string
  build_strategy?: string
  trigger: string
  triggered_by?: string
  started_at?: string
  completed_at?: string
  created_at: string
}

export interface BuildLog {
  id: string
  deployment_id: string
  level: string
  message: string
  created_at: string
}

export interface EnvVar {
  id: string
  project_id: string
  key: string
  value: string
  is_secret: boolean
  scope: string
}

export interface ListResponse<T> {
  data: T[]
  meta: { page: number; per_page: number; total: number }
}

export interface Database {
  id: string
  project_id: string
  name: string
  engine: string
  version: string
  host: string
  port: number
  db_name: string
  status: string
  size_mb: number
  connection_url?: string
  created_at: string
  updated_at: string
}

export interface DomainRecord {
  id: string
  project_id: string
  domain_name: string
  record_type: string
  record_value: string
  status: string
  ssl_enabled: boolean
  dns_provider: string
  verified_at?: string
  created_at: string
  updated_at: string
}
