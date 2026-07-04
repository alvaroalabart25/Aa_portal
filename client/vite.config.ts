import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'icons/*.png'],
      manifest: {
        name: 'Aa Portal',
        short_name: 'Aa',
        description: 'Portal personal de organización',
        lang: 'es',
        display: 'standalone',
        start_url: '/',
        background_color: '#ffffff',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // La app (estáticos) funciona offline; la API pide red (los datos viven en el servidor)
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      // En dev, el front llama a /api y Vite lo reenvía al Express local
      '/api': 'http://localhost:3001',
    },
  },
});
