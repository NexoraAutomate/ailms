const TOKEN_KEY = 'ailms_access_token'
const USER_KEY = 'ailms_auth_user'
const COOKIE_NAME = 'ailms_auth'

export type AuthUser = {
  id: number
  name: string
  username: string
  role: string
  department: string
  email: string
  status: string
  initials: string
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function setAuthSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  // Non-httpOnly flag cookie so Next.js middleware can gate CMS routes.
  const maxAge = 60 * 60 * 12
  document.cookie = `${COOKIE_NAME}=1; path=/; max-age=${maxAge}; SameSite=Lax`
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
}

export function isAuthenticated(): boolean {
  return Boolean(getAccessToken())
}
