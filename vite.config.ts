import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    strategies:'injectManifest', srcDir:'src',filename:'sw.ts',
    injectManifest:{ globPatterns:['**/*.{js,css,html,svg,png,webp,woff2}'], maximumFileSizeToCacheInBytes:3_000_000 },
    manifest:{name:'FluxDesk • Crypto Intelligence',short_name:'FluxDesk',description:'Crypto relative performance, market structure and risk alerts',start_url:'/',scope:'/',display:'standalone',background_color:'#090e19',theme_color:'#090e19',icons:[{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png'},{src:'/icons/icon-512.png',sizes:'512x512',type:'image/png'},{src:'/icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]}
  })],
  server:{ port:5173,proxy:{'/api':{target:'http://127.0.0.1:8787',changeOrigin:true}}},
  build:{target:'es2022',cssCodeSplit:true,rollupOptions:{output:{manualChunks:{}}}},
  test:{environment:'node',include:['tests/**/*.test.ts']}
});
