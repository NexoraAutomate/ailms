const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  if (!response.ok) {
    let detail = `Request failed (${response.status})`
    try {
      const body = await response.json()
      detail = body.detail ?? detail
    } catch {
      /* keep default */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  return response.blob()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: async <T>(path: string, form: FormData) => {
    const response = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, cache: 'no-store' })
    if (!response.ok) {
      let detail = `Request failed (${response.status})`
      try {
        const body = await response.json()
        detail = body.detail ?? detail
      } catch {
        /* keep default */
      }
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    }
    return response.json() as Promise<T>
  },
  download: (path: string) => requestBlob(path),
}
