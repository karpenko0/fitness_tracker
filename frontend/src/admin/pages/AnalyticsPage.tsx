import { useCallback, useEffect, useState } from 'react'
import { getContentAnalytics, getSummary, ContentAnalytics, Summary } from '../services/analytics'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ErrorBanner, Field, Loading } from '../components/ui'
import { fmtDate, statusLabel } from '../format'

function Num({ value, suffix }: { value: number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return <span className="admin-muted">нет данных</span>
  return (
    <>
      {value}
      {suffix || ''}
    </>
  )
}

export default function AnalyticsPage() {
  const { me } = useAdmin()
  const [periodDays, setPeriodDays] = useState(30)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [content, setContent] = useState<ContentAnalytics | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      getSummary(periodDays).catch((e) => {
        if (extractError(e).status === 403) return null
        throw e
      }),
      getContentAnalytics(periodDays).catch((e) => {
        if (extractError(e).status === 403) return null
        throw e
      }),
    ])
      .then(([s, c]) => {
        setSummary(s as Summary | null)
        setContent(c as ContentAnalytics | null)
      })
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [periodDays])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !summary && !content) return <Loading />
  if (error) return <ErrorBanner error={error} />

  return (
    <section aria-label="Аналитика">
      <div className="admin-page-head">
        <h1>Аналитика</h1>
        <Field id="an-period" label="Период">
          <select id="an-period" className="admin-input" value={periodDays} onChange={(e) => setPeriodDays(Number(e.target.value))}>
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
            <option value={365}>365 дней</option>
          </select>
        </Field>
      </div>
      {summary && (
        <>
          <p className="admin-muted">
            Период: {fmtDate(summary.meta.period.start)} — {fmtDate(summary.meta.period.end)} · источник: {summary.meta.source} ·
            мин. размер сегмента: {summary.meta.min_segment_size} (мелкие сегменты скрываются)
          </p>
          <div className="admin-widgets">
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.active_users.dau} /></div>
              <div className="admin-widget-period">Активных сегодня (DAU)</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.active_users.wau} /></div>
              <div className="admin-widget-period">За 7 дней (WAU)</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.active_users.mau} /></div>
              <div className="admin-widget-period">За 30 дней (MAU)</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.registrations.new} /></div>
              <div className="admin-widget-period">Новых регистраций</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value">
                {summary.retention.d1 != null ? `${summary.retention.d1}%` : 'нет данных'}
              </div>
              <div className="admin-widget-period">Удержание D1</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.subscriptions.active} /></div>
              <div className="admin-widget-period">Активных подписок</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value">
                {summary.revenue.amount != null ? `${summary.revenue.amount} ${summary.revenue.currency}` : 'нет данных'}
              </div>
              <div className="admin-widget-period">Выручка за период</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value">
                {summary.revenue.success_rate != null ? `${summary.revenue.success_rate}%` : 'нет данных'}
              </div>
              <div className="admin-widget-period">Успешность платежей</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value"><Num value={summary.content.published_total} /></div>
              <div className="admin-widget-period">Опубликованного контента</div>
            </div>
            <div className="admin-widget">
              <div className="admin-widget-value">
                <Num value={summary.notifications.sent} /> / <Num value={summary.notifications.failed} />
              </div>
              <div className="admin-widget-period">Уведомлений: отправлено / с ошибками</div>
            </div>
          </div>
        </>
      )}
      {!summary && me?.role === 'content_manager' && (
        <p role="status" className="admin-info-note">
          Для роли «Контент-менеджер» доступна только аналитика контента (ограничение по SPEC-011 6.4).
        </p>
      )}
      {content && (
        <div className="admin-subsection">
          <h2>Аналитика контента</h2>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Аналитика контента</caption>
            <thead>
              <tr>
                <th scope="col">Показатель</th>
                <th scope="col">Значение</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Опубликовано упражнений по типам</td>
                <td>
                  {Object.entries(content.exercises_published_by_type).map(([k, v]) => (
                    <span key={k} className="admin-chip">
                      {k}: {v}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <td>Программы по статусам</td>
                <td>
                  {Object.entries(content.programs_by_status).map(([k, v]) => (
                    <span key={k} className="admin-chip">
                      {statusLabel(k)}: {v}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <td>Опубликовано привычек</td>
                <td>{content.habits_published}</td>
              </tr>
              <tr>
                <td>Выполнений задач привычек за период</td>
                <td>{content.habit_task_completions}</td>
              </tr>
              <tr>
                <td>Активных пользователей привычек</td>
                <td>{content.habit_users_active}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
