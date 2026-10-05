import { useState } from 'react'
import { ErrorBanner, Field, Modal } from './ui'

export type ConfirmState = {
  open: boolean
  title: string
  description?: string
  /** When true the operator must type a reason (min length enforced). */
  requireReason?: boolean
  minReasonLength?: number
  confirmLabel?: string
  danger?: boolean
}

export function closedConfirm(): ConfirmState {
  return { open: false, title: '' }
}

export function ConfirmDialog({
  state,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  state: ConfirmState
  busy: boolean
  error: { code?: string; message: string } | null
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const minLen = state.minReasonLength ?? 10
  const reasonOk = !state.requireReason || reason.trim().length >= minLen

  const reset = () => {
    setReason('')
    onClose()
  }

  if (!state.open) return null

  return (
    <Modal title={state.title} onClose={reset}>
      {state.description && <p className="admin-confirm-desc">{state.description}</p>}
      {state.requireReason && (
        <Field
          id="confirm-reason"
          label="Причина"
          required
          hint={`Не менее ${minLen} символов. Запишется в журнал действий.`}
        >
          <textarea
            id="confirm-reason"
            className="admin-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            minLength={minLen}
            aria-invalid={!reasonOk}
            aria-describedby="confirm-reason-hint"
          />
        </Field>
      )}
      <ErrorBanner error={error} />
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-secondary" onClick={reset} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className={`admin-btn ${state.danger ? 'admin-btn-danger' : 'admin-btn-primary'}`}
          disabled={!reasonOk || busy}
          onClick={() => onConfirm(reason.trim())}
        >
          {busy ? 'Выполняется…' : (state.confirmLabel ?? 'Подтвердить')}
        </button>
      </div>
    </Modal>
  )
}
