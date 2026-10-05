import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import adminApi, { buildParams, extractError } from '../api'
import { ErrorBanner, Loading } from '../components/ui'
import { fmtDate } from '../format'

type Widget = {
  value: number | string | { amount: string; currency: string } | null
  period: string
  updated_at: string
  href: string
  note: string | null
}

const PERIOD_LABEL: Record<string, string> = {
  today: 'за сегодня',
  '7d': 'за 7 дней',
  '30d': 'за 30 дней',
  now: 'сейчас',
  mrr: 'MRR',
}

function widgetValue(w: Widget): string {
  if (w.value === null) return 'Нет данных'
  if (typeof w.value === 'object') return `${w.value.amount} ${w.value.currency}`
  return String(w.value)
}

export default function DashboardPage() {
  const [widgets, setWidgets] = useState<Widget[] | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)

  useEffect(() => {
    adminApi
      .get('/dashboard', { params: buildParams({}) })
      .then((r) => setWidgets(r.data.data.widgets as Widget[]))
      .catch((e) => setError(extractError(e)))
  }, [])

  if (error) return <ErrorBanner error={error} />
  if (!widgets) return <Loading />

  return (
    <section aria-label="Обзор">
      <h1>Обзор</h1>
      <div className="admin-widgets">
        {widgets.map((w, i) => (
          <div key={i} className="admin-widget">
            <div className="admin-widget-value" aria-live="polite">
              {widgetValue(w)}
            </div>
            <div className="admin-widget-period">{PERIOD_LABEL[w.period] ?? w.period}</div>
            {w.note && <div className="admin-widget-note">{w.note}</div>}
            <div className="admin-widget-foot">
              <Link to={w.href}>{w.href.startsWith('/admin/analytics') ? 'Подробнее' : 'Открыть'}</Link>
              <span>обновлено {fmtDate(w.updated_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
