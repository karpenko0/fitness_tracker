import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import api from './api'
import * as authService from './authService'
import * as productService from './productService'

vi.mock('./api')

const mockedApi = api as unknown as {
  post: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

describe('authService', () => {
  beforeEach(() => {
    mockedApi.post.mockReset()
    localStorage.clear()
  })

  it('login stores access_token in localStorage', async () => {
    mockedApi.post.mockResolvedValue({ data: { access_token: 'abc123' } })

    const result = await authService.login('a@b.com', 'secret')

    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', { email: 'a@b.com', password: 'secret' })
    expect(localStorage.getItem('access_token')).toBe('abc123')
    expect(result).toEqual({ access_token: 'abc123' })
  })

  it('login returns data without token when no access_token present', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 1 } })

    const result = await authService.login('a@b.com', 'secret')

    expect(result).toEqual({ id: 1 })
    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('logout removes access_token', () => {
    localStorage.setItem('access_token', 'abc123')

    authService.logout()

    expect(localStorage.getItem('access_token')).toBeNull()
  })

  it('register posts payload to /auth/register', async () => {
    const payload = { email: 'a@b.com', password: 'secret' }
    mockedApi.post.mockResolvedValue({ data: { id: 7 } })

    const result = await authService.register(payload)

    expect(mockedApi.post).toHaveBeenCalledWith('/auth/register', payload)
    expect(result).toEqual({ id: 7 })
  })
})

describe('productService', () => {
  beforeEach(() => {
    mockedApi.get.mockReset()
    mockedApi.post.mockReset()
  })

  it('getConfig fetches /product/config', async () => {
    mockedApi.get.mockResolvedValue({ data: { config: true } })

    const result = await productService.getConfig()

    expect(mockedApi.get).toHaveBeenCalledWith('/product/config')
    expect(result).toEqual({ config: true })
  })

  it('createFeature posts payload to /product/feature', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 1 } })

    const result = await productService.createFeature({ name: 'x' })

    expect(mockedApi.post).toHaveBeenCalledWith('/product/feature', { name: 'x' })
    expect(result).toEqual({ id: 1 })
  })

  it('createPlan posts payload to /product/plan', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 2 } })

    const result = await productService.createPlan({ code: 'p1', price: 10 })

    expect(mockedApi.post).toHaveBeenCalledWith('/product/plan', { code: 'p1', price: 10 })
    expect(result).toEqual({ id: 2 })
  })
})