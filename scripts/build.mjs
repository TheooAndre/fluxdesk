// Render the real empty/loading UI before Vite writes HTML and PWA revisions.
// No market data, owner state or environment secrets enter the static shell.
process.env.NODE_ENV = 'production';
const { createServer, build } = await import('vite');
const { default: react } = await import('@vitejs/plugin-react');
const server = await createServer({
  configFile: false,
  mode: 'production',
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
  plugins: [
    react(),
    {
      name: 'shell-service-worker-stub',
      resolveId(id) {
        if (id === 'virtual:pwa-register') return '\0shell-pwa';
      },
      load(id) {
        if (id === '\0shell-pwa') return 'export const registerSW = () => async () => {};';
      },
    },
  ],
});
let markup;
const originalFetch = globalThis.fetch;
try {
  // Fail the build if a future shell change tries to fetch live/private data.
  globalThis.fetch = () => Promise.reject(new Error('Static shell must not fetch network data'));
  const entry = await server.ssrLoadModule('/src/entry-shell.tsx');
  markup = await entry.renderShell();
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
if (typeof markup !== 'string' || !markup.includes('Market overview'))
  throw Error('Static shell did not render');
await build({
  plugins: [
    {
      name: 'fluxdesk-static-shell',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const marker = /<!--app-shell-start-->[\s\S]*?<!--app-shell-end-->/;
          if (!marker.test(html)) throw Error('Missing static-shell HTML markers');
          return html.replace(marker, () => `<div id="root" data-prerendered="true">${markup}</div>`);
        },
      },
    },
  ],
});
