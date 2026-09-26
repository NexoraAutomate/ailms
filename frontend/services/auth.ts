import { api } from '@/lib/api'
import { clearAuthSession, setAuthSession, type AuthUser } from '@/lib/auth'

export type AuthTokenResponse = {
  accessToken: string
  tokenType: string
  expiresAt: string
  user: AuthUser
}

export async function login(username: string, password: string) {
  const result = await api.post<AuthTokenResponse>('/api/auth/login', { username, password })
  setAuthSession(result.accessToken, result.user)
  return result
}

export async function signup(input: {
  name: string
  username: string
  password: string
  email?: string
  department?: string
}) {
  const result = await api.post<AuthTokenResponse>('/api/auth/signup', input)
  setAuthSession(result.accessToken, result.user)
  return result
}

export async function logout() {
  try {
    await api.post('/api/auth/logout')
  } catch {
    /* still clear local session */
  }
  clearAuthSession()
}

export async function fetchMe() {
  return api.get<AuthUser>('/api/auth/me')
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return api.post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword })
}
