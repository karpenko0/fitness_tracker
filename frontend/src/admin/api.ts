import axios from 'axios'

// Admin panel talks to the SAME backend under /api/v1/admin (SPEC-011).
// Relative base URL so the dev-server proxy / production API base both work;
// VITE_REACT_APP_API_URL / VITE_API_URL override for deployments.
const API_URL = import.meta.env.VITE_REACT_APP_API_URL || import.meta.env.VITE_API_URL || '/api/v1'

const adminTokenKey = 'admin_token'

export const getAdminToken = () => localStorage.getItem(adminTokenKey)
export const setAdminToken = (t: string | null) => {
  if (t) localStorage.setItem(adminTokenKey, t)
  else localStorage.removeItem(adminTokenKey)
}

export const newIdempotencyKey = (): string => {
  try {
    return crypto.randomUUID()
  } catch {
    return `idk-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
  }
}

export class AdminApiError extends Error {
  code: string
  status: number
  details: unknown
  requestId?: string

  constructor(code: string, message: string, status: number, details: unknown, requestId?: string) {
    super(message)
    this.name = 'AdminApiError'
    this.code = code
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

export function extractError(e: unknown): AdminApiError {
  if (e instanceof AdminApiError) return e
  const ax = e as {
    response?: { status?: number; headers?: Record<string, string>; data?: any }
    message?: string
  }
  const data = ax?.response?.data
  const status = ax?.response?.status ?? 0
  const code = data?.error?.code ?? data?.detail?.code ?? (status === 403 ? 'FORBIDDEN' : 'NETWORK_ERROR')
  const message =
    data?.error?.message ??
    (typeof data?.detail === 'string' ? data.detail : data?.detail?.message) ??
    (data?.error?.details?.[0] as string | undefined) ??
    ax?.message ??
    'Ошибка сети'
  const requestId = ax?.response?.headers?.['x-request-id']
  return new AdminApiError(code, message, status, data?.error?.details ?? null, requestId)
}

// Event fired when the API answers 401 — the app shell redirects to /admin/login.
// STEP_UP_REQUIRED (401 with code) is NOT a full logout: the UI opens a re-auth dialog.
export const ADMIN_UNAUTHORIZED = 'admin:unauthorized'
export const ADMIN_STEP_UP_REQUIRED = 'admin:step-up-required'

function emitUnauthorized(err: AdminApiError) {
  window.dispatchEvent(new CustomEvent(ADMIN_UNAUTHORIZED, { detail: err }))
}
function emitStepUp(err: AdminApiError) {
  window.dispatchEvent(new CustomEvent(ADMIN_STEP_UP_REQUIRED, { detail: err }))
}

export const adminApi = axios.create({
  baseURL: `${API_URL}/admin`,
  headers: { 'Content-Type': 'application/json' },
})

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken()
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

adminApi.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const err = extractError(error)
    if (err.status === 401) {
      if (err.code === 'STEP_UP_REQUIRED') {
        emitStepUp(err)
      } else {
        setAdminToken(null)
        emitUnauthorized(err)
      }
    }
    return Promise.reject(err)
  },
)

/** All admin mutations require an Idempotency-Key header (SPEC-011 7.1/11.7).
 *  The same key + body is safely retried; a different body with the same key -> 409. */
export function adminPost(path: string, body?: unknown, key?: string) {
  return adminApi.post(path, body, { headers: { 'Idempotency-Key': key || newIdempotencyKey() } })
}

export function adminPatch(path: string, body?: unknown, key?: string) {
  return adminApi.patch(path, body, { headers: { 'Idempotency-Key': key || newIdempotencyKey() } })
}

export function adminDelete(path: string, body?: unknown, key?: string) {
  return adminApi.delete(path, {
    data: body,
    headers: { 'Idempotency-Key': key || newIdempotencyKey() },
  })
}

export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number }
export type Query = Record<string, string | number | undefined | null>

export function buildParams(q: Query): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v)
  }
  return out
}

export default adminApi
