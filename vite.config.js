import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    },
  },
})
