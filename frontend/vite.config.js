import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Needed for Docker
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  }
})
