import { useCallback, useEffect, useState, type FormEvent} from 'react'
import {
  createPromoCode,
  listPromoCodes,
  redeemPromoCode,
  updatePromoCode,
  PromoCode,
} from '../services/catalog'
import { extractError, newIdempotencyKey } from '../api'
import { useAdmin } from '../store'
import { ConfirmDialog, closedConfirm, ConfirmState } from '../components/ConfirmDialog'
import { ErrorBanner, Field, Loading, Modal, Pagination, SearchBox, StatusBadge } from '../components/ui'
import { fmtDate } from '../format'

type Pending =
  | { type: 'create'; payload: Record<string, unknown> }
  | { type: 'status'; id: string; code: string; status: string }
  | { type: 'maxuses'; id: string; code: string; maxUses: number }
  | null

function confirmFor(p: NonNullable<Pending>): ConfirmState {
  switch (p.type) {
    case 'create':
      return {
        open: true,
        title: 'Создание промокода',
        description: `Промокод «${(p.payload.code as string).toUpperCase()}» будет создан. Критичное действие: изменение лимитов потом тоже логируется.`,
        confirmLabel: 'Создать',
      }
    case 'status':
      return {
        open: true,
        title: 'Смена статуса промокода',
        description: `Промокод «${p.code}» станет «${p.status}».`,
        requireReason: true,
        minReasonLength: 5,
        confirmLabel: 'Сохранить статус',
        danger: p.status === 'ARCHIVED',
      }
    case 'maxuses':
      return {
        open: true,
        title: 'Изменение лимита промокода',
        description: `Лимит использований промокода «${p.code}» будет изменён на ${p.maxUses}. Изменение лимитов аудируется (SPEC-011 6.9).`,
        requireReason: true,
        minReasonLength: 5,
        confirmLabel: 'Изменить лимит',
      }
  }
}

const emptyForm = {
  code: '',
  discount_type: 'PERCENT',
  discount_value: 10,
  currency: 'USD',
  starts_at: '',
  ends_at: '',
  max_uses: 0,
  plan_codes: '',
  reason: '',
}

