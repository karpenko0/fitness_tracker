import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API base is relative (/api/v1) by default so the browser reaches the backend
// through this dev-server proxy — required for sandbox/preview hosts where the
// browser cannot address the sandbox's localhost:8000 directly.
// Override with VITE_REACT_APP_API_URL / VITE_API_URL for real deployments.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    // The sandbox preview proxies the app under https://<port>-<sandbox>.e2b.app —
    // allow any host so the preview works (dev-only setting).
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  define: {
    'process.env': {},
  },
})
