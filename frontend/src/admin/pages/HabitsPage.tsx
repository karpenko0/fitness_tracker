import { useCallback, useEffect, useState, type FormEvent} from 'react'
import { createHabit, listHabits, updateHabit, HabitDefinition } from '../services/catalog'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ErrorBanner, Field, Loading, Modal, Pagination, StatusBadge } from '../components/ui'

const GOAL_TYPES = [
  ['BOOLEAN', 'Да/нет'],
  ['COUNT', 'Количество'],
  ['DURATION_MINUTES', 'Минуты'],
  ['QUANTITY', 'Величина'],
]

const FREQUENCIES = [
  ['DAILY', 'Ежедневно'],
  ['WEEKDAYS', 'Будни'],
  ['WEEKLY', 'Раз в неделю'],
]

export default function HabitsPage() {
  const { can } = useAdmin()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: HabitDefinition[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<HabitDefinition | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    goal_type: 'BOOLEAN',
    target_value: '',
    unit: '',
    frequency: 'DAILY',
    allowed_min: '',
    allowed_max: '',
  })
  const [formBusy, setFormBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listHabits({ status_filter: statusFilter || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [statusFilter, page])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm({ title: '', description: '', goal_type: 'BOOLEAN', target_value: '', unit: '', frequency: 'DAILY', allowed_min: '', allowed_max: '' })
    setFormOpen(true)
  }

  const openEdit = (h: HabitDefinition) => {
    setEditing(h)
    setForm({
      title: h.title,
      description: h.description || '',
      goal_type: h.goal_type,
      target_value: h.target_value?.toString() || '',
      unit: h.unit || '',
      frequency: h.frequency,
      allowed_min: h.allowed_min?.toString() || '',
      allowed_max: h.allowed_max?.toString() || '',
    })
    setFormOpen(true)
  }

  const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s))

  const submitForm = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormBusy(true)
    setError(null)
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      goal_type: form.goal_type,
      target_value: numOrNull(form.target_value),
      unit: form.unit.trim() || null,
      frequency: form.frequency,
      allowed_min: numOrNull(form.allowed_min),
      allowed_max: numOrNull(form.allowed_max),
    }
    if (editing) {
      delete payload.goal_type
      delete payload.frequency
    }
    try {
      if (editing) await updateHabit(editing.id, payload)
      else await createHabit(payload)
      setFormOpen(false)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setFormBusy(false)
    }
  }

  const toggleStatus = async (h: HabitDefinition) => {
    setError(null)
    const next = h.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    try {
      // HabitDefinitionUpdate: status changes are versioned server-side, no extra flag
      await updateHabit(h.id, { status: next })
      load()
    } catch (e) {
      setError(extractError(e))
    }
  }

  return (
    <section aria-label="Привычки">
      <div className="admin-page-head">
        <h1>Каталог привычек</h1>
        {can('habits:manage') && (
          <button type="button" className="admin-btn admin-btn-primary" onClick={openCreate}>
            + Создать привычку
          </button>
        )}
      </div>
      <div className="admin-toolbar">
        <Field id="hb-status" label="Статус">
          <select id="hb-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="DRAFT">Черновик</option>
            <option value="PUBLISHED">Опубликован</option>
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Каталог привычек</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Тип цели</th>
                <th scope="col">Цель</th>
                <th scope="col">Частота</th>
                <th scope="col">Статус</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Привычек нет</td>
                </tr>
              )}
              {data.items.map((h) => (
                <tr key={h.id}>
                  <td>{h.title}</td>
                  <td>{GOAL_TYPES.find(([v]) => v === h.goal_type)?.[1] ?? h.goal_type}</td>
                  <td>
                    {h.target_value ?? '—'} {h.unit || ''}
                    {h.allowed_min != null || h.allowed_max != null ? ` (допустимо ${h.allowed_min ?? '…'}–${h.allowed_max ?? '…'})` : ''}
                  </td>
                  <td>{FREQUENCIES.find(([v]) => v === h.frequency)?.[1] ?? h.frequency}</td>
                  <td><StatusBadge status={h.status} /></td>
                  <td className="admin-actions">
                    {can('habits:manage') && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(h)}>
                        Изменить
                      </button>
                    )}
                    {can('habits:manage') && h.status === 'DRAFT' && (
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => toggleStatus(h)}>
                        Опубликовать
                      </button>
                    )}
                    {can('habits:manage') && h.status === 'PUBLISHED' && (
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => toggleStatus(h)}>
                        В черновики
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
        <Modal title={editing ? `Редактирование: ${editing.title}` : 'Новая привычка'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={submitForm}>
            <div className="admin-form-grid">
              <Field id="hb-title" label="Название" required>
                <input id="hb-title" className="admin-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              <Field id="hb-goal" label="Тип цели">
                <select id="hb-goal" className="admin-input" value={form.goal_type} disabled={!!editing} onChange={(e) => setForm({ ...form, goal_type: e.target.value })}>
                  {GOAL_TYPES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field id="hb-target" label="Целевое значение">
                <input id="hb-target" className="admin-input" type="number" step="any" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} />
              </Field>
              <Field id="hb-unit" label="Единица">
                <input id="hb-unit" className="admin-input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="стаканы, км…" />
              </Field>
              <Field id="hb-freq" label="Частота">
                <select id="hb-freq" className="admin-input" value={form.frequency} disabled={!!editing} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  {FREQUENCIES.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="admin-form-grid">
              <Field id="hb-min" label="Допустимый минимум">
                <input id="hb-min" className="admin-input" type="number" step="any" value={form.allowed_min} onChange={(e) => setForm({ ...form, allowed_min: e.target.value })} />
              </Field>
              <Field id="hb-max" label="Допустимый максимум">
                <input id="hb-max" className="admin-input" type="number" step="any" value={form.allowed_max} onChange={(e) => setForm({ ...form, allowed_max: e.target.value })} />
              </Field>
            </div>
            <Field id="hb-desc" label="Описание">
              <textarea id="hb-desc" className="admin-input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
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
    </section>
  )
}
