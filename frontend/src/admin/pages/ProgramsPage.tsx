import { useCallback, useEffect, useState, type FormEvent} from 'react'
import {
  listPrograms,
  programApprove,
  programPublish,
  programReject,
  programRollback,
  programSubmitReview,
  programUnpublish,
  programVersions,
  createProgram,
  updateProgram,
  Program,
  ProgramVersion,
} from '../services/content'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, SearchBox, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

type Pending =
  | { type: 'submit'; id: string; title: string }
  | { type: 'approve'; id: string; title: string }
  | { type: 'reject'; id: string; title: string }
  | { type: 'publish'; id: string; title: string; version: number }
  | { type: 'unpublish'; id: string; title: string }
  | { type: 'rollback'; id: string; title: string; version: number }
  | null

function confirmFor(p: NonNullable<Pending>): ConfirmState {
  const base = `Программа «${p.title}»`
  switch (p.type) {
    case 'submit':
      return {
        open: true,
        title: 'Отправка на проверку',
        description: `${base} будут выполнены все проверки (наличие описания, недель, ссылок на упражнения) и статус станет «На проверке».`,
        confirmLabel: 'Отправить на проверку',
      }
    case 'approve':
      return { open: true, title: 'Одобрение программы', description: `${base} получит статус «Одобрена» и станет доступна для публикации.`, confirmLabel: 'Одобрить' }
    case 'reject':
      return {
        open: true,
        title: 'Отклонение программы',
        description: `${base} вернётся в работу. Автор увидит статус «Отклонено».`,
        requireReason: true,
        minReasonLength: 5,
        confirmLabel: 'Отклонить',
        danger: true,
      }
    case 'publish':
      return {
        open: true,
        title: 'Публикация программы',
        description: `${base} (версия ${p.version}) будет опубликована атомарно: сначала пройдут все проверки, затем статус изменится. Критичное действие.`,
        confirmLabel: 'Опубликовать',
      }
    case 'unpublish':
      return {
        open: true,
        title: 'Снятие программы с публикации',
        description: `${base} исчезнет из приложения. Опубликованная версия сохраняется для отката.`,
        requireReason: true,
        minReasonLength: 5,
        confirmLabel: 'Снять с публикации',
        danger: true,
      }
    case 'rollback':
      return {
        open: true,
        title: 'Откат версии программы',
        description: `${base} будет откатлена к сохранённой версии ${p.version}. Действие записывается в журнал.`,
        confirmLabel: `Откатиться к версии ${p.version}`,
        danger: true,
      }
  }
}

