import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import gateway from '../api/gateway.ts';
import { readFile } from 'node:fs/promises';

const SECRET = 'backend-secret-for-tests-only-1234567890';
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((done, fail) => server.close((e) => e ? fail(e) : done()))));
});

async function start() {
  const server = createServer((req, res) => { void gateway(req, res); });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}
function call(port: number, path: string, method = 'GET', origin?: string, body = '') {
  return new Promise<{ status: number; body: string }>((done, fail) => {
    const req = request({
      host: '127.0.0.1', port, path, method,
      headers: {
        ...(origin ? { origin } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done({
        status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

describe('private Vercel API gateway', () => {
  it('routes all browser API paths before the SPA fallback using Vite-supported functions', async () => {
    const settings = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(settings.rewrites[0]).toEqual({
      source: '/api/:path*', destination: '/api/gateway?__fd_route=:path*',
    });
    expect(settings.rewrites.at(-1)).toEqual({
      source: '/(.*)', destination: '/index.html',
    });
  });

  it('rejects missing or malicious route metadata before contacting backend', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    const mock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', mock);
    const port = await start();
    expect((await call(port, '/api/gateway')).status).toBe(404);
    expect((await call(port, '/api/gateway?__fd_route=../secrets')).status).toBe(404);
    expect((await call(port, '/api/gateway?__fd_route=health&__fd_route=markets')).status).toBe(404);
    expect(mock).not.toHaveBeenCalled();
  });

  it('fails closed without HTTPS backend and strong server-held token', async () => {
    const port = await start();
    const missing = await call(port, '/api/gateway?__fd_route=health');
    expect(missing.status).toBe(503);
    expect(JSON.parse(missing.body)).toEqual({ error: 'Private API backend is not configured' });
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'http://api.example.com');
    expect((await call(port, '/api/gateway?__fd_route=health')).status).toBe(503);
  });

  it('sends only a fixed HTTPS backend request with secret and browser host', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    const mock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', mock);
    const port = await start();
    const result = await call(port, '/api/gateway?__fd_route=health&check=1');
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
    expect(result.body).not.toContain(SECRET);
    expect(mock).toHaveBeenCalledTimes(1);
    const [destination, options] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(destination.toString()).toBe('https://private-api.example.com/api/health?check=1');
    expect(options.redirect).toBe('manual');
    expect(options.headers).toMatchObject({
      'x-fluxdesk-gateway-token': SECRET,
      'x-fluxdesk-public-host': '127.0.0.1:' + port,
    });
  });

  it('rejects cross-origin mutations and forwards valid JSON without browser secrets', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com/');
    const mock = vi.fn(async () => Response.json({ dataset: { bars: 80 } }, { status: 201 }));
    vi.stubGlobal('fetch', mock);
    const port = await start();
    const payload = JSON.stringify({ assetId: 'binance:BTCUSDT', interval: '1h', count: 80 });
    expect((await call(port, '/api/gateway?__fd_route=research/datasets', 'POST', 'https://attacker.example', payload)).status).toBe(403);
    expect((await call(port, '/api/gateway?__fd_route=research/datasets', 'POST', undefined, payload)).status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
    const origin = 'https://127.0.0.1:' + port;
    const result = await call(port, '/api/gateway?__fd_route=research/datasets', 'POST', origin, payload);
    expect(result.status).toBe(201);
    expect(mock).toHaveBeenCalledTimes(1);
    const [, options] = mock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(options.body).toBe(payload);
    expect(options.headers).toMatchObject({ origin });
  });

  it('never follows a backend redirect or reveals upstream errors', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      status: 302, headers: { location: 'https://attacker.example' },
    })));
    const port = await start();
    const result = await call(port, '/api/gateway?__fd_route=health');
    expect(result.status).toBe(502);
    expect(result.body).not.toContain('attacker.example');
    expect(result.body).not.toContain(SECRET);
  });
});
