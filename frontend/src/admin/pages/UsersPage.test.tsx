import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import UsersPage from './UsersPage'
import * as usersApi from '../services/users'
import { useAdmin } from '../store'

vi.mock('../services/users', () => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
  getUserAudit: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
  softDeleteUser: vi.fn(),
  bulkBlockPreview: vi.fn(),
  bulkBlockExecute: vi.fn(),
}))

vi.mock('../store', () => ({
  useAdmin: vi.fn(),
}))

const mockedUseAdmin = vi.mocked(useAdmin)

const sampleUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'u***@example.com',
  first_name: 'Иван',
  last_name: 'Петров',
  role: 'user',
  status: 'ACTIVE' as const,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: '2026-10-01T00:00:00Z',
}

const sampleCard = {
  id: sampleUser.id,
  email: 'u***@example.com',
  first_name: 'Иван',
  last_name: 'Петров',
  status: 'ACTIVE' as const,
  registered_at: '2026-01-01T00:00:00Z',
  last_login_at: '2026-10-01T00:00:00Z',
  timezone: 'Europe/Moscow',
  telegram: { bound: false, chat_id: null, notifications_enabled: false },
  roles: { current: 'user', source: 'default' },
  plan: null,
  subscriptions: [],
  habits_count: 0,
  last_activity_at: null,
  recent_actions: [],
}

function setup(perms: string[] = ['users:read', 'users:block', 'bulk:execute']) {
  mockedUseAdmin.mockReturnValue({
    me: { user_id: 'a1', email: 'admin@example.com', role: 'admin', role_source: 'manual', mfa_required: false, permissions: perms },
    roles: null,
    loading: false,
    stepUpOpen: false,
    closeStepUp: () => undefined,
    can: (p: string) => perms.includes(p),
    refresh: async () => undefined,
    stepUp: async () => true,
  })
  vi.mocked(usersApi.listUsers).mockResolvedValue({
    items: [sampleUser],
    page: 1,
    pageSize: 20,
    total: 1,
  })
  vi.mocked(usersApi.getUser).mockResolvedValue(sampleCard)
  vi.mocked(usersApi.getUserAudit).mockResolvedValue([])
  vi.mocked(usersApi.blockUser).mockResolvedValue({ blocked: true })
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  )
}

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists users with masked emails', async () => {
    setup()
    await waitFor(() => expect(screen.getByText('u***@example.com')).toBeInTheDocument())
    expect(usersApi.listUsers).toHaveBeenCalled()
  })

  it('opens the user card and blocks the user with a 10+ char reason', async () => {
    setup()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Карточка' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Карточка' }))
    // two dialogs: the user card (first) and, after confirm open, the confirm dialog (last)
    const cardDialog = await screen.findByRole('dialog')
    expect(within(cardDialog).getByText('Иван Петров')).toBeInTheDocument()

    fireEvent.click(within(cardDialog).getByRole('button', { name: 'Заблокировать' }))
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2))
    const confirmDialog = screen.getAllByRole('dialog')[1]
    const confirmBtn = within(confirmDialog).getByRole('button', { name: 'Заблокировать' })
    expect(confirmBtn).toBeDisabled()

    // short reason: stays disabled
    const reason = within(confirmDialog).getByLabelText(/Причина/)
    fireEvent.change(reason, { target: { value: 'мало' } })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(reason, { target: { value: 'Нарушение условий сервиса' } })
    expect(confirmBtn).toBeEnabled()
    fireEvent.click(confirmBtn)

    await waitFor(() =>
      expect(usersApi.blockUser).toHaveBeenCalledWith(sampleUser.id, 'Нарушение условий сервиса'),
    )
  })

  it('does not show block buttons without users:block permission', async () => {
    setup(['users:read'])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Карточка' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Карточка' }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Заблокировать' })).not.toBeInTheDocument()
    expect(usersApi.blockUser).not.toHaveBeenCalled()
  })
})
