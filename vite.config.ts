import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
const localHttps = process.env.FLUXDESK_PWA_HTTPS === '1'
  ? {
      key: readFileSync('.cert/fluxdesk-key.pem'),
      cert: readFileSync('.cert/fluxdesk.pem'),
    }
  : undefined;

export default defineConfig({
  plugins: [react(), VitePWA({
    strategies:'injectManifest', srcDir:'src',filename:'sw.ts',
    injectManifest:{ globPatterns:['**/*.{js,css,html,svg,png,webp,woff2}'], maximumFileSizeToCacheInBytes:3_000_000 },
    manifest:{name:'FluxDesk • Crypto Intelligence',short_name:'FluxDesk',description:'Crypto relative performance, market structure and risk alerts',start_url:'/',scope:'/',display:'standalone',background_color:'#090e19',theme_color:'#090e19',icons:[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png'},{src:'/icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]}
  })],
  server:{ port:5173,proxy:{'/api':{target:'http://127.0.0.1:8787',changeOrigin:true}}},
  // Opt-in HTTPS production preview for testing the installable PWA on a local iPhone.
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    https: localHttps,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
  build:{target:'es2022',cssCodeSplit:true,rollupOptions:{output:{manualChunks:{}}}},
  test:{environment:'node',include:['tests/**/*.test.ts']}
});
