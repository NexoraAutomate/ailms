const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {}
  try {
    const token = localStorage.getItem('ailms_access_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

function redirectToLogin() {
  if (typeof window === 'undefined') return
  const path = window.location.pathname
  if (path.startsWith('/login') || path.startsWith('/signup')) return
  try {
    localStorage.removeItem('ailms_access_token')
    localStorage.removeItem('ailms_auth_user')
    document.cookie = 'ailms_auth=; path=/; max-age=0; SameSite=Lax'
  } catch {
    /* ignore */
  }
  const next = encodeURIComponent(path + window.location.search)
  window.location.href = `/login?next=${next}`
}

async function parseError(response: Response): Promise<string> {
  let detail = `Request failed (${response.status})`
  try {
    const body = await response.json()
    detail = body.detail ?? detail
  } catch {
    /* keep default */
  }
  return typeof detail === 'string' ? detail : JSON.stringify(detail)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isAuthEndpoint = path.startsWith('/api/auth/login') || path.startsWith('/api/auth/signup')
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    credentials: 'include',
  })
  if (response.status === 401 && !isAuthEndpoint) {
    redirectToLogin()
    throw new Error('Not authenticated')
  }
  if (!response.ok) {
    throw new Error(await parseError(response))
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
    credentials: 'include',
  })
  if (response.status === 401) {
    redirectToLogin()
    throw new Error('Not authenticated')
  }
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  return response.blob()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: async <T>(path: string, form: FormData) => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: form,
      cache: 'no-store',
      credentials: 'include',
      headers: { ...authHeaders() },
    })
    if (response.status === 401) {
      redirectToLogin()
      throw new Error('Not authenticated')
    }
    if (!response.ok) {
      throw new Error(await parseError(response))
    }
    return response.json() as Promise<T>
  },
  download: (path: string) => requestBlob(path),
}
