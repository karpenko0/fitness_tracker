import adminApi, { adminDelete, adminPost, buildParams, Paged } from '../api'

export type UserListItem = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  status: 'ACTIVE' | 'BLOCKED'
  created_at: string | null
  last_login_at: string | null
}

export type UserCard = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  status: 'ACTIVE' | 'BLOCKED' | 'DELETED'
  registered_at: string | null
  last_login_at: string | null
  timezone: string | null
  telegram: { bound: boolean; chat_id: string | null; notifications_enabled: boolean }
  roles: { current: string; source: string }
  plan: { code: string; price: string; currency: string; status: string } | null
  subscriptions: { id: string; plan_code: string; status: string; created_at: string | null }[]
  habits_count: number | null
  last_activity_at: string | null
  recent_actions: { action: string; result: string; created_at: string | null }[]
}

export type UserAuditEntry = {
  id: string
  actor_user_id: string
  actor_role: string
  action: string
  resource_type: string
  resource_id: string | null
  result: string
  reason: string | null
  request_id: string
  before_summary: Record<string, unknown> | null
  after_summary: Record<string, unknown> | null
  created_at: string | null
}

export const listUsers = async (params: {
  q?: string
  status_filter?: string
  role?: string
  page?: number
  pageSize?: number
  sort?: string
}): Promise<Paged<UserListItem>> => {
  const resp = await adminApi.get('/users', { params: buildParams(params) })
  return resp.data.data
}

export const getUser = async (id: string): Promise<UserCard> => {
  const resp = await adminApi.get(`/users/${id}`)
  return resp.data.data
}

export const getUserAudit = async (id: string): Promise<UserAuditEntry[]> => {
  const resp = await adminApi.get(`/users/${id}/audit`)
  return resp.data.data
}

export const blockUser = async (id: string, reason: string) => {
  const resp = await adminPost(`/users/${id}/block`, { reason, confirm: true })
  return resp.data.data
}

export const unblockUser = async (id: string, reason?: string) => {
  const resp = await adminPost(`/users/${id}/unblock`, { reason: reason || null, confirm: true })
  return resp.data.data
}

export const assignRole = async (id: string, role: string) => {
  const resp = await adminPost(`/users/${id}/roles`, { role, confirm: true })
  return resp.data.data
}

export const removeRole = async (id: string, role: string) => {
  const resp = await adminDelete(`/users/${id}/roles/${role}`, { confirm: true })
  return resp.data.data
}

export const softDeleteUser = async (id: string, reason: string) => {
  const resp = await adminPost(`/users/${id}/soft-delete`, { reason, confirm: true })
  return resp.data.data
}

export const bulkBlockPreview = async (userIds: string[]) => {
  const resp = await adminPost('/users/bulk/block', { user_ids: userIds, preview: true })
  return resp.data.data as { preview: boolean; affected_count: number; requested_count: number }
}

export const bulkBlockExecute = async (userIds: string[], reason: string) => {
  const resp = await adminPost('/users/bulk/block', { user_ids: userIds, reason, preview: false, confirm: true })
  return resp.data.data as { executed: boolean; blocked_count: number; user_ids: string[] }
}
