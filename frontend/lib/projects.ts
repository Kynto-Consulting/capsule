import { api } from './api'
import type { Project, ListResponse } from './types'

export interface CreateProjectBody {
  name: string
  slug: string
  repo_url?: string
  branch?: string
  build_strategy?: string
  runtime?: string
  serverless?: boolean
  replicas?: number
}

export function listProjects(token: string, orgId: string) {
  return api.get<ListResponse<Project>>(`/api/v1/orgs/${orgId}/projects`, token)
}

export function createProject(token: string, orgId: string, body: CreateProjectBody) {
  return api.post<Project>(`/api/v1/orgs/${orgId}/projects`, body, token)
}

export function deleteProject(token: string, orgId: string, projectId: string) {
  return api.delete<void>(`/api/v1/orgs/${orgId}/projects/${projectId}`, token)
}
