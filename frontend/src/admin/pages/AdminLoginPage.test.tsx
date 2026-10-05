import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminLoginPage from './AdminLoginPage'
import { adminLogin, adminMfaVerify } from '../auth'

vi.mock('../auth', () => ({
  adminLogin: vi.fn(),
  adminMfaVerify: vi.fn(),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  }
})

const mockedLogin = vi.mocked(adminLogin)
const mockedMfa = vi.mocked(adminMfaVerify)

describe('AdminLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the admin login form in Russian', () => {
    render(<AdminLoginPage />)
    expect(screen.getByRole('heading', { name: /Панель администратора/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Пароль/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument()
  })

  it('submits credentials and navigates on success', async () => {
    mockedLogin.mockResolvedValue({ role: 'admin', user_id: 'u1', access_token: 'tok' })
    const { container } = render(<AdminLoginPage />)

    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'admin@example.com' } })
    fireEvent.input(screen.getByLabelText(/Пароль/), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledWith('admin@example.com', 'secret'))
    expect(container).toBeInTheDocument()
  })

  it('shows a friendly error on invalid credentials', async () => {
    mockedLogin.mockRejectedValue({ response: { status: 401, data: { detail: { code: 'INVALID_CREDENTIALS' } } } })
    render(<AdminLoginPage />)

    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'a@b.com' } })
    fireEvent.input(screen.getByLabelText(/Пароль/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(screen.getByText(/Неверный email или пароль/)).toBeInTheDocument())
  })

  it('switches to the MFA step when the server requires it', async () => {
    mockedLogin.mockResolvedValue({ role: 'admin', user_id: 'u1', mfa_required: true, challenge_id: 'ch-1' })
    mockedMfa.mockResolvedValue({ role: 'admin', user_id: 'u1', access_token: 'tok' })
    render(<AdminLoginPage />)

    fireEvent.input(screen.getByLabelText(/Email/), { target: { value: 'a@b.com' } })
    fireEvent.input(screen.getByLabelText(/Пароль/), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }))

    await waitFor(() => expect(screen.getByLabelText(/Код двухфакторной аутентификации/)).toBeInTheDocument())

    fireEvent.input(screen.getByLabelText(/Код двухфакторной аутентификации/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить код' }))

    await waitFor(() =>
      expect(mockedMfa).toHaveBeenCalledWith({
        email: 'a@b.com',
        password: 'secret',
        challenge_id: 'ch-1',
        code: '123456',
      }),
    )
  })
})
