import { useCallback, useEffect, useState, Fragment} from 'react'
import { listAuditLogs, AuditEntry } from '../services/analytics'
import { extractError } from '../api'
import { ErrorBanner, Field, Loading, Pagination, SearchBox } from '../components/ui'
import { fmtDate, roleLabel } from '../format'

function Json({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <span className="admin-muted">—</span>
  const text = JSON.stringify(value)
  return <code className="admin-json">{text.length > 160 ? text.slice(0, 160) + '…' : text}</code>
}

export default function AuditPage() {
  const [action, setAction] = useState('')
  const [resourceType, setResourceType] = useState('')
  const [result, setResult] = useState('')
  const [actor, setActor] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: AuditEntry[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    listAuditLogs({
      action: action || undefined,
      resource_type: resourceType || undefined,
      result: result || undefined,
      actor_user_id: actor || undefined,
      start_date: startDate || undefined,
      end_date: endDate || undefined,
      page,
      pageSize: 30,
    })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [action, resourceType, result, actor, startDate, endDate, page])

  useEffect(() => {
    load()
  }, [load])

  return (
    <section aria-label="Журнал аудита">
      <h1>Журнал аудита</h1>
      <p className="admin-muted">
        Журнал только для добавления (append-only), чувствительные поля — в сокращённом (редектированном)
        виде. Само чтение журнала фиксируется записью admin.audit.read.
      </p>
      <div className="admin-toolbar">
        <SearchBox value={action} onChange={setAction} label="Фильтр по действию" placeholder="Действие, напр. admin.user.blocked" />
        <Field id="aud-resource" label="Тип ресурса">
          <input id="aud-resource" className="admin-input" value={resourceType} onChange={(e) => setResourceType(e.target.value)} placeholder="user, program…" />
        </Field>
        <Field id="aud-result" label="Результат">
          <select id="aud-result" className="admin-input" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Все</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="DENIED">DENIED</option>
            <option value="FAILED">FAILED</option>
          </select>
        </Field>
        <Field id="aud-actor" label="Исполнитель (ID)">
          <input id="aud-actor" className="admin-input admin-mono" value={actor} onChange={(e) => setActor(e.target.value)} />
        </Field>
        <Field id="aud-from" label="С даты">
          <input id="aud-from" className="admin-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field id="aud-to" label="По дату">
          <input id="aud-to" className="admin-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Записи журнала аудита</caption>
            <thead>
              <tr>
                <th scope="col">Время</th>
                <th scope="col">Действие</th>
                <th scope="col">Исполнитель</th>
                <th scope="col">Ресурс</th>
                <th scope="col">Результат</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Детали</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Записей нет</td>
                </tr>
              )}
              {data.items.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td>{fmtDate(a.created_at)}</td>
                    <td><code>{a.action}</code></td>
                    <td>
                      {roleLabel(a.actor_role)}
                      <div className="admin-muted"><code>{a.actor_user_id.slice(0, 8)}…</code></div>
                    </td>
                    <td>
                      {a.resource_type}
                      {a.resource_id ? <div className="admin-muted"><code>{a.resource_id.slice(0, 8)}…</code></div> : null}
                    </td>
                    <td>
                      <span className={`admin-result admin-result-${a.result.toLowerCase()}`}>{a.result}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="admin-btn admin-btn-ghost admin-btn-sm"
                        aria-expanded={expanded === a.id}
                        onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                      >
                        {expanded === a.id ? 'Свернуть' : 'Детали'}
                      </button>
                    </td>
                  </tr>
                  {expanded === a.id && (
                    <tr className="admin-subrow">
                      <td colSpan={6}>
                        <dl className="admin-detail-grid">
                          <dt>Request ID</dt>
                          <dd><code>{a.request_id}</code></dd>
                          <dt>Причина</dt>
                          <dd>{a.reason || '—'}</dd>
                          <dt>До (before)</dt>
                          <dd><Json value={a.before_summary} /></dd>
                          <dt>После (after)</dt>
                          <dd><Json value={a.after_summary} /></dd>
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={30} total={data.total} onPage={setPage} />
        </>
      )}
    </section>
  )
}
