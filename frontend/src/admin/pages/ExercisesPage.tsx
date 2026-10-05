import { useCallback, useEffect, useState, type FormEvent} from 'react'
import {
  addAlternative,
  createExercise,
  deleteExercise,
  deleteMedia,
  getExercise,
  listExercises,
  listMedia,
  publishExercise,
  removeAlternative,
  unpublishExercise,
  updateExercise,
  uploadMedia,
  Exercise,
  MediaItem,
} from '../services/content'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, SearchBox, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

const TYPE_OPTIONS = [
  ['STRENGTH', 'Силовые'],
  ['CARDIO', 'Кардио'],
  ['MOBILITY', 'Мобильность'],
  ['RECOVERY', 'Восстановление'],
]

type Pending =
  | { type: 'publish'; id: string; version: number; title: string }
  | { type: 'unpublish'; id: string; title: string }
  | { type: 'delete'; id: string; title: string }
  | { type: 'delete-media'; id: string; filename: string }
  | null

function confirmFor(p: NonNullable<Pending>): ConfirmState {
  switch (p.type) {
    case 'publish':
      return {
        open: true,
        title: 'Публикация упражнения',
        description: `«${p.title}» (версия ${p.version}) станет видимым в клиентском приложении. Критичное действие.`,
        confirmLabel: 'Опубликовать',
      }
    case 'unpublish':
      return {
        open: true,
        title: 'Снятие с публикации',
        description: `«${p.title}» исчезнет из клиентского приложения. История публикаций сохраняется.`,
        requireReason: true,
        minReasonLength: 5,
        confirmLabel: 'Снять с публикации',
        danger: true,
      }
    case 'delete':
      return {
        open: true,
        title: 'Удаление упражнения',
        description: `«${p.title}» будет скрыто (мягкое удаление). Если упражнение встроено в опубликованную программу — удаление будет отклонено.`,
        requireReason: true,
        confirmLabel: 'Удалить',
        danger: true,
      }
    case 'delete-media':
      return {
        open: true,
        title: 'Удаление медиафайла',
        description: `Файл «${p.filename}» будет удалён. Если он используется опубликованным контентом — операция будет отклонена.`,
        confirmLabel: 'Удалить файл',
        danger: true,
      }
  }
}

const emptyForm = {
  title: '',
  slug: '',
  type: 'STRENGTH',
  difficulty: 1,
  description: '',
  muscle_groups: '',
  equipment: '',
  unit: '',
  contraindications: '',
}

