import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3777',
        changeOrigin: true
      },
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'vite.svg'],
      workbox: {
        // Phase 2: Auth requests are handled in-app with offline fallback (offlineAuth.ts).
        // Phase 4: WebRTC signalling will add runtimeCaching rules here.
        runtimeCaching: []
      },
      manifest: {
        id: '/',
        name: 'LinkLocker',
        short_name: 'LinkLocker',
        description: 'Save links across devices and offline sessions',
        background_color: '#0C0B10',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#C8895A',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        share_target: {
          action: '/share',
          method: 'GET',
          params: {
            title: 'title',
            text: 'text',
            url: 'url'
          }
        }
      }
    })
  ]
})