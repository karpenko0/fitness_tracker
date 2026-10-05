import adminApi, { adminPatch, adminPost, buildParams, Paged } from '../api'

// ---------- notification templates ----------

export type Template = {
  id: string
  name: string
  event: string
  channels: string[]
  templates: Record<string, string>
  timezone_policy: string
  timezone_fixed: string | null
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  rate_limit_per_day: number | null
  status: string
  version: number
  created_at: string | null
}

export const listTemplates = async (params?: { status_filter?: string; page?: number; pageSize?: number }): Promise<Paged<Template>> => {
  const resp = await adminApi.get('/notifications', { params: buildParams(params || {}) })
  return resp.data.data
}

export const createTemplate = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/notifications', payload)
  return resp.data.data
}

export const updateTemplate = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/notifications/${id}`, payload)
  return resp.data.data
}

// ---------- campaigns ----------

export type Campaign = {
  id: string
  template_id: string
  template_name: string | null
  name: string
  audience_segment: Record<string, unknown> | null
  status: string
  expected_recipients: number | null
  sent_count: number | null
  confirmed_at: string | null
  sent_at: string | null
  reason: string | null
}

export type CampaignPreview = Campaign & {
  preview: { recipients: number; sample: Record<string, string> | null }
}

export const listCampaigns = async (params?: { status_filter?: string; page?: number; pageSize?: number }): Promise<Paged<Campaign>> => {
  const resp = await adminApi.get('/notifications/campaigns', { params: buildParams(params || {}) })
  return resp.data.data
}

export const createCampaign = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/notifications/campaigns', payload)
  return resp.data.data
}

export const previewCampaign = async (id: string): Promise<CampaignPreview> => {
  const resp = await adminPost(`/notifications/campaigns/${id}/preview`, {})
  return resp.data.data
}

export const confirmCampaign = async (id: string) => {
  const resp = await adminPost(`/notifications/campaigns/${id}/confirm`, { confirm: true })
  return resp.data.data
}

export const cancelCampaign = async (id: string) => {
  const resp = await adminPost(`/notifications/campaigns/${id}/cancel`, {})
  return resp.data.data
}

// ---------- habits catalog ----------

export type HabitDefinition = {
  id: string
  title: string
  description: string | null
  goal_type: string
  target_value: number | null
  unit: string | null
  frequency: string
  allowed_min: number | null
  allowed_max: number | null
  reminders: unknown
  streak_policy: unknown
  status: string
  version: number
}

export const listHabits = async (params?: { status_filter?: string; page?: number; pageSize?: number }): Promise<Paged<HabitDefinition>> => {
  const resp = await adminApi.get('/habits', { params: buildParams(params || {}) })
  return resp.data.data
}

export const createHabit = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/habits', payload)
  return resp.data.data
}

export const updateHabit = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/habits/${id}`, payload)
  return resp.data.data
}

// ---------- challenges ----------

export type Challenge = {
  id: string
  title: string
  description: string | null
  type: string
  starts_at: string | null
  ends_at: string | null
  rules: Record<string, unknown>
  target_value: number | null
  eligibility: Record<string, unknown> | null
  repeat_allowed: boolean
  visibility: string
  status: string
  published_version: number | null
  version: number
}

export const listChallenges = async (params?: { status_filter?: string; page?: number; pageSize?: number }): Promise<Paged<Challenge>> => {
  const resp = await adminApi.get('/challenges', { params: buildParams(params || {}) })
  return resp.data.data
}

export const createChallenge = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/challenges', payload)
  return resp.data.data
}

export const updateChallenge = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/challenges/${id}`, payload)
  return resp.data.data
}

export const publishChallenge = async (id: string) => {
  const resp = await adminPost(`/challenges/${id}/publish`, { confirm: true })
  return resp.data.data
}

// ---------- promo codes ----------

export type PromoCode = {
  id: string
  code: string
  discount_type: 'PERCENT' | 'FIXED'
  discount_value: number
  currency: string
  starts_at: string
  ends_at: string
  max_uses: number
  used_count: number
  plan_codes: string[] | null
  segment: Record<string, unknown> | null
  reason: string
  status: string
  version: number
}

export const listPromoCodes = async (params?: { q?: string; status_filter?: string; page?: number; pageSize?: number }): Promise<Paged<PromoCode>> => {
  const resp = await adminApi.get('/promo-codes', { params: buildParams(params || {}) })
  return resp.data.data
}

export const createPromoCode = async (payload: Record<string, unknown>) => {
  const resp = await adminPost('/promo-codes', payload)
  return resp.data.data
}

export const updatePromoCode = async (id: string, payload: Record<string, unknown>) => {
  const resp = await adminPatch(`/promo-codes/${id}`, payload)
  return resp.data.data
}

export const redeemPromoCode = async (promoId: string, userId: string, idempotencyKey?: string) => {
  const resp = await adminPost(`/promo-codes/${promoId}/redeem`, {
    user_id: userId,
    idempotency_key: idempotencyKey || null,
  })
  return resp.data.data
}
