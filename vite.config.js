import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const srcPath = fileURLToPath(new URL('./src', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcPath,
    },
  },
  server: {
    proxy: {
      '/api/census-geocoder': {
        target: 'https://geocoding.geo.census.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/census-geocoder/, ''),
      },
      '/api/nominatim': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nominatim/, ''),
      },
      '/api/cdc': {
        target: 'https://data.cdc.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cdc/, ''),
      },
      '/api/census': {
        target: 'https://api.census.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/census/, ''),
      },
      '/api/llmapi': {
        target: 'https://api.llmapi.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llmapi/, ''),
      },
    },
  },
})
