import { useState } from 'react'
import { useAdmin } from '../store'
import { Field, Modal, ErrorBanner } from './ui'

/** Step-up re-authentication (SPEC-011 6.1.3): the backend answers critical actions
 *  with 401 STEP_UP_REQUIRED when the admin session is idle/expired. */
export default function StepUpDialog() {
  const { me, stepUpOpen, closeStepUp, stepUp } = useAdmin()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)

  if (!stepUpOpen || !me) return null

  const close = () => {
    setError(null)
    setPassword('')
    setCode('')
    closeStepUp()
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    const ok = await stepUp(password, me.mfa_required ? code : undefined)
    setBusy(false)
    if (!ok) {
      setError({ code: 'REAUTH_FAILED', message: 'Неверный пароль' + (me.mfa_required ? ' или код МФА' : '') })
      return
    }
    close()
  }

  return (
    <Modal title="Повторная аутентификация" onClose={close}>
      <p className="admin-confirm-desc">
        Для выполнения критичного действия необходимо подтвердить личность. Введите пароль
        {me.mfa_required && ' и код двухфакторной аутентификации'}.
      </p>
      <Field id="stepup-password" label="Пароль" required>
        <input
          id="stepup-password"
          className="admin-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {me.mfa_required && (
        <Field id="stepup-code" label="Код МФА" required>
          <input
            id="stepup-code"
            className="admin-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
      )}
      <ErrorBanner error={error} />
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn admin-btn-secondary" onClick={close} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className="admin-btn admin-btn-primary"
          disabled={busy || !password || (me.mfa_required && !code)}
          onClick={submit}
        >
          {busy ? 'Проверка…' : 'Подтвердить'}
        </button>
      </div>
    </Modal>
  )
}
