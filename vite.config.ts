import fs from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite dotenv-EXPANDS .env values, so a `$…` inside VITE_DEVICE_SECRET is read as a variable
// reference and silently dropped → the bundle bakes a truncated secret and every /api call 401s
// (My bookings fails to load, push registration never reaches the Worker). Read it LITERALLY from
// .env instead; an inline process-env value (which Vite doesn't expand) still wins.
function literalEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0 || line.trim().startsWith('#') || line.slice(0, i).trim() !== key) continue;
      const v = line.slice(i + 1).trim();
      return /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
    }
  } catch { /* no .env */ }
  return undefined;
}
const deviceSecret = literalEnv('VITE_DEVICE_SECRET');

export default defineConfig({
  define: deviceSecret ? { 'import.meta.env.VITE_DEVICE_SECRET': JSON.stringify(deviceSecret) } : {},
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
