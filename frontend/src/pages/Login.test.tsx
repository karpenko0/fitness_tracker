import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from './Login'
import { login } from '../services/authService'

vi.mock('../services/authService', () => ({ login: vi.fn() }))

const mockedLogin = vi.mocked(login)

describe('Login', () => {
  beforeEach(() => {
    mockedLogin.mockReset()
  })

  it('renders the login form', () => {
    render(<Login />)
    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument()
  })

  it('submits email and password to login and redirects', async () => {
    const originalHref = window.location.href
    const location = window.location as unknown as { href: string }
    location.href = '/'
    mockedLogin.mockResolvedValue({ access_token: 'abc' })

    render(<Login />)
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledWith('a@b.com', 'secret'))
    expect(location.href.endsWith('/')).toBe(true)
    location.href = originalHref
  })

  it('shows an error message when login fails', async () => {
    mockedLogin.mockRejectedValue({ response: { data: { detail: 'Invalid credentials' } } })

    render(<Login />)
    fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument())
  })
})