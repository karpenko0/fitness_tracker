import api from './api'

export const getConfig = async () => {
  const resp = await api.get('/product/config')
  return resp.data
}

export const createFeature = async (payload: any) => {
  const resp = await api.post('/product/feature', payload)
  return resp.data
}

export const createPlan = async (payload: any) => {
  const resp = await api.post('/product/plan', payload)
  return resp.data
}
