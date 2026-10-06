import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import apiDev from './vite-plugin-api-dev.js'

const srcPath = fileURLToPath(new URL('./src', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Runs api/acs.js locally (dev + preview).
    apiDev(),
    /*
     * Service worker via Workbox. Strategy:
     *   • App shell (HTML/CSS/JS) is precached on install — full offline
     *     boot for users who've already loaded the app once.
     *   • Map tiles (OSM, Streets GL): StaleWhileRevalidate so tiles you've
     *     looked at recently come back instantly when offline.
     *   • Our /api/* serverless calls: NetworkOnly. Stale food-desert data
     *     would be misleading; we'd rather show an error than fake fresh.
     *
     * Note: the Census / CDC / USDA calls happen during page load, so the
     * tract data they returned still lives in localStorage (community
     * cache). The service worker just makes the SHELL offline so the cached
     * data has somewhere to render.
     */
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Food Desert AI',
        short_name: 'Food Desert AI',
        description: 'Tract-level food access: the USDA low-income & low-access rule on 2020 Census blocks and USDA\'s SNAP supermarket list.',
        id: '/',
        theme_color: '#050608',
        background_color: '#050608',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://tile.openstreetmap.org' ||
              url.hostname.endsWith('.tile.openstreetmap.org'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // US map mode basemap (keyed rastertiles endpoint).
            urlPattern: ({ url }) => url.hostname === 'basemaps.cartocdn.com',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'carto-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://streets-gl.pages.dev',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'streets-gl-shell',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 3 },
            },
          },
          {
            // Never cache our API surfaces — stale data is worse than none.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
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
      // /api/acs is not proxied: vite-plugin-api-dev.js
      // runs the real handlers from api/ so dev matches production.
    },
  },
})
