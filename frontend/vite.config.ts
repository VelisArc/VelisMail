import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for smaller bundles
    target: 'es2020',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/mail': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/tenants': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
