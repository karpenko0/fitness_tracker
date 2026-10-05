import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAdmin } from '../store'
import { adminLogout, listSessions } from '../auth'
import { roleLabel } from '../format'
import StepUpDialog from './StepUpDialog'
import { ErrorBanner } from './ui'
import { extractError } from '../api'

export type MenuItem = {
  to: string
  label: string
  /** Permission required to see the menu item (deny-by-default). */
  permission?: string
}

export const MENU: MenuItem[] = [
  { to: '/admin', label: 'Обзор' },
  { to: '/admin/users', label: 'Пользователи', permission: 'users:read' },
  { to: '/admin/billing', label: 'Биллинг', permission: 'billing:read' },
  { to: '/admin/exercises', label: 'Упражнения', permission: 'content:read' },
  { to: '/admin/programs', label: 'Программы', permission: 'content:read' },
  { to: '/admin/promos', label: 'Промокоды', permission: 'promo:manage' },
  { to: '/admin/notifications', label: 'Уведомления', permission: 'notifications:manage' },
  { to: '/admin/challenges', label: 'Челленджи', permission: 'challenges:manage' },
  { to: '/admin/habits', label: 'Привычки', permission: 'habits:manage' },
  { to: '/admin/analytics', label: 'Аналитика', permission: 'analytics:read' },
  { to: '/admin/audit-logs', label: 'Журнал аудита', permission: 'audit:read' },
  { to: '/admin/exports', label: 'Экспорт', permission: 'exports:create' },
  { to: '/admin/roles', label: 'Роли и права', permission: 'roles:read' },
  { to: '/admin/settings', label: 'Настройки', permission: 'settings:manage' },
]

export default function AdminLayout() {
  const { me, loading, can } = useAdmin()
  const navigate = useNavigate()
  const [logoutError, setLogoutError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="admin-shell">
        <p className="admin-loading" role="status">
          Проверка прав доступа…
        </p>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="admin-shell">
        <div className="admin-403">
          <h1>Нет доступа</h1>
          <p>Сессия администратора недействительна.</p>
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={() => navigate('/admin/login')}
          >
            Войти
          </button>
        </div>
      </div>
    )
  }

  const visibleMenu = MENU.filter((m) => !m.permission || can(m.permission))

  const doLogout = async () => {
    setLogoutError(null)
    try {
      const sessions = await listSessions()
      const current = sessions.find((s) => s.is_current)
      await adminLogout(current?.id ?? null)
    } catch (e) {
      // adminLogout clears the local token regardless; surface only real errors
      const err = extractError(e)
      if (err.status !== 401 && err.code !== 'FORBIDDEN') setLogoutError(err.message)
    }
    navigate('/admin/login')
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Меню панели администратора">
        <div className="admin-sidebar-brand">
          <span className="admin-logo">🏋️</span>
          <span>FitTrack · Admin</span>
        </div>
        <nav>
          <ul className="admin-menu">
            {visibleMenu.map((m) => (
              <li key={m.to}>
                <NavLink
                  to={m.to}
                  end={m.to === '/admin'}
                  className={({ isActive }) => 'admin-menu-link' + (isActive ? ' is-active' : '')}
                >
                  {m.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <span className="admin-user">
            {me.email} · <strong>{roleLabel(me.role)}</strong>
          </span>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={doLogout}>
            Выйти
          </button>
        </header>
        <ErrorBanner error={logoutError ? { message: logoutError } : null} />
        <main className="admin-content" id="admin-content">
          <Outlet />
        </main>
      </div>
      <StepUpDialog />
    </div>
  )
}

export function ForbiddenScreen({ message = 'Недостаточно прав для этого действия' }: { message?: string }) {
  return (
    <div className="admin-403">
      <h1>403 — Недостаточно прав</h1>
      <p>{message}</p>
      <p className="admin-403-hint">
        Доступ ограничен политикой RBAC (отказ по умолчанию). Если вы считаете это ошибкой —
        обратитесь к супер-администратору.
      </p>
    </div>
  )
}
