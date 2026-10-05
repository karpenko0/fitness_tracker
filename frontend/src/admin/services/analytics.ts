import adminApi, { adminPost, buildParams, Paged } from '../api'

export type Meta = {
  period: { start: string; end: string }
  timezone: string
  source: string
  data_delay_minutes: number
  updated_at: string
  filters: Record<string, unknown>
  min_segment_size: number
}

export type Summary = {
  meta: Meta
  segment_size: number
  active_users: { dau: number | null; wau: number | null; mau: number | null }
  registrations: { new: number | null; funnel: { registered: number | null; onboarded: number | null; first_workout: number | null } }
  workouts: { completed: number | null; note?: string }
  retention: { d1: number | null; d7: number | null; d30: number | null }
  subscriptions: {
    active: number | null
    expiring_30d: number | null
    churned_period: number | null
    free_to_pro_percent: number | null
  }
  revenue: {
    amount: string | null
    currency: string
    payments_ok: number | null
    payments_failed: number | null
    success_rate: number | null
  }
  content: { published_total: number | null }
  notifications: { sent: number | null; failed: number | null }
  challenges: { active: number | null }
  api_errors: { client: number | null; admin: number | null }
}

export const getSummary = async (periodDays: number): Promise<Summary> => {
  const resp = await adminApi.get('/analytics/summary', { params: buildParams({ period_days: periodDays }) })
  return resp.data.data
}

export type ContentAnalytics = {
  meta: Meta
  exercises_published_by_type: Record<string, number>
  programs_by_status: Record<string, number>
  habits_published: number
  habit_task_completions: number
  habit_users_active: number
}

export const getContentAnalytics = async (periodDays: number, timezone = 'UTC'): Promise<ContentAnalytics> => {
  const resp = await adminApi.get('/analytics/content', {
    params: buildParams({ period_days: periodDays, timezone }),
  })
  return resp.data.data
}

// ---------- audit ----------

export type AuditEntry = {
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

export const listAuditLogs = async (params: {
  actor_user_id?: string
  action?: string
  resource_type?: string
  result?: string
  start_date?: string
  end_date?: string
  page?: number
  pageSize?: number
}): Promise<Paged<AuditEntry>> => {
  const resp = await adminApi.get('/audit-logs', { params: buildParams(params) })
  return resp.data.data
}

// ---------- exports ----------

export type ExportItem = {
  id: string
  entity_type: string
  status: string
  rows_count: number | null
  expires_at: string | null
  downloaded: boolean
  created_at: string | null
}

export const createExport = async (entityType: string) => {
  const resp = await adminPost('/exports', { entity_type: entityType, filters: null, confirm: true })
  return resp.data.data
}

export const listExports = async (params?: { page?: number; pageSize?: number }): Promise<Paged<ExportItem>> => {
  const resp = await adminApi.get('/exports', { params: buildParams(params || {}) })
  return resp.data.data
}

export const downloadExportUrl = (id: string): string => `/api/v1/admin/exports/${id}/download`
