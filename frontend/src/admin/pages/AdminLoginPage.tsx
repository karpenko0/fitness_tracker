import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminLogin, adminMfaVerify } from '../auth'
import { extractError } from '../api'
import { ErrorBanner, Field } from '../components/ui'

const ERROR_TEXT: Record<string, string> = {
  INVALID_CREDENTIALS: 'Неверный email или пароль',
  ACCOUNT_BLOCKED: 'Аккаунт заблокирован. Обратитесь к супер-администратору',
  FORBIDDEN: 'У этого аккаунта нет роли администратора',
  MFA_INVALID: 'Неверный код двухфакторной аутентификации',
  CHALLENGE_EXPIRED: 'Сессия входа истекла — войдите заново',
}

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code?: string; message: string } | null>(null)

  const showError = (e: unknown) => {
    const err = extractError(e)
    setError({ code: err.code, message: ERROR_TEXT[err.code] || err.message })
  }

  const submit = async () => {
    if (challengeId) {
      if (!mfaCode) {
        setError({ code: 'MFA_REQUIRED', message: 'Введите код двухфакторной аутентификации' })
        return
      }
      setBusy(true)
      setError(null)
      try {
        await adminMfaVerify({ email, password, challenge_id: challengeId, code: mfaCode })
        navigate('/admin')
      } catch (e) {
        showError(e)
        setBusy(false)
      }
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await adminLogin(email, password)
      if (res.mfa_required && res.challenge_id) {
        setChallengeId(res.challenge_id)
        setBusy(false)
        return
      }
      navigate('/admin')
    } catch (e) {
      showError(e)
      setBusy(false)
    }
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <span className="admin-logo" aria-hidden="true">
            🏋️
          </span>
          <h1>Панель администратора FitTrack</h1>
        </div>
        <p className="admin-login-subtitle">Вход по служебной учётной записи с ролью администратора</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Field id="admin-email" label="Email" required>
            <input
              id="admin-email"
              className="admin-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field id="admin-password" label="Пароль" required>
            <input
              id="admin-password"
              className="admin-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {challengeId && (
            <Field id="admin-mfa" label="Код двухфакторной аутентификации" required hint="Код из вашего приложения-аутентификатора">
              <input
                id="admin-mfa"
                className="admin-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                required
                minLength={4}
                maxLength={32}
              />
            </Field>
          )}
          <ErrorBanner error={error} />
          <button type="submit" className="admin-btn admin-btn-primary admin-btn-block" disabled={busy || !email || !password}>
            {busy ? 'Вход…' : challengeId ? 'Подтвердить код' : 'Войти'}
          </button>
        </form>
        <p className="admin-login-hint">
          Все действия администратора журналируются (append-only).
        </p>
      </div>
    </div>
  )
}
