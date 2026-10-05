import { useCallback, useEffect, useState, Fragment} from 'react'
import { NavLink } from 'react-router-dom'
import { listPayments, listSubscriptions, listWebhooks, replayWebhook, PaymentItem, SubscriptionItem, WebhookItem } from '../services/billing'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Pagination, StatusBadge } from '../components/ui'
import { fmtDate, fmtMoney } from '../format'

type Tab = 'subscriptions' | 'payments' | 'webhooks'

export default function BillingPage() {
  const { can } = useAdmin()
  const [tab, setTab] = useState<Tab>('subscriptions')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [subs, setSubs] = useState<SubscriptionItem[] | null>(null)
  const [subsTotal, setSubsTotal] = useState(0)
  const [payments, setPayments] = useState<PaymentItem[] | null>(null)
  const [paymentsTotal, setPaymentsTotal] = useState(0)
  const [webhooks, setWebhooks] = useState<WebhookItem[] | null>(null)
  const [webhooksTotal, setWebhooksTotal] = useState(0)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(closedConfirm())
  const [replayId, setReplayId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    if (tab === 'subscriptions') {
      listSubscriptions({ status_filter: statusFilter || undefined, page, pageSize: 20 })
        .then((r) => { setSubs(r.items); setSubsTotal(r.total) })
        .catch((e) => setError(extractError(e)))
    } else if (tab === 'payments') {
      listPayments({ status_filter: statusFilter || undefined, page, pageSize: 20 })
        .then((r) => { setPayments(r.items); setPaymentsTotal(r.total) })
        .catch((e) => setError(extractError(e)))
    } else {
      listWebhooks({ status_filter: statusFilter || undefined, page, pageSize: 20 })
        .then((r) => { setWebhooks(r.items); setWebhooksTotal(r.total) })
        .catch((e) => setError(extractError(e)))
    }
  }, [tab, statusFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const total = tab === 'subscriptions' ? subsTotal : tab === 'payments' ? paymentsTotal : webhooksTotal

  const doReplay = async () => {
    if (!replayId) return
    setBusy(true)
    setError(null)
    try {
      await replayWebhook(replayId)
      setConfirm(closedConfirm())
      setReplayId(null)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const STATUS_OPTIONS: Record<Tab, string[]> = {
    subscriptions: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED'],
    payments: ['CREATED', 'PENDING', 'PAID', 'REFUNDED', 'FAILED', 'EXPIRED', 'CANCELLED'],
    webhooks: ['RECEIVED', 'VALIDATED', 'PROCESSED', 'FAILED', 'DUPLICATE'],
  }

  return (
    <section aria-label="Биллинг">
      <h1>Биллинг</h1>
      <nav className="admin-tabs" aria-label="Разделы биллинга">
        <NavLink to="/admin/billing/subscriptions" className={({ isActive }) => 'admin-tab' + (isActive ? ' is-active' : '')} onClick={() => { setTab('subscriptions'); setPage(1) }}>
          Подписки
        </NavLink>
        <NavLink to="/admin/billing/payments" className={({ isActive }) => 'admin-tab' + (isActive ? ' is-active' : '')} onClick={() => { setTab('payments'); setPage(1) }}>
          Платежи
        </NavLink>
        <NavLink to="/admin/billing/webhooks" className={({ isActive }) => 'admin-tab' + (isActive ? ' is-active' : '')} onClick={() => { setTab('webhooks'); setPage(1) }}>
          Вебхуки
        </NavLink>
      </nav>
      <p className="admin-muted">
        Статусы платежей устанавливаются только вебхуками провайдера. Ручная смена статуса оплаты недоступна;
        возвраты — отдельная согласованная процедура.
      </p>
      <div className="admin-toolbar">
        <Field id="billing-status" label="Статус">
          <select id="billing-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            {STATUS_OPTIONS[tab].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />

      {tab === 'subscriptions' && (
        subs === null ? <Loading /> : (
          <table className="admin-table">
            <caption className="admin-visually-hidden">Подписки</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Пользователь</th>
                <th scope="col">Тариф</th>
                <th scope="col">Статус</th>
                <th scope="col">Провайдер</th>
                <th scope="col">Период</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td><code>{s.id.slice(0, 8)}…</code></td>
                  <td><code>{s.user_id.slice(0, 8)}…</code></td>
                  <td>{s.plan_code}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>{s.provider}</td>
                  <td>{fmtDate(s.period_start)} — {fmtDate(s.period_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'payments' && (
        payments === null ? <Loading /> : (
          <table className="admin-table">
            <caption className="admin-visually-hidden">Платежи</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Сумма</th>
                <th scope="col">Статус</th>
                <th scope="col">Провайдер</th>
                <th scope="col">Создан</th>
                <th scope="col">Оплачен</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Вебхуки</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td><code>{p.id.slice(0, 8)}…</code></td>
                    <td>{fmtMoney(p.amount, p.currency)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>{p.provider} · {p.payment_method}</td>
                    <td>{fmtDate(p.created_at)}</td>
                    <td>{fmtDate(p.paid_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-btn admin-btn-ghost admin-btn-sm"
                        aria-expanded={expanded === p.id}
                        onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                      >
                        Вебхуки ({p.webhook_events.length})
                      </button>
                    </td>
                  </tr>
                  {expanded === p.id && (
                    <tr className="admin-subrow">
                      <td colSpan={7}>
                        {p.refund_reason && <p className="admin-muted">Причина возврата: {p.refund_reason}</p>}
                        {p.webhook_events.length === 0 ? (
                          <p className="admin-muted">Вебхуков нет</p>
                        ) : (
                          <ul>
                            {p.webhook_events.map((e) => (
                              <li key={e.id}>
                                <code>{e.event_type}</code> · <StatusBadge status={e.status} /> · подпись:{' '}
                                {e.signature_valid ? 'валидна' : 'НЕВАЛИДНА'} · повторов: {e.replay_count}
                                {can('billing:replay') && (
                                  <button
                                    type="button"
                                    className="admin-btn admin-btn-secondary admin-btn-sm"
                                    onClick={() => {
                                      setReplayId(e.id)
                                      setConfirm({
                                        open: true,
                                        title: 'Повторная обработка вебхука',
                                        description: 'Событие будет обработано повторно. Повтор идемпотентен: повторный вызов с теми же данными вернёт тот же результат.',
                                        confirmLabel: 'Обработать повторно',
                                      })
                                    }}
                                  >
                                    Повторить
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'webhooks' && (
        webhooks === null ? <Loading /> : (
          <table className="admin-table">
            <caption className="admin-visually-hidden">События вебхуков</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Провайдер</th>
                <th scope="col">Тип события</th>
                <th scope="col">Статус</th>
                <th scope="col">Подпись</th>
                <th scope="col">Повторов</th>
                <th scope="col">Создан</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.id.slice(0, 8)}…</code></td>
                  <td>{e.provider}</td>
                  <td><code>{e.event_type}</code></td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.signature_valid ? '✓' : '✗'}</td>
                  <td>{e.replay_count}</td>
                  <td>{fmtDate(e.created_at)}</td>
                  <td>
                    {can('billing:replay') && (
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary admin-btn-sm"
                        onClick={() => {
                          setReplayId(e.id)
                          setConfirm({
                            open: true,
                            title: 'Повторная обработка вебхука',
                            description: 'Событие будет обработано повторно. Повтор идемпотентен: повторный вызов с теми же данными вернёт тот же результат.',
                            confirmLabel: 'Обработать повторно',
                          })
                        }}
                      >
                        Повторить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      <Pagination page={page} pageSize={20} total={total} onPage={setPage} />

      <ConfirmDialog
        state={confirm}
        busy={busy}
        error={error}
        onConfirm={doReplay}
        onClose={() => { setConfirm(closedConfirm()); setReplayId(null) }}
      />
    </section>
  )
}
