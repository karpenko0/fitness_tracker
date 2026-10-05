import adminApi, { adminPost, buildParams, Paged } from '../api'

export type SubscriptionItem = {
  id: string
  user_id: string
  plan_code: string
  status: string
  provider: string
  provider_transaction_id: string | null
  period_start: string | null
  period_end: string | null
  created_at: string | null
}

export type WebhookEventRef = {
  id: string
  event_id: string
  event_type: string
  status: string
  signature_valid: boolean
  replay_count: number
}

export type PaymentItem = {
  id: string
  user_id: string
  subscription_id: string | null
  status: string
  amount: string
  currency: string
  provider: string
  payment_method: string
  provider_transaction_id: string | null
  created_at: string | null
  paid_at: string | null
  refund_reason: string | null
  webhook_events: WebhookEventRef[]
}

export type WebhookItem = {
  id: string
  provider: string
  event_id: string
  event_type: string
  payment_id: string | null
  status: string
  signature_valid: boolean
  replay_count: number
  payload_summary: string | null
  created_at: string | null
}

export const listSubscriptions = async (params: {
  user_id?: string
  status_filter?: string
  plan?: string
  page?: number
  pageSize?: number
  sort?: string
}): Promise<Paged<SubscriptionItem>> => {
  const resp = await adminApi.get('/billing/subscriptions', { params: buildParams(params) })
  return resp.data.data
}

export const listPayments = async (params: {
  user_id?: string
  status_filter?: string
  provider?: string
  page?: number
  pageSize?: number
  sort?: string
}): Promise<Paged<PaymentItem>> => {
  const resp = await adminApi.get('/billing/payments', { params: buildParams(params) })
  return resp.data.data
}

export const listWebhooks = async (params: {
  payment_id?: string
  status_filter?: string
  page?: number
  pageSize?: number
}): Promise<Paged<WebhookItem>> => {
  const resp = await adminApi.get('/billing/webhooks', { params: buildParams(params) })
  return resp.data.data
}

export const replayWebhook = async (eventId: string) => {
  const resp = await adminPost(`/billing/webhooks/${eventId}/replay`, { confirm: true })
  return resp.data.data
}
