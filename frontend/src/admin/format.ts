export const ROLE_LABELS: Record<string, string> = {
  content_manager: 'Контент-менеджер',
  admin: 'Администратор',
  super_admin: 'Супер-администратор',
}

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активен',
  BLOCKED: 'Заблокирован',
  DELETED: 'Удалён',
  DRAFT: 'Черновик',
  IN_REVIEW: 'На проверке',
  REJECTED: 'Отклонён',
  APPROVED: 'Одобрён',
  PUBLISHED: 'Опубликован',
  UNPUBLISHED: 'Снят с публикации',
  PAID: 'Оплачен',
  REFUNDED: 'Возврат',
  FAILED: 'Ошибка',
  PENDING: 'Ожидание',
  CREATED: 'Создан',
  TRIALING: 'Пробный период',
  PAST_DUE: 'Просрочен',
  PAUSED: 'Приостановлен',
  CANCELLED: 'Отменён',
  VALIDATED: 'Проверено',
  PROCESSED: 'Обработано',
  DUPLICATE: 'Дубликат',
  ARCHIVED: 'В архиве',
  SUCCEEDED: 'Успешно',
  READY: 'Готов',
  SENT: 'Отправлен',
  SCHEDULED: 'Запланирован',
  EXPIRED: 'Истёк',
  REVOKED: 'Отозван',
  IDLE: 'Неактивен',
  PROCESSING: 'Обработка',
  IGNORED: 'Игнорирован',
  DENIED: 'Отказ',
  SUCCESS: 'Успех',
}

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '—'
  return STATUS_LABELS[s] ?? s
}

export function roleLabel(r: string | null | undefined): string {
  if (!r) return '—'
  return ROLE_LABELS[r] ?? r
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function fmtMoney(amount: string | number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'string' ? Number(amount) : amount
  if (Number.isNaN(n)) return String(amount)
  return `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ${currency || ''}`.trim()
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
