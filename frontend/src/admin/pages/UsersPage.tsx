import { useCallback, useEffect, useState } from 'react'
import {
  assignRole,
  blockUser,
  bulkBlockExecute,
  bulkBlockPreview,
  getUser,
  getUserAudit,
  listUsers,
  softDeleteUser,
  unblockUser,
  UserAuditEntry,
  UserCard,
  UserListItem,
} from '../services/users'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, SearchBox, StatusBadge, Badge } from '../components/ui'
import { fmtDate, roleLabel, ROLE_LABELS } from '../format'

const ROLE_RANK: Record<string, number> = { content_manager: 1, admin: 2, super_admin: 3 }

type PendingAction =
  | { type: 'block' }
  | { type: 'unblock' }
  | { type: 'role'; role: string }
  | { type: 'delete' }
  | { type: 'bulk'; count: number }

function confirmFor(action: PendingAction, card: UserCard | null): ConfirmState {
  switch (action.type) {
    case 'block':
      return {
        open: true,
        title: 'Блокировка пользователя',
        description: `Пользователь ${card?.email ?? ''} потеряет доступ к клиентскому приложению. История сохранится. Действие необратимо до разблокирования.`,
        requireReason: true,
        confirmLabel: 'Заблокировать',
        danger: true,
      }
    case 'unblock':
      return {
        open: true,
        title: 'Разблокировка пользователя',
        description: `Пользователь ${card?.email ?? ''} снова получит доступ к приложению.`,
        confirmLabel: 'Разблокировать',
      }
    case 'role':
      return {
        open: true,
        title: 'Изменение роли',
        description: `Роль пользователя ${card?.email ?? ''} будет изменена на «${roleLabel(action.role)}». Критичное действие — будет записано в журнал.`,
        requireReason: true,
        minReasonLength: 3,
        confirmLabel: `Назначить «${roleLabel(action.role)}»`,
      }
    case 'delete':
      return {
        open: true,
        title: 'Мягкое удаление пользователя',
        description: `Пользователь ${card?.email ?? ''} будет скрыт из приложения. История операций сохранится (физическое удаление недоступно).`,
        requireReason: true,
        confirmLabel: 'Удалить (мягко)',
        danger: true,
      }
    case 'bulk':
      return {
        open: true,
        title: 'Пакетная блокировка',
        description: `Будет заблокировано активных пользователей: ${action.count}. Каждое блокирование будет записано в журнал.`,
        requireReason: true,
        confirmLabel: `Заблокировать (${action.count})`,
        danger: true,
      }
  }
}

