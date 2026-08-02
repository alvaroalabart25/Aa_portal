import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Política de contenido: se inyecta SOLO al construir. En desarrollo el HMR
// necesita scripts en línea, así que ahí no se aplica.
function cspFor(api: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React usa atributos style en línea
    // blob: son las vistas previas al subir una imagen; la API sirve las de Sueños
    `img-src 'self' data: blob:${api ? ` ${api}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${api ? ` ${api}` : ''}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

export default defineConfig(({ mode }) => {
  // loadEnv recoge tanto los .env como las variables del entorno (CI)
  const CSP = cspFor(loadEnv(mode, '.', 'VITE_').VITE_API_URL ?? '');
  return {
    plugins: [
      react(),
      {
        name: 'csp-en-produccion',
        apply: 'build',
        transformIndexHtml(html) {
          return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
        },
      },
      VitePWA({
        // SW propio (src/sw.ts): precaché + manejadores de notificaciones push
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        },
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
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        // En dev, el front llama a /api y Vite lo reenvía al Express local
        '/api': 'http://localhost:3001',
      },
    },
    // `vite preview` sirve la build real (con su CSP) para poder comprobarla
    preview: {
      port: 4173,
      proxy: { '/api': 'http://localhost:3001' },
    },
  };
});