export default function PromosPage() {
  const { can } = useAdmin()
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: PromoCode[]; total: number } | null>(null)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [redeemFor, setRedeemFor] = useState<PromoCode | null>(null)
  const [redeemUser, setRedeemUser] = useState('')
  const [redeemKey, setRedeemKey] = useState<string>(() => newIdempotencyKey())
  const [redeemBusy, setRedeemBusy] = useState(false)
  const [redeemResult, setRedeemResult] = useState<string | null>(null)
  const [maxUsesFor, setMaxUsesFor] = useState<PromoCode | null>(null)
  const [maxUsesValue, setMaxUsesValue] = useState(0)

  const load = useCallback(() => {
    setLoading(true)
    listPromoCodes({ q: q || undefined, page, pageSize: 20 })
      .then((r) => setData({ items: r.items, total: r.total }))
      .catch((e) => setError(extractError(e)))
      .finally(() => setLoading(false))
  }, [q, page])

  useEffect(() => {
    load()
  }, [load])

  const submitForm = async (ev: FormEvent) => {
    ev.preventDefault()
    setError(null)
    if (form.ends_at && form.starts_at && new Date(form.ends_at) < new Date(form.starts_at)) {
      setError({ code: 'VALIDATION_ERROR', message: 'Дата окончания должна быть не раньше даты начала' })
      return
    }
    setPending({
      type: 'create',
      payload: {
        code: form.code.trim(),
        discount_type: form.discount_type,
        discount_value: Number(form.discount_value),
        currency: form.currency.trim().toUpperCase(),
        starts_at: form.starts_at,
        ends_at: form.ends_at,
        max_uses: Number(form.max_uses) || 0,
        plan_codes: form.plan_codes ? form.plan_codes.split(',').map((s) => s.trim()).filter(Boolean) : null,
        reason: form.reason.trim(),
      },
    })
  }

  const runConfirm = async (_reason: string) => {
    if (!pending) return
    setBusy(true)
    setError(null)
    const p = pending
    try {
      if (p.type === 'create') {
        await createPromoCode(p.payload)
        setFormOpen(false)
        setForm(emptyForm)
      } else if (p.type === 'status') {
        // strict DTO + exclude_unset: send ONLY the status, nothing else
        await updatePromoCode(p.id, { status: p.status })
      } else if (p.type === 'maxuses') {
        await updatePromoCode(p.id, { max_uses: p.maxUses })
        setMaxUsesFor(null)
      }
      setPending(null)
      load()
    } catch (e) {
      const err = extractError(e)
      setError({ code: err.code, message: Array.isArray(err.details) ? err.details.join('; ') : err.message })
    } finally {
      setBusy(false)
    }
  }

  const doRedeem = async () => {
    if (!redeemFor || !redeemUser) return
    setRedeemBusy(true)
    setError(null)
    setRedeemResult(null)
    try {
      const res = await redeemPromoCode(redeemFor.id, redeemUser, redeemKey)
      setRedeemResult(
        typeof res === 'string' ? res : JSON.stringify(res),
      )
    } catch (e) {
      const err = extractError(e)
      // Same key + same body is retried safely (idempotent); a changed body -> 409.
      setError({ code: err.code, message: `${err.message} (ключ идемпотентности ${redeemKey.slice(0, 8)}… будет переиспользован при повторе)` })
    } finally {
      setRedeemBusy(false)
    }
  }

  return (
    <section aria-label="Промокоды">
      <div className="admin-page-head">
        <h1>Промокоды</h1>
        {can('promo:manage') && (
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={() => { setForm(emptyForm); setFormOpen(true) }}
          >
            + Создать промокод
          </button>
        )}
      </div>
      <p className="admin-muted">
        Промокоды хранятся в виде хэша (SHA-256) — в интерфейсе показывается только нормализованный код.
        Скидка 0% допустима. Изменение лимитов и статусов записывается в журнал.
      </p>
      <div className="admin-toolbar">
        <SearchBox value={q} onChange={setQ} label="Поиск по промокодам" placeholder="Код…" />
      </div>
      <ErrorBanner error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && (
        <>
          <table className="admin-table">
            <caption className="admin-visually-hidden">Список промокодов</caption>
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Скидка</th>
                <th scope="col">Действует</th>
                <th scope="col">Использований</th>
                <th scope="col">Статус</th>
                <th scope="col">
                  <span className="admin-visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="admin-empty">Промокодов нет</td>
                </tr>
              )}
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.code}</code></td>
                  <td>
                    {p.discount_type === 'PERCENT' ? `${p.discount_value}%` : `${p.discount_value} ${p.currency}`}
                  </td>
                  <td>{fmtDate(p.starts_at)} — {fmtDate(p.ends_at)}</td>
                  <td>{p.used_count} / {p.max_uses || '∞'}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="admin-actions">
                    <button type="button" className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => { setRedeemFor(p); setRedeemUser(''); setRedeemKey(newIdempotencyKey()); setRedeemResult(null) }}>
                      Тестовое использование
                    </button>
                    {can('promo:manage') && p.status === 'DRAFT' && (
                      <button type="button" className="admin-btn admin-btn-primary admin-btn-sm" onClick={() => setPending({ type: 'status', id: p.id, code: p.code, status: 'ACTIVE' })}>
                        Активировать
                      </button>
                    )}
                    {can('promo:manage') && (p.status === 'ACTIVE' || p.status === 'DRAFT') && (
                      <button type="button" className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => setPending({ type: 'status', id: p.id, code: p.code, status: 'ARCHIVED' })}>
                        В архив
                      </button>
                    )}
                    {can('promo:manage') && (
                      <button type="button" className="admin-btn admin-btn-ghost admin-btn-sm" onClick={() => { setMaxUsesFor(p); setMaxUsesValue(p.max_uses) }}>
                        Лимит
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
        <Modal title="Новый промокод" onClose={() => setFormOpen(false)} wide>
          <form onSubmit={submitForm}>
            <div className="admin-form-grid">
              <Field id="promo-code" label="Код" required hint="Минимум 3 символа; хранится в виде хэша">
                <input id="promo-code" className="admin-input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required minLength={3} maxLength={64} />
              </Field>
              <Field id="promo-type" label="Тип скидки">
                <select id="promo-type" className="admin-input" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
                  <option value="PERCENT">Процент (0–100%)</option>
                  <option value="FIXED">Фиксированная сумма</option>
                </select>
              </Field>
              <Field id="promo-value" label="Значение" required>
                <input id="promo-value" className="admin-input" type="number" min={0} step="any" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })} required />
              </Field>
              {form.discount_type === 'FIXED' && (
                <Field id="promo-currency" label="Валюта" required>
                  <input id="promo-currency" className="admin-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} required minLength={3} maxLength={3} />
                </Field>
              )}
              <Field id="promo-start" label="Начало" required>
                <input id="promo-start" className="admin-input" type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
              </Field>
              <Field id="promo-end" label="Окончание" required>
                <input id="promo-end" className="admin-input" type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} required />
              </Field>
              <Field id="promo-max" label="Лимит использований (0 = без лимита)">
                <input id="promo-max" className="admin-input" type="number" min={0} value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: Number(e.target.value) })} />
              </Field>
            </div>
            <Field id="promo-plans" label="Тарифы (через запятую; пусто = все)">
              <input id="promo-plans" className="admin-input" value={form.plan_codes} onChange={(e) => setForm({ ...form, plan_codes: e.target.value })} />
            </Field>
            <Field id="promo-reason" label="Причина создания" required hint="Минимум 5 символов; попадёт в журнал">
              <input id="promo-reason" className="admin-input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required minLength={5} />
            </Field>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setFormOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="admin-btn admin-btn-primary">Далее — подтверждение</button>
            </div>
          </form>
        </Modal>
      )}

      {redeemFor && (
        <Modal title={`Тестовое использование: ${redeemFor.code}`} onClose={() => setRedeemFor(null)}>
          <p className="admin-muted">
            Использование выполняется транзакционно и идемпотентно: повтор с тем же ключом вернёт тот же результат.
          </p>
          <Field id="redeem-user" label="ID пользователя" required>
            <input id="redeem-user" className="admin-input admin-mono" value={redeemUser} onChange={(e) => setRedeemUser(e.target.value)} placeholder="uuid пользователя" />
          </Field>
          <Field id="redeem-key" label="Ключ идемпотентности" hint="Переиспользуется при повторе того же запроса; новый запрос — новый ключ">
            <input id="redeem-key" className="admin-input admin-mono" value={redeemKey} onChange={(e) => setRedeemKey(e.target.value)} />
          </Field>
          {redeemResult && <p role="status" className="admin-success">Результат: {redeemResult}</p>}
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setRedeemFor(null)} disabled={redeemBusy}>
              Закрыть
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={doRedeem} disabled={redeemBusy || !redeemUser}>
              {redeemBusy ? 'Обработка…' : 'Проверить'}
            </button>
          </div>
        </Modal>
      )}

      {maxUsesFor && (
        <Modal title={`Лимит: ${maxUsesFor.code}`} onClose={() => setMaxUsesFor(null)}>
          <Field id="maxuses" label="Новый лимит (0 = без лимита)">
            <input id="maxuses" className="admin-input" type="number" min={0} value={maxUsesValue} onChange={(e) => setMaxUsesValue(Number(e.target.value))} />
          </Field>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setMaxUsesFor(null)}>
              Отмена
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => setPending({ type: 'maxuses', id: maxUsesFor.id, code: maxUsesFor.code, maxUses: maxUsesValue })}>
              Далее — подтверждение
            </button>
          </div>
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
