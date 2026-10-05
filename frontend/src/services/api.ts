import axios from 'axios'

// Relative base URL by default: the Vite dev server proxies /api to the backend
// (works in sandbox previews where the browser cannot hit sandbox localhost).
const API_URL = import.meta.env.VITE_REACT_APP_API_URL || import.meta.env.VITE_API_URL || '/api/v1'

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

export default api
