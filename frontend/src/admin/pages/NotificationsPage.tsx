import { useCallback, useEffect, useState, type FormEvent} from 'react'
import {
  cancelCampaign,
  confirmCampaign,
  createCampaign,
  createTemplate,
  listCampaigns,
  listTemplates,
  previewCampaign,
  updateTemplate,
  Campaign,
  CampaignPreview,
  Template,
} from '../services/catalog'
import { extractError } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

export default function NotificationsPage() {
  const { can } = useAdmin()
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)

  const [tplForm, setTplForm] = useState({ name: '', event: '', channels: 'telegram', templateRu: '' })
  const [tplBusy, setTplBusy] = useState(false)

  const [campForm, setCampForm] = useState({ template_id: '', name: '', audience: '', reason: '' })
  const [campBusy, setCampBusy] = useState(false)

  const [preview, setPreview] = useState<CampaignPreview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  const [pending, setPending] = useState<{ type: 'confirm'; id: string; name: string; count: number } | { type: 'cancel'; id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    listTemplates({ pageSize: 50 }).then((r) => setTemplates(r.items)).catch((e) => setError(extractError(e)))
    listCampaigns({ page, pageSize: 20 })
      .then((r) => { setCampaigns(r.items); setTotal(r.total) })
      .catch((e) => setError(extractError(e)))
  }, [page])

  useEffect(() => {
    load()
  }, [load])

  const submitTemplate = async (ev: FormEvent) => {
    ev.preventDefault()
    setTplBusy(true)
    setError(null)
    try {
      await createTemplate({
        name: tplForm.name.trim(),
        event: tplForm.event.trim(),
        channels: tplForm.channels.split(',').map((s) => s.trim()).filter(Boolean),
        templates: { ru: tplForm.templateRu },
        timezone_policy: 'user',
        timezone_fixed: null,
        quiet_hours_start: null,
        quiet_hours_end: null,
        rate_limit_per_day: null,
      })
      setTplForm({ name: '', event: '', channels: 'telegram', templateRu: '' })
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setTplBusy(false)
    }
  }

  const toggleTemplateStatus = async (t: Template) => {
    setError(null)
    const next = t.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE'
    try {
      await updateTemplate(t.id, { status: next })
      load()
    } catch (e) {
      setError(extractError(e))
    }
  }

  const submitCampaign = async (ev: FormEvent) => {
    ev.preventDefault()
    let segment: Record<string, unknown> | null = null
    if (campForm.audience.trim()) {
      try {
        segment = JSON.parse(campForm.audience)
      } catch {
        setError({ code: 'VALIDATION_ERROR', message: 'Сегмент аудитории: ожидается JSON' })
        return
      }
    }
    setCampBusy(true)
    setError(null)
    try {
      await createCampaign({
        template_id: campForm.template_id,
        name: campForm.name.trim(),
        audience_segment: segment,
        reason: campForm.reason.trim() || null,
      })
      setCampForm({ template_id: '', name: '', audience: '', reason: '' })
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setCampBusy(false)
    }
  }

  const doPreview = async (c: Campaign) => {
    setPreviewBusy(true)
    setError(null)
    try {
      const p = await previewCampaign(c.id)
      setPreview(p)
      load()
    } catch (e) {
      setError(extractError(e))
    } finally {
      setPreviewBusy(false)
    }
  }

  const runConfirm = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      if (pending.type === 'confirm') {
        await confirmCampaign(pending.id)
      } else {
        await cancelCampaign(pending.id)
      }
      setPending(null)
      setPreview(null)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Уведомления">
      <h1>Уведомления</h1>
      <ErrorBanner error={error} />
      <div className="admin-subsection">
        <h2>Шаблоны</h2>
        {can('notifications:manage') && (
          <form className="admin-toolbar" onSubmit={submitTemplate}>
            <Field id="tpl-name" label="Название" required>
              <input id="tpl-name" className="admin-input" value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} required />
            </Field>
            <Field id="tpl-event" label="Событие" required hint="Например: workout_reminder">
              <input id="tpl-event" className="admin-input" value={tplForm.event} onChange={(e) => setTplForm({ ...tplForm, event: e.target.value })} required />
            </Field>
            <Field id="tpl-channels" label="Каналы (через запятую)">
              <input id="tpl-channels" className="admin-input" value={tplForm.channels} onChange={(e) => setTplForm({ ...tplForm, channels: e.target.value })} />
            </Field>
            <Field id="tpl-text" label="Текст (ru)" required hint="Плейсхолдеры вида {var} проверяются сервером">
              <input id="tpl-text" className="admin-input" value={tplForm.templateRu} onChange={(e) => setTplForm({ ...tplForm, templateRu: e.target.value })} required />
            </Field>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={tplBusy}>
              {tplBusy ? 'Сохранение…' : 'Создать шаблон'}
            </button>
          </form>
        )}
        {templates === null ? (
          <Loading />
        ) : (
          <table className="admin-table">
            <caption className="admin-visually-hidden">Шаблоны уведомлений</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Событие</th>
                <th scope="col">Каналы</th>
                <th scope="col">Текст (ru)</th>
                <th scope="col">Статус</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Шаблонов нет</td>
                </tr>
              )}
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td><code>{t.event}</code></td>
                  <td>{t.channels.join(', ')}</td>
                  <td className="admin-muted">{(t.templates.ru || '').slice(0, 60)}…</td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>
                    {can('notifications:manage') && t.status !== 'DELETED' && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => toggleTemplateStatus(t)}>
                        {t.status === 'ACTIVE' ? 'Деактивировать' : 'Активировать'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-subsection">
        <h2>Рассылки</h2>
        <p className="admin-muted">
          Массовая рассылка: создание → предпросмотр аудитории → подтверждение (только супер-администратор,
          «notifications:send»). Повторная отправка одной и той же рассылки невозможна.
        </p>
        {can('notifications:manage') && (
          <form className="admin-toolbar" onSubmit={submitCampaign}>
            <Field id="camp-tpl" label="Шаблон" required>
              <select id="camp-tpl" className="admin-input" value={campForm.template_id} onChange={(e) => setCampForm({ ...campForm, template_id: e.target.value })} required>
                <option value="">Выберите…</option>
                {(templates || []).filter((t) => t.status === 'ACTIVE').map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="camp-name" label="Название рассылки" required>
              <input id="camp-name" className="admin-input" value={campForm.name} onChange={(e) => setCampForm({ ...campForm, name: e.target.value })} required />
            </Field>
            <Field id="camp-aud" label="Сегмент (JSON, пусто = все)">
              <input id="camp-aud" className="admin-input admin-mono" value={campForm.audience} onChange={(e) => setCampForm({ ...campForm, audience: e.target.value })} />
            </Field>
            <Field id="camp-reason" label="Причина">
              <input id="camp-reason" className="admin-input" value={campForm.reason} onChange={(e) => setCampForm({ ...campForm, reason: e.target.value })} />
            </Field>
            <button type="submit" className="admin-btn admin-btn-primary" disabled={campBusy}>
              {campBusy ? 'Создание…' : 'Создать рассылку'}
            </button>
          </form>
        )}
        {campaigns === null ? (
          <Loading />
        ) : (
          <table className="admin-table">
            <caption className="admin-visually-hidden">Рассылки</caption>
            <thead>
              <tr>
                <th scope="col">Название</th>
                <th scope="col">Шаблон</th>
                <th scope="col">Получателей</th>
                <th scope="col">Статус</th>
                <th scope="col">Отправлено</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Рассылок нет</td>
                </tr>
              )}
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.template_name || '—'}</td>
                  <td>{c.expected_recipients ?? '—'}{c.sent_count ? ` (отправлено: ${c.sent_count})` : ''}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{fmtDate(c.sent_at)}</td>
                  <td className="admin-actions">
                    {c.status === 'DRAFT' && (
                      <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" disabled={previewBusy} onClick={() => doPreview(c)}>
                        Предпросмотр
                      </button>
                    )}
                    {c.status === 'PREVIEWED' && can('notifications:send') && (
                      <button
                        type="button"
                        className="admin-btn admin-btn-primary admin-btn-sm"
                        onClick={() => setPending({ type: 'confirm', id: c.id, name: c.name, count: c.expected_recipients ?? 0 })}
                      >
                        Отправить
                      </button>
                    )}
                    {['DRAFT', 'PREVIEWED', 'SCHEDULED'].includes(c.status) && (
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => setPending({ type: 'cancel', id: c.id, name: c.name })}>
                        Отменить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={page} pageSize={20} total={total} onPage={setPage} />
      </div>

      {preview && (
        <Modal title={`Предпросмотр: ${preview.name}`} onClose={() => setPreview(null)}>
          <p>
            Получателей: <strong>{preview.preview.recipients}</strong>
          </p>
          {preview.preview.sample && (
            <div className="admin-preview-sample">
              {Object.entries(preview.preview.sample).map(([locale, text]) => (
                <p key={locale}>
                  <strong>{locale}:</strong> {text}
                </p>
              ))}
            </div>
          )}
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setPreview(null)}>
              Закрыть
            </button>
            {can('notifications:send') && (
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={() => setPending({ type: 'confirm', id: preview.id, name: preview.name, count: preview.preview.recipients })}
              >
                Отправить
              </button>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        state={
          pending
            ? pending.type === 'confirm'
              ? {
                  open: true,
                  title: 'Отправка рассылки',
                  description: `Рассылка «${pending.name}» будет отправлена ${pending.count} получателям. Действие необратимо и выполняется только супер-администратором.`,
                  requireReason: true,
                  minReasonLength: 5,
                  confirmLabel: 'Отправить рассылку',
                  danger: true,
                }
              : {
                  open: true,
                  title: 'Отмена рассылки',
                  description: `Рассылка «${pending.name}» будет отменена.`,
                  confirmLabel: 'Отменить рассылку',
                  danger: true,
                }
            : closedConfirm()
        }
        busy={busy}
        error={error}
        onConfirm={runConfirm}
        onClose={() => setPending(null)}
      />
    </section>
  )
}
