import { useCallback, useEffect, useState } from 'react'
import { createExport, downloadExportUrl, listExports, ExportItem } from '../services/analytics'
import { adminApi, extractError } from '../api'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Pagination, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

const ENTITIES = [
  ['users', 'Пользователи'],
  ['payments', 'Платежи'],
  ['subscriptions', 'Подписки'],
  ['exercises', 'Упражнения'],
  ['programs', 'Программы'],
  ['promo_codes', 'Промокоды'],
  ['audit_logs', 'Журнал аудита'],
  ['notifications', 'Уведомления'],
  ['challenges', 'Челленджи'],
  ['habits', 'Привычки'],
]

export default function ExportsPage() {
  const [entityType, setEntityType] = useState('users')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: ExportItem[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [rowError, setRowError] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(closedConfirm())
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listExports({ page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      await createExport(entityType)
      setConfirm(closedConfirm())
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const download = async (id: string) => {
    setDownloading(id)
    setRowError({})
    try {
      const resp = await adminApi.get(downloadExportUrl(id), { responseType: 'blob' })
      const blob = resp.data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `export_${id.slice(0, 8)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      load()
    } catch (e) {
      const err = extractError(e)
      const messages: Record<string, string> = {
        NOT_READY: 'Экспорт ещё готовится',
        ALREADY_DOWNLOADED: 'Ссылка одноразовая — файл уже скачан',
        EXPIRED: 'Срок действия ссылки истёк — создайте новый экспорт',
        NOT_FOUND: 'Экспорт не найден',
      }
      setRowError({ [id]: messages[err.code] || err.message })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <section aria-label="Экспорт данных">
      <h1>Экспорт данных</h1>
      <p className="admin-muted">
        Экспорт формируется асинхронно, все строки — в сокращённом виде (email, Telegram ID, транзакции, IP).
        Ссылка на скачивание одноразовая и действует ограниченное время (TTL).
      </p>
      <div className="admin-toolbar">
        <Field id="ex-entity" label="Сущность" required>
          <select id="ex-entity" className="admin-input" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            {ENTITIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          onClick={() =>
            setConfirm({
              open: true,
              title: 'Создание экспорта',
              description: `Будет сформирован CSV-экспорт «${ENTITIES.find(([v]) => v === entityType)?.[1]}». Операция критичная и записывается в журнал.`,
              confirmLabel: 'Создать экспорт',
            })
          }
        >
          Создать экспорт
        </button>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список экспортов</caption>
            <thead>
              <tr>
                <th scope="col">Сущность</th>
                <th scope="col">Статус</th>
                <th scope="col">Строк</th>
                <th scope="col">Создан</th>
                <th scope="col">Истекает</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Скачать</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Экспортов ещё нет</td>
                </tr>
              )}
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td>{ENTITIES.find(([v]) => v === e.entity_type)?.[1] ?? e.entity_type}</td>
                  <td>
                    <StatusBadge status={e.status} />
                    {e.downloaded && <span className="admin-muted"> · скачан</span>}
                  </td>
                  <td>{e.rows_count ?? '—'}</td>
                  <td>{fmtDate(e.created_at)}</td>
                  <td>{fmtDate(e.expires_at)}</td>
                  <td>
                    {rowError[e.id] && <span role="alert" className="admin-row-error">{rowError[e.id]}</span>}
                    {e.status === 'READY' && !e.downloaded && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={downloading === e.id} onClick={() => download(e.id)}>
                        {downloading === e.id ? 'Скачивание…' : 'Скачать'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={20} total={data.total} onPage={setPage} />
        </>
      )}

      <ConfirmDialog state={confirm} busy={busy} error={error} onConfirm={create} onClose={() => setConfirm(closedConfirm())} />
    </section>
  )
}
