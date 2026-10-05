import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdminLayout, { MENU } from './AdminLayout'
import { useAdmin } from '../store'

vi.mock('../store', () => ({
  useAdmin: vi.fn(),
}))

vi.mock('../auth', () => ({
  adminLogout: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
}))

const mockedUseAdmin = vi.mocked(useAdmin)

function renderAs(role: 'content_manager' | 'admin' | 'super_admin', permissions: string[]) {
  mockedUseAdmin.mockReturnValue({
    me: {
      user_id: 'u1',
      email: `${role}@example.com`,
      role,
      role_source: 'manual',
      mfa_required: false,
      permissions,
    },
    roles: null,
    loading: false,
    stepUpOpen: false,
    closeStepUp: () => undefined,
    can: (p: string) => permissions.includes(p),
    refresh: async () => undefined,
    stepUp: async () => true,
  })
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <AdminLayout />
    </MemoryRouter>,
  )
}

describe('AdminLayout (RBAC side menu)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the full menu to a SUPER_ADMIN', () => {
    renderAs(
      'super_admin',
      [
        'users:read',
        'users:block',
        'billing:read',
        'content:read',
        'promo:manage',
        'notifications:manage',
        'challenges:manage',
        'habits:manage',
        'analytics:read',
        'audit:read',
        'exports:create',
        'roles:read',
        'settings:manage',
      ],
    )
    for (const item of MENU) {
      expect(screen.getByRole('link', { name: item.label })).toBeInTheDocument()
    }
  })

  it('hides restricted sections for a CONTENT_MANAGER (deny-by-default)', () => {
    renderAs('content_manager', ['content:read', 'notifications:manage', 'habits:manage', 'challenges:manage', 'analytics:read'])
    expect(screen.queryByRole('link', { name: 'Пользователи' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Биллинг' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Промокоды' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Журнал аудита' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Настройки' })).not.toBeInTheDocument()
    // content sections remain
    expect(screen.getByRole('link', { name: 'Упражнения' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Уведомления' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Аналитика' })).toBeInTheDocument()
  })

  it('hides super-admin-only Settings for an ADMIN', () => {
    renderAs(
      'admin',
      ['users:read', 'billing:read', 'content:read', 'promo:manage', 'analytics:read', 'audit:read', 'exports:create', 'roles:read'],
    )
    expect(screen.queryByRole('link', { name: 'Настройки' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Роли и права' })).toBeInTheDocument()
  })

  it('shows the current user and a logout button', () => {
    renderAs('admin', ['users:read'])
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument()
    expect(screen.getByText('Администратор')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
  })
})