export default function ExercisesPage() {
  const { can } = useAdmin()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: Exercise[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Exercise | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formBusy, setFormBusy] = useState(false)

  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)

  const [media, setMedia] = useState<MediaItem[] | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const [mediaAlt, setMediaAlt] = useState('')
  const [mediaBusy, setMediaBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    listExercises({ q: q || undefined, status_filter: statusFilter || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [q, statusFilter, page])

  const loadMedia = useCallback(() => {
    listMedia({ pageSize: 50 }).then((r) => setMedia(r.items)).catch(() => setMedia([]))
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (can('media:read')) loadMedia()
  }, [can, loadMedia])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (e: Exercise) => {
    setEditing(e)
    setForm({
      title: e.title,
      slug: e.slug,
      type: e.type,
      difficulty: e.difficulty,
      description: e.description || '',
      muscle_groups: (e.muscle_groups || []).join(', '),
      equipment: (e.equipment || []).join(', '),
      unit: e.unit || '',
      contraindications: e.contraindications || '',
    })
    setFormOpen(true)
  }

  const submitForm = async (ev: FormEvent) => {
    ev.preventDefault()
    setFormBusy(true)
    setError(null)
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      type: form.type,
      difficulty: Number(form.difficulty),
      description: form.description.trim() || null,
      muscle_groups: form.muscle_groups ? form.muscle_groups.split(',').map((s) => s.trim()).filter(Boolean) : null,
      equipment: form.equipment ? form.equipment.split(',').map((s) => s.trim()).filter(Boolean) : null,
      unit: form.unit.trim() || null,
      contraindications: form.contraindications.trim() || null,
    }
    if (!editing) payload.slug = form.slug.trim()
    try {
      if (editing) await updateExercise(editing.id, payload)
      else await createExercise(payload)
      setFormOpen(false)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({
        code: err.code,
        message: Array.isArray(err.details) ? err.details.join('; ') : err.message,
      })
    } finally {
      setFormBusy(false)
    }
  }

  const runConfirm = async (reason: string) => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const p = pending
    try {
      switch (p.type) {
        case 'publish':
          await publishExercise(p.id, p.version, reason || undefined)
          break
        case 'unpublish':
          await unpublishExercise(p.id, reason)
          break
        case 'delete':
          await deleteExercise(p.id, reason)
          break
        case 'delete-media':
          await deleteMedia(p.id)
          break
      }
      setPending(null)
      load()
      loadMedia()
    } catch (e) {
      setError(extractError(e))
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!mediaFile) return
    setMediaBusy(true)
    setError(null)
    try {
      await uploadMedia(mediaFile, mediaAlt)
      setMediaFile(null)
      setMediaAlt('')
      loadMedia()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: err.message })
    } finally {
      setMediaBusy(false)
    }
  }

  const [altTarget, setAltTarget] = useState<Exercise | null>(null)
  const [altId, setAltId] = useState('')
  const [altNote, setAltNote] = useState('')

  const openAlternatives = async (e: Exercise) => {
    setAltId('')
    setAltNote('')
    setAltTarget(e)
    try {
      const full = await getExercise(e.id)
      setAltTarget(full)
    } catch (err) {
      setError(extractError(err))
    }
  }

  const addAlt = async () => {
    if (!altTarget || !altId) return
    setError(null)
    try {
      await addAlternative(altTarget.id, altId, altNote || undefined)
      setAltTarget(await getExercise(altTarget.id))
      setAltId('')
      setAltNote('')
    } catch (e) {
      setError(extractError(e))
    }
  }

  return (
    <section aria-label="Упражнения">
      <div className="admin-page-head">
        <h1>Упражнения</h1>
        {can('content:write') && (
          <button type="button" className="admin-btn admin-btn-primary" onClick={openCreate}>
            + Создать упражнение
          </button>
        )}
      </div>
      <div className="admin-toolbar">
        <SearchBox value={q} onChange={setQ} label="Поиск по упражнениям" placeholder="Название или slug…" />
        <Field id="ex-status" label="Статус">
          <select id="ex-status" className="admin-input" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Все</option>
            <option value="DRAFT">Черновик</option>
            <option value="IN_REVIEW">На проверке</option>
            <option value="PUBLISHED">Опубликовано</option>
            <option value="UNPUBLISHED">Снято с публикации</option>
          </select>
        </Field>
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список упражнений</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Тип</th>
                <th scope="col">Сложность</th>
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
                  <td colSpan={6} className="admin-empty">Ничего не найдено</td>
                </tr>
              )}
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.title}</strong>
                    <div className="admin-muted"><code>{e.slug}</code></div>
                  </td>
                  <td>{TYPE_OPTIONS.find(([v]) => v === e.type)?.[1] ?? e.type}</td>
                  <td>{e.difficulty}/5</td>
                  <td><StatusBadge status={e.status} /></td>
                  <td>{e.version}</td>
                  <td className="admin-actions">
                    {can('content:write') && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => openEdit(e)}>
                        Изменить
                      </button>
                    )}
                    <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => openAlternatives(e)}>
                      Альтернативы
                    </button>
                    {can('content:publish') && e.status !== 'PUBLISHED' && (
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setPending({ type: 'publish', id: e.id, version: e.version, title: e.title })}>
                        Опубликовать
                      </button>
                    )}
                    {can('content:publish') && e.status === 'PUBLISHED' && (
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending({ type: 'unpublish', id: e.id, title: e.title })}>
                        Снять
                      </button>
                    )}
                    {can('content:write') && (
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setPending({ type: 'delete', id: e.id, title: e.title })}>
                        Удалить
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

      {can('media:read') && media && (
        <div className="admin-subsection">
          <h2>Медиафайлы</h2>
          {can('media:write') && (
            <form className="admin-toolbar" onSubmit={(ev) => { ev.preventDefault(); upload() }}>
              <Field id="media-file" label="Файл (изображение ≤10 МБ или видео ≤50 МБ)" required>
                <input id="media-file" type="file" accept="image/*,video/*" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} required />
              </Field>
              <Field id="media-alt" label="Альтернативный текст (alt)">
                <input id="media-alt" className="admin-input" value={mediaAlt} onChange={(e) => setMediaAlt(e.target.value)} />
              </Field>
              <button type="submit" className="admin-btn admin-btn-primary" disabled={!mediaFile || mediaBusy}>
                {mediaBusy ? 'Загрузка…' : 'Загрузить'}
              </button>
            </form>
          )}
          <table className="admin-table">
            <caption className="admin-visually-hidden">Медиафайлы</caption>
            <thead>
              <tr>
                <th scope="col">Файл</th>
                <th scope="col">Тип</th>
                <th scope="col">Размер</th>
                <th scope="col">Создан</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {media.map((m) => (
                <tr key={m.id}>
                  <td>{m.filename} <div className="admin-muted"><code>{m.checksum_sha256.slice(0, 12)}…</code></div></td>
                  <td>{m.kind} · {m.mime_type}</td>
                  <td>{(m.size_bytes / 1024 / 1024).toFixed(2)} МБ</td>
                  <td>{fmtDate(m.created_at)}</td>
                  <td>
                    {can('media:delete') && (
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending({ type: 'delete-media', id: m.id, filename: m.filename })}>
                        Удалить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <Modal title={editing ? `Редактирование: ${editing.title}` : 'Новое упражнение'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={submitForm}>
            <div className="admin-form-grid">
              <Field id="ex-title" label="Название" required>
                <input id="ex-title" className="admin-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </Field>
              {!editing && (
                <Field id="ex-slug" label="Slug (уникальный)" required hint="Например: squat-basics">
                  <input id="ex-slug" className="admin-input" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required pattern="^[a-z0-9-]+$" />
                </Field>
              )}
              <Field id="ex-type" label="Тип">
                <select id="ex-type" className="admin-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPE_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field id="ex-diff" label="Сложность (1–5)">
                <input id="ex-diff" className="admin-input" type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
              </Field>
            </div>
            <Field id="ex-desc" label="Описание">
              <textarea id="ex-desc" className="admin-input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div className="admin-form-grid">
              <Field id="ex-mg" label="Мышечные группы (через запятую)">
                <input id="ex-mg" className="admin-input" value={form.muscle_groups} onChange={(e) => setForm({ ...form, muscle_groups: e.target.value })} />
              </Field>
              <Field id="ex-eq" label="Оборудование (через запятую)">
                <input id="ex-eq" className="admin-input" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} />
              </Field>
              <Field id="ex-unit" label="Единица измерения">
                <input id="ex-unit" className="admin-input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="повторения, минуты…" />
              </Field>
            </div>
            <Field id="ex-contr" label="Противопоказания">
              <textarea id="ex-contr" className="admin-input" rows={2} value={form.contraindications} onChange={(e) => setForm({ ...form, contraindications: e.target.value })} />
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

      {altTarget && (
        <Modal title={`Альтернативы: ${altTarget.title}`} onClose={() => setAltTarget(null)}>
          <ul>
            {(altTarget.alternatives || []).map((a) => (
              <li key={a.id}>
                <code>{a.alternative_exercise_id.slice(0, 8)}…</code> {a.note ? `— ${a.note}` : ''}
                {can('content:write') && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-ghost admin-btn-sm"
                    onClick={async () => {
                      try {
                        await removeAlternative(altTarget.id, a.id)
                        setAltTarget(await getExercise(altTarget.id))
                      } catch (e) {
                        setError(extractError(e))
                      }
                    }}
                  >
                    Убрать
                  </button>
                )}
              </li>
            ))}
            {(altTarget.alternatives || []).length === 0 && <li>Нет альтернатив</li>}
          </ul>
          {can('content:write') && (
            <div className="admin-toolbar">
              <Field id="alt-id" label="ID упражнения-альтернативы" required>
                <input id="alt-id" className="admin-input" value={altId} onChange={(e) => setAltId(e.target.value)} placeholder="uuid" />
              </Field>
              <Field id="alt-note" label="Комментарий">
                <input id="alt-note" className="admin-input" value={altNote} onChange={(e) => setAltNote(e.target.value)} />
              </Field>
              <button type="button" className="admin-btn admin-btn-primary" onClick={addAlt} disabled={!altId}>
                Добавить
              </button>
            </div>
          )}
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
