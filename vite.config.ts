import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        runtimeCaching: [
          {
            urlPattern: ({ url, request }) =>
              url.pathname === '/api/links' && request.method === 'POST',
            method: 'POST',
            handler: 'NetworkOnly',
            options: {
              backgroundSync: {
                name: 'link-save-queue',
                options: {
                  maxRetentionTime: 24 * 60
                }
              }
            }
          }
        ]
      },
      manifest: {
        name: 'LinkKeeper',
        short_name: 'Links',
        description: 'Save links across devices and offline sessions',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})