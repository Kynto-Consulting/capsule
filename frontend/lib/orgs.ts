import { api } from './api'
import type { Organization, ListResponse } from './types'

export function listOrgs(token: string) {
  return api.get<ListResponse<Organization>>('/api/v1/orgs', token)
}

export function createOrg(token: string, body: { name: string; slug: string }) {
  return api.post<Organization>('/api/v1/orgs', body, token)
}

export function deleteOrg(token: string, orgId: string) {
  return api.delete<void>(`/api/v1/orgs/${orgId}`, token)
}