export default function ProgramsPage() {
  const { can } = useAdmin()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: Program[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)

  const [versionsFor, setVersionsFor] = useState<Program | null>(null)
  const [versions, setVersions] = useState<ProgramVersion[] | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Program | null>(null)
  const [form, setForm] = useState({ title: '', slug: '', description: '', goal: '', level: '', duration_minutes: 30, weeksJson: '' })
  const [formBusy, setFormBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listPrograms({ q: q || undefined, status_filter: statusFilter || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [q, statusFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const openVersions = async (p: Program) => {
    setVersionsFor(p)
    setVersions(null)
    try {
      setVersions(await programVersions(p.id))
    } catch (e) {
      setError(extractError(e))
    }
  }

  const runConfirm = async (reason: string) => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const p = pending
    try {
      switch (p.type) {
        case 'submit':
          await programSubmitReview(p.id)
          break
        case 'approve':
          await programApprove(p.id)
          break
        case 'reject':
          await programReject(p.id)
          break
        case 'publish':
          await programPublish(p.id, p.version, reason || undefined)
          break
        case 'unpublish':
          await programUnpublish(p.id, reason)
          break
        case 'rollback':
          await programRollback(p.id, p.version)
          break
      }
      setPending(null)
      load()
    } catch (e) {
      setError(extractError(e))
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ title: '', slug: '', description: '', goal: '', level: '', duration_minutes: 30, weeksJson: '' })
    setFormOpen(true)
  }

  const openEdit = (p: Program) => {
    setEditing(p)
    setForm({
      title: p.title,
      slug: p.slug,
      description: p.description || '',
      goal: p.goal || '',
      level: p.level || '',
      duration_minutes: p.duration_minutes || 30,
      weeksJson: JSON.stringify(p.weeks, null, 2),
    })
    setFormOpen(true)
  }

  const submitForm = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormBusy(true)
    setError(null)
    let weeks: unknown[] = []
    if (form.weeksJson.trim()) {
      try {
        const parsed = JSON.parse(form.weeksJson)
        if (!Array.isArray(parsed)) throw new Error('не массив')
        weeks = parsed
      } catch (e) {
        setError({ code: 'VALIDATION_ERROR', message: 'Недели: ожидается JSON-массив' })
        setFormBusy(false)
        return
      }
    }
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      goal: form.goal.trim() || null,
      level: form.level.trim() || null,
      duration_minutes: Number(form.duration_minutes),
    }
    if (weeks.length) payload.weeks = weeks
    if (!editing) payload.slug = form.slug.trim()
    try {
      if (editing) await updateProgram(editing.id, payload)
      else await createProgram(payload)
      setFormOpen(false)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setFormBusy(false)
    }
  }

  return (
    <section aria-label="Программы">
      <div className="admin-page-head">
        <h1>Программы</h1>
        {can('content:write') && (
          <button type="button" className="admin-btn admin-btn-primary" onClick={openCreate}>
            + Создать программу
          </button>
        )}
      </div>
      <div className="admin-toolbar">
        <SearchBox value={q} onChange={setQ} label="Поиск по программам" placeholder="Название или slug…" />
        <Field id="pr-status" label="Статус">
          <select id="pr-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="DRAFT">Черновик</option>
            <option value="IN_REVIEW">На проверке</option>
            <option value="APPROVED">Одобрена</option>
            <option value="REJECTED">Отклонена</option>
            <option value="PUBLISHED">Опубликована</option>
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список программ</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Цель</th>
                <th scope="col">Статус</th>
                <th scope="col">Версия / опубликована</th>
                <th scope="col">Недель</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Ничего не найдено</td>
                </tr>
              )}
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.title}</strong>
                    <div className="admin-muted"><code>{p.slug}</code></div>
                  </td>
                  <td>{p.goal || '—'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td>
                    {p.version}
                    {p.published_version ? ` / ${p.published_version}` : ''}
                  </td>
                  <td>{p.weeks?.length ?? 0}</td>
                  <td className="admin-actions">
                    {can('content:write') && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(p)}>
                        Изменить
                      </button>
                    )}
                    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openVersions(p)}>
                      Версии
                    </button>
                    {can('content:write') && p.status === 'DRAFT' && (
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setPending({ type: 'submit', id: p.id, title: p.title })}>
                        На проверку
                      </button>
                    )}
                    {can('content:publish') && p.status === 'IN_REVIEW' && (
                      <>
                        <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setPending({ type: 'approve', id: p.id, title: p.title })}>
                          Одобрить
                        </button>
                        <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending({ type: 'reject', id: p.id, title: p.title })}>
                          Отклонить
                        </button>
                      </>
                    )}
                    {can('content:publish') && (p.status === 'APPROVED' || p.status === 'PUBLISHED') && (
                      <button
                        type="button"
                        className={`admin-btn admin-btn-sm ${p.status === 'PUBLISHED' ? 'admin-btn-secondary' : 'admin-btn-primary'}`}
                        onClick={() => setPending({ type: 'publish', id: p.id, title: p.title, version: p.version })}
                      >
                        {p.status === 'PUBLISHED' ? 'Новая версия' : 'Опубликовать'}
                      </button>
                    )}
                    {can('content:publish') && p.status === 'PUBLISHED' && (
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending({ type: 'unpublish', id: p.id, title: p.title })}>
                        Снять
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

      {versionsFor && (
        <Modal title={`Версии: ${versionsFor.title}`} onClose={() => setVersionsFor(null)}>
          {versions === null ? (
            <Loading label="Загрузка версий…" />
          ) : versions.length === 0 ? (
            <p>Сохранённых версий пока нет — они появляются при публикации.</p>
          ) : (
            <table className="admin-table">
              <caption className="admin-visually-hidden">Версии программы</caption>
              <thead>
                <tr>
                  <th scope="col">Версия</th>
                  <th scope="col">Статус</th>
                  <th scope="col">Создана</th>
                  <th scope="col">
                    <span className="admin-visually-hidden">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.version}>
                    <td>{v.version}</td>
                    <td><StatusBadge status={v.status} /></td>
                    <td>{fmtDate(v.created_at)}</td>
                    <td>
                      {can('content:publish') && v.version !== versionsFor.version && (
                        <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => { setPending({ type: 'rollback', id: versionsFor.id, title: versionsFor.title, version: v.version }); setVersionsFor(null) }}>
                          Откатиться
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal>
      )}

      {formOpen && (
        <Modal title={editing ? `Редактирование: ${editing.title}` : 'Новая программа'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={submitForm}>
            <div className="admin-form-grid">
              <Field id="pr-title" label="Название" required>
                <input id="pr-title" className="admin-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              {!editing && (
                <Field id="pr-slug" label="Slug (уникальный)" required>
                  <input id="pr-slug" className="admin-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required pattern="^[a-z0-9-]+$" />
                </Field>
              )}
              <Field id="pr-goal" label="Цель">
                <input id="pr-goal" className="admin-input" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
              </Field>
              <Field id="pr-level" label="Уровень">
                <input id="pr-level" className="admin-input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
              </Field>
              <Field id="pr-dur" label="Длительность (мин)" required>
                <input id="pr-dur" className="admin-input" type="number" min={1} max={10000} value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} required />
              </Field>
            </div>
            <Field id="pr-desc" label="Описание (обязательно для публикации)">
              <textarea id="pr-desc" className="admin-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field id="pr-weeks" label="Недели (JSON-массив)" hint="Оформление недельных блоков программы">
              <textarea id="pr-weeks" className="admin-input admin-mono" rows={6} value={form.weeksJson} onChange={(e) => setForm({ ...form, weeksJson: e.target.value })} />
            </Field>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setFormOpen(false)} disabled={formBusy}>
                Отмена
              </button>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={formBusy}>
                {formBusy ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmDialog
        state={pending ? confirmFor(pending) : closedConfirm()}
        busy={busy}
        error={error}
        onConfirm={runConfirm}
        onClose={() => setPending(null)}
      />
    </section>
  )
}
