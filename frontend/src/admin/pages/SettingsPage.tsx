import { useCallback, useEffect, useState } from 'react'
import { listSessions } from '../auth'
import { adminApi, extractError } from '../api'
import { ConfirmDialog, closedConfirm } from '../components/ConfirmDialog'
import { ErrorBanner, Loading, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

type Session = {
  id: string
  status: string
  last_activity_at: string | null
  created_at: string | null
  is_current: boolean
}

export default function SettingsPage() {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [pending, setPending] = useState<Session | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(extractError(e)))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const revoke = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      await adminApi.post(`/sessions/${pending.id}/revoke`, { confirm: true }, {
        headers: { 'Idempotency-Key': crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) },
      })
      setPending(null)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Настройки">
      <h1>Настройки</h1>
      <p className="admin-muted">
        Управление сессиями администраторов. Сессия автоматически становится неактивной после простоя
        (политика: env-настройки) — для критичных действий потребуется повторная аутентификация.
        Доступ к этой странице — только супер-администратор.
      </p>
      <ErrorBanner error={error} />
      {sessions === null ? (
        <Loading />
      ) : (
        <table className="admin-table">
          <caption className="admin-visually-hidden">Сессии администраторов</caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Статус</th>
              <th scope="col">Создана</th>
              <th scope="col">Последняя активность</th>
              <th scope="col">
                <span className="admin-visually-hidden">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  <code>{s.id.slice(0, 8)}…</code>
                  {s.is_current && <span className="admin-chip">текущая</span>}
                </td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td>{fmtDate(s.created_at)}</td>
                <td>{fmtDate(s.last_activity_at)}</td>
                <td>
                  {!s.is_current && (s.status === 'ACTIVE' || s.status === 'IDLE') && (
                    <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending(s)}>
                      Отозвать
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        state={
          pending
            ? {
                open: true,
                title: 'Отозвать сессию',
                description: `Сессия ${pending.id.slice(0, 8)}… будет немедленно отозвана. Владелец сессии потеряет доступ до нового входа.`,
                requireReason: true,
                minReasonLength: 5,
                confirmLabel: 'Отозвать',
                danger: true,
              }
            : closedConfirm()
        }
        busy={busy}
        error={error}
        onConfirm={revoke}
        onClose={() => setPending(null)}
      />
    </section>
  )
}
