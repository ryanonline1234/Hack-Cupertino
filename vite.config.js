import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const srcPath = fileURLToPath(new URL('./src', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          if (id.includes('three') || id.includes('@react-three')) {
            return 'three-vendor'
          }

          if (id.includes('framer-motion') || id.includes('lucide-react')) {
            return 'landing-vendor'
          }

          if (id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'charts-vendor'
          }

          if (id.includes('leaflet')) {
            return 'map-vendor'
          }

          if (id.includes('react') || id.includes('@radix-ui') || id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge')) {
            return 'react-vendor'
          }

          return 'vendor'
        },
      },
    },
  },
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
      // Overpass needs a server-side proxy because overpass-api.de returns
      // 406 with no CORS header to browser origins (e.g. *.vercel.app).
      // Deployed to Vercel via /api/overpass.js; vite proxies in dev.
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
      },
    },
  },
})