export default function UsersPage() {
  const { can, me } = useAdmin()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: UserListItem[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [card, setCard] = useState<UserCard | null>(null)
  const [cardAudit, setCardAudit] = useState<UserAuditEntry[] | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [roleSelect, setRoleSelect] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    listUsers({ q: q || undefined, status_filter: statusFilter || undefined, role: roleFilter || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [q, statusFilter, roleFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const runConfirm = async (reason: string) => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const action = pending
    try {
      switch (action.type) {
        case 'block':
          await blockUser(card!.id, reason)
          break
        case 'unblock':
          await unblockUser(card!.id, reason || undefined)
          break
        case 'role':
          await assignRole(card!.id, action.role)
          break
        case 'delete':
          await softDeleteUser(card!.id, reason)
          break
        case 'bulk':
          await bulkBlockExecute(Array.from(selected), reason)
          setSelected(new Set())
          break
      }
      setPending(null)
      load()
      if (card && action.type !== 'delete') {
        setCard(await getUser(card.id).catch(() => card))
      }
    } catch (e) {
      setError(extractError(e))
    } finally {
      setBusy(false)
    }
  }

  const openCard = async (id: string) => {
    setError(null)
    setCardAudit(null)
    setRoleSelect('')
    try {
      const c = await getUser(id)
      setCard(c)
      getUserAudit(id).then(setCardAudit).catch(() => setCardAudit([]))
    } catch (e) {
      setError(extractError(e))
      setCard(null)
    }
  }

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const startBulk = async () => {
    if (selected.size === 0) return
    setError(null)
    try {
      const res = await bulkBlockPreview(Array.from(selected))
      setPending({ type: 'bulk', count: res.affected_count })
    } catch (e) {
      setError(extractError(e))
    }
  }

  const assignableRoles = Object.entries(ROLE_LABELS).filter(
    ([r]) => ROLE_RANK[r] <= (me ? ROLE_RANK[me.role] ?? 0 : 0),
  )

  const confirmState: ConfirmState = pending ? confirmFor(pending, card) : closedConfirm()

  return (
    <section aria-label="Пользователи">
      <h1>Пользователи</h1>
      <div className="admin-toolbar">
        <SearchBox value={q} onChange={setQ} onSearch={() => setPage(1)} label="Поиск по пользователям" placeholder="Email, имя, ID…" />
        <Field id="users-status" label="Статус">
          <select id="users-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="ACTIVE">Активные</option>
            <option value="BLOCKED">Заблокированные</option>
          </select>
        </Field>
        <Field id="users-role" label="Роль">
          <select id="users-role" className="admin-input" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="user">Пользователь</option>
            <option value="content_manager">Контент-менеджер</option>
            <option value="admin">Администратор</option>
            <option value="super_admin">Супер-администратор</option>
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          {can('bulk:execute') && selected.size > 0 && (
            <div className="admin-bulkbar" role="status">
              <span>Выбрано: {selected.size}.</span>
              <button type="button" className="admin-btn admin-btn-danger" onClick={startBulk}>
                Пакетная блокировка…
              </button>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => setSelected(new Set())}>
                Снять выбор
              </button>
            </div>
          )}
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список пользователей</caption>
            <thead>
              <tr>
                {can('bulk:execute') && (
                  <th scope="col">
                    <span className="admin-visually-hidden">Выбрать</span>
                    <input
                      type="checkbox"
                      aria-label="Выбрать всех на странице"
                      checked={data.items.length > 0 && data.items.every((u) => selected.has(u.id))}
                      onChange={(e) => {
                        const next = new Set(selected)
                        data.items.forEach((u) => (e.target.checked ? next.add(u.id) : next.delete(u.id)))
                        setSelected(next)
                      }}
                    />
                  </th>
                )}
                <th scope="col">Email</th>
                <th scope="col">Имя</th>
                <th scope="col">Роль</th>
                <th scope="col">Статус</th>
                <th scope="col">Последний вход</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="admin-empty">Ничего не найдено</td>
                </tr>
              )}
              {data.items.map((u) => (
                <tr key={u.id}>
                  {can('bulk:execute') && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${u.email}`}
                        checked={selected.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                    </td>
                  )}
                  <td>
                    <button type="button" className="admin-link" onClick={() => openCard(u.id)}>
                      {u.email}
                    </button>
                  </td>
                  <td>{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td>{roleLabel(u.role)}</td>
                  <td>
                    <StatusBadge status={u.status} />
                  </td>
                  <td>{fmtDate(u.last_login_at)}</td>
                  <td>
                    <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openCard(u.id)}>
                      Карточка
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
        </>
      )}

      {card && (
        <Modal title="Карточка пользователя" onClose={() => setCard(null)} wide>
          <div className="admin-card-grid">
            <dl>
              <dt>Email</dt>
              <dd>{card.email}</dd>
              <dt>Имя</dt>
              <dd>{[card.first_name, card.last_name].filter(Boolean).join(' ') || '—'}</dd>
              <dt>Статус</dt>
              <dd>
                <StatusBadge status={card.status} />
              </dd>
              <dt>Роль</dt>
              <dd>
                {roleLabel(card.roles.current)} <Badge tone="gray">источник: {card.roles.source}</Badge>
              </dd>
              <dt>Зарегистрирован</dt>
              <dd>{fmtDate(card.registered_at)}</dd>
              <dt>Последний вход</dt>
              <dd>{fmtDate(card.last_login_at)}</dd>
              <dt>Часовой пояс</dt>
              <dd>{card.timezone || '—'}</dd>
              <dt>Telegram</dt>
              <dd>
                {card.telegram.bound ? `привязан (${card.telegram.chat_id})` : 'не привязан'}
                {card.telegram.bound &&
                  (card.telegram.notifications_enabled ? ' · уведомления вкл.' : ' · уведомления выкл.')}
              </dd>
            </dl>
            <div>
              <h3>Тариф и подписки</h3>
              {card.plan ? (
                <p>
                  {card.plan.code} · {card.plan.price} {card.plan.currency} · {card.plan.status}
                </p>
              ) : (
                <p>Бесплатный тариф</p>
              )}
              {card.subscriptions.length > 0 && (
                <ul>
                  {card.subscriptions.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      {s.plan_code} · {s.status} · {fmtDate(s.created_at)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>Журнал действий по пользователю</h3>
              {cardAudit === null ? (
                <Loading label="Загрузка журнала…" />
              ) : cardAudit.length === 0 ? (
                <p>Нет записей</p>
              ) : (
                <ul className="admin-audit-mini">
                  {cardAudit.map((a) => (
                    <li key={a.id}>
                      <code>{a.action}</code> · {a.result} · {fmtDate(a.created_at)}
                      {a.reason ? <div className="admin-muted">{a.reason}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="admin-card-actions">
            {can('users:block') && card.status === 'ACTIVE' && (
              <button type="button" className="admin-btn admin-btn-danger" onClick={() => setPending({ type: 'block' })}>
                Заблокировать
              </button>
            )}
            {can('users:block') && card.status === 'BLOCKED' && (
              <button type="button" className="admin-btn admin-btn-primary" onClick={() => setPending({ type: 'unblock' })}>
                Разблокировать
              </button>
            )}
            {can('users:roles') && card.roles.current !== me?.role && (
              <div className="admin-role-row">
                <label htmlFor="card-role" className="admin-visually-hidden">
                  Новая роль
                </label>
                <select
                  id="card-role"
                  className="admin-input"
                  value={roleSelect}
                  onChange={(e) => setRoleSelect(e.target.value)}
                >
                  <option value="">Новая роль…</option>
                  {assignableRoles.map(([r, label]) => (
                    <option key={r} value={r}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  disabled={!roleSelect}
                  onClick={() => roleSelect && setPending({ type: 'role', role: roleSelect })}
                >
                  Сменить роль
                </button>
              </div>
            )}
            {can('users:delete') && card.status !== 'DELETED' && (
              <button type="button" className="admin-btn admin-btn-danger" onClick={() => setPending({ type: 'delete' })}>
                Удалить (мягко)
              </button>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        state={confirmState}
        busy={busy}
        error={error}
        onConfirm={runConfirm}
        onClose={() => setPending(null)}
      />
    </section>
  )
}
