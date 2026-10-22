import { describe, expect, it } from 'vitest';
import config from '../vite.config.ts';

// Regression for iPhone HTTPS previews: Vite proxies /api to a local HTTP
// backend, but the browser's Origin remains https://<mac-ip>:<preview-port>.
// The API intentionally compares Origin's host to the received Host header.
// With changeOrigin:true, proxying rewrites Host to 127.0.0.1:8787 and blocks
// legitimate Strategy Lab POSTs. Both preview and dev must preserve Host.
describe('local API proxy same-origin security', () => {
  it('preserves the browser-facing Host in both dev and HTTPS preview', () => {
    expect(config.server?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:8787',
      changeOrigin: false,
    });
    expect(config.preview?.proxy?.['/api']).toMatchObject({
      target: 'http://127.0.0.1:8787',
      changeOrigin: false,
    });
  });
});
