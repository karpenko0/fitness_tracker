import { useCallback, useEffect, useState, type FormEvent} from 'react'
import {
  createChallenge,
  listChallenges,
  publishChallenge,
  updateChallenge,
  Challenge,
} from '../services/catalog'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

const TYPE_OPTIONS = [
  ['WORKOUT_COUNT', 'Количество тренировок'],
  ['STREAK', 'Серия дней'],
  ['VOLUME', 'Объём'],
  ['HABIT_COMPLETION', 'Выполнение привычек'],
]

export default function ChallengesPage() {
  const { can } = useAdmin()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: Challenge[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Challenge | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'WORKOUT_COUNT',
    starts_at: '',
    ends_at: '',
    rules: '',
    target_value: '',
    repeat_allowed: false,
    visibility: 'PUBLIC',
  })
  const [formBusy, setFormBusy] = useState(false)
  const [pending, setPending] = useState<{ id: string; title: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listChallenges({ status_filter: statusFilter || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [statusFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({
      title: '',
      description: '',
      type: 'WORKOUT_COUNT',
      starts_at: '',
      ends_at: '',
      rules: '',
      target_value: '',
      repeat_allowed: false,
      visibility: 'PUBLIC',
    })
    setFormOpen(true)
  }

  const openEdit = (c: Challenge) => {
    setEditing(c)
    setForm({
      title: c.title,
      description: c.description || '',
      type: c.type,
      starts_at: c.starts_at?.slice(0, 10) || '',
      ends_at: c.ends_at?.slice(0, 10) || '',
      rules: JSON.stringify(c.rules || {}),
      target_value: c.target_value?.toString() || '',
      repeat_allowed: c.repeat_allowed,
      visibility: c.visibility,
    })
    setFormOpen(true)
  }

  const submitForm = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormBusy(true)
    setError(null)
    let rules: Record<string, unknown> = {}
    if (form.rules.trim()) {
      try {
        rules = JSON.parse(form.rules)
      } catch {
        setError({ code: 'VALIDATION_ERROR', message: 'Правила: ожидается JSON-объект' })
        setFormBusy(false)
        return
      }
    }
    try {
      if (editing) {
        // ChallengeUpdate is a strict DTO: no type/starts_at/ends_at
        const payload: Record<string, unknown> = {
          title: form.title.trim(),
          description: form.description.trim() || null,
          rules,
          target_value: form.target_value ? Number(form.target_value) : null,
          repeat_allowed: form.repeat_allowed,
          visibility: form.visibility,
          // Editing a published challenge requires an explicit new version
          create_new_version: editing.status === 'PUBLISHED',
        }
        await updateChallenge(editing.id, payload)
      } else {
        const payload: Record<string, unknown> = {
          title: form.title.trim(),
          description: form.description.trim() || null,
          type: form.type,
          starts_at: form.starts_at,
          ends_at: form.ends_at,
          rules,
          target_value: form.target_value ? Number(form.target_value) : null,
          repeat_allowed: form.repeat_allowed,
          visibility: form.visibility,
        }
        await createChallenge(payload)
      }
      setFormOpen(false)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setFormBusy(false)
    }
  }

  const runPublish = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      await publishChallenge(pending.id)
      setPending(null)
      load()
    } catch (e) {
      setError(extractError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Челленджи">
      <div className="admin-page-head">
        <h1>Челленджи</h1>
        {can('challenges:manage') && (
          <button type="button" className="admin-btn admin-btn-primary" onClick={openCreate}>
            + Создать челлендж
          </button>
        )}
      </div>
      <div className="admin-toolbar">
        <Field id="ch-status" label="Статус">
          <select id="ch-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="DRAFT">Черновик</option>
            <option value="PUBLISHED">Опубликован</option>
            <option value="UNPUBLISHED">Снят с публикации</option>
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список челленджей</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Тип</th>
                <th scope="col">Период</th>
                <th scope="col">Статус</th>
                <th scope="col">Версия</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Челленджей нет</td>
                </tr>
              )}
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.title}</strong>
                  </td>
                  <td>{TYPE_OPTIONS.find(([v]) => v === c.type)?.[1] ?? c.type}</td>
                  <td>{fmtDate(c.starts_at)} — {fmtDate(c.ends_at)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.version}{c.published_version ? ` / ${c.published_version}` : ''}</td>
                  <td className="admin-actions">
                    {can('challenges:manage') && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(c)}>
                        Изменить
                      </button>
                    )}
                    {can('challenges:manage') && c.status === 'DRAFT' && (
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setPending({ id: c.id, title: c.title })}>
                        Опубликовать
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

      {formOpen && (
        <Modal title={editing ? `Редактирование: ${editing.title}` : 'Новый челлендж'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={submitForm}>
            <div className="admin-form-grid">
              <Field id="ch-title" label="Название" required>
                <input id="ch-title" className="admin-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <Field id="ch-type" label="Тип">
                <select id="ch-type" className="admin-input" value={form.type} disabled={!!editing} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPE_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field id="ch-start" label="Начало" required>
                <input id="ch-start" className="admin-input" type="date" value={form.starts_at} disabled={!!editing} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
              </Field>
              <Field id="ch-end" label="Окончание" required>
                <input id="ch-end" className="admin-input" type="date" value={form.ends_at} disabled={!!editing} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} required />
              </Field>
              <Field id="ch-target" label="Целевое значение">
                <input id="ch-target" className="admin-input" type="number" step="any" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
              </Field>
              <Field id="ch-visibility" label="Видимость">
                <select id="ch-visibility" className="admin-input" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
                  <option value="PUBLIC">Публичный</option>
                  <option value="PRIVATE">Приватный</option>
                </select>
              </Field>
            </div>
            <Field id="ch-desc" label="Описание">
              <textarea id="ch-desc" className="admin-input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <Field id="ch-rules" label="Правила (JSON)" hint="Например: {&quot;min_workouts_per_week&quot;: 3}">
              <textarea id="ch-rules" className="admin-input admin-mono" rows={4} value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} />
            </Field>
            <label className="admin-check">
              <input type="checkbox" checked={form.repeat_allowed} onChange={(e) => setForm({ ...form, repeat_allowed: e.target.checked })} />
              Разрешить повторное участие
            </label>
            {editing && editing.status === 'PUBLISHED' && (
              <p role="status" className="admin-info-note">
                Челлендж опубликован: сохранение изменений создаст новую версию (MUST_CREATE_NEW_VERSION).
              </p>
            )}
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
        state={
          pending
            ? {
                open: true,
                title: 'Публикация челленджа',
                description: `Челлендж «${pending.title}» станет видимым для пользователей. Будет сохранена версия-снимок. Критичное действие.`,
                confirmLabel: 'Опубликовать',
              }
            : closedConfirm()
        }
        busy={busy}
        error={error}
        onConfirm={runPublish}
        onClose={() => setPending(null)}
      />
    </section>
  )
}
