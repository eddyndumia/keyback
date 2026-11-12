import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API runs on :8787 (npm run api in ../app). The dev server proxies to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': process.env.API_URL ?? 'http://127.0.0.1:8787',
      '/readyz': process.env.API_URL ?? 'http://127.0.0.1:8787',
    },
  },
})
