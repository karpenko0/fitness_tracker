import adminApi, { buildParams, getAdminToken, setAdminToken } from './api'

export type AdminMe = {
  user_id: string
  email: string
  role: 'content_manager' | 'admin' | 'super_admin'
  role_source: string
  mfa_required: boolean
  permissions: string[]
}

export type RoleMatrixEntry = { role: string; permissions: string[] }
export type RoleMatrix = { roles: RoleMatrixEntry[]; allPermissions?: string[] }

export type LoginResult = {
  role: string
  user_id: string
  access_token?: string
  token_type?: string
  admin_session_id?: string
  mfa_required?: boolean
  challenge_id?: string
}

export const adminLogin = async (email: string, password: string): Promise<LoginResult> => {
  const resp = await adminApi.post('/auth/login', { email, password })
  const data = resp.data?.data as LoginResult
  if (data?.access_token) setAdminToken(data.access_token)
  return data
}

export const adminMfaVerify = async (payload: {
  email: string
  password: string
  challenge_id: string
  code: string
}): Promise<LoginResult> => {
  const resp = await adminApi.post('/auth/mfa/verify', payload)
  const data = resp.data?.data as LoginResult
  if (data?.access_token) setAdminToken(data.access_token)
  return data
}

export const fetchMe = async (): Promise<AdminMe> => {
  const resp = await adminApi.get('/me')
  return resp.data.data as AdminMe
}

export const fetchRoleMatrix = async (): Promise<RoleMatrix> => {
  const resp = await adminApi.get('/roles')
  return resp.data.data as RoleMatrix
}

/** Best-effort server-side session revoke; the token is cleared locally anyway. */
export const adminLogout = async (adminSessionId?: string | null) => {
  const token = getAdminToken()
  const sessionId = adminSessionId || localStorage.getItem('admin_session_id')
  if (token && sessionId) {
    try {
      await adminApi.post(`/sessions/${sessionId}/revoke`, {})
    } catch {
      /* local logout proceeds regardless */
    }
  }
  localStorage.removeItem('admin_session_id')
  setAdminToken(null)
}

export const listSessions = async () => {
  const resp = await adminApi.get('/sessions')
  return resp.data.data as {
    id: string
    status: string
    last_activity_at: string | null
    created_at: string | null
    is_current: boolean
  }[]
}

export { buildParams }
