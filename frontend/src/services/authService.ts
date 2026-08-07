import api from './api'

export const login = async (email: string, password: string) => {
  const resp = await api.post('/auth/login', { email, password })
  const { access_token } = resp.data
  if (access_token) {
    localStorage.setItem('access_token', access_token)
  }
  return resp.data
}

export const logout = () => {
  localStorage.removeItem('access_token')
}

export const register = async (payload: any) => {
  const resp = await api.post('/auth/register', payload)
  return resp.data
}
