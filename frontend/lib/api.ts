const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === 'production' ? 'https://api.tumi-ai.com' : 'http://localhost:8080')

class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'APIError'
  }
}

let refreshCallback: (() => Promise<string | null>) | null = null

export function setRefreshCallback(fn: () => Promise<string | null>): void {
  refreshCallback = fn
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  _retried = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    if (res.status === 401 && !_retried && refreshCallback !== null) {
      const cb = refreshCallback
      const newToken = await cb()
      if (newToken !== null) {
        return request<T>(method, path, body, newToken, true)
      }
      // Refresh failed — clear the callback so we don't loop
      refreshCallback = null
    }

    const err = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }))
    throw new APIError(res.status, err.error?.code ?? 'UNKNOWN', err.error?.message ?? res.statusText)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string, token?: string) => request<T>('GET', path, undefined, token),
  post: <T>(path: string, body: unknown, token?: string) => request<T>('POST', path, body, token),
  put: <T>(path: string, body: unknown, token?: string) => request<T>('PUT', path, body, token),
  patch: <T>(path: string, body: unknown, token?: string) => request<T>('PATCH', path, body, token),
  delete: <T>(path: string, token?: string) => request<T>('DELETE', path, undefined, token),
}

export { APIError }
