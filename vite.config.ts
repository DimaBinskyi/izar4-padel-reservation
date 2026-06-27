import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: { swSrc: 'src/sw.ts', swDest: 'dist/sw.js' },
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Pádel Reservas', short_name: 'Pádel', lang: 'uk',
        theme_color: '#0b0f17', background_color: '#0b0f17', display: 'standalone', start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: { proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
});
