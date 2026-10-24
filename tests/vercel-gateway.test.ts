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

async function start(query?: Record<string, string | string[]>) {
  const server = createServer((req, res) => { void gateway(Object.assign(req, { query }), res); });
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

  it.each([
    ['/api/health?check=1', undefined, '/api/health?check=1'],
    ['/api/health?__fd_route=health&check=1', undefined, '/api/health?check=1'],
    ['/api/health?check=1', { __fd_route: 'health' }, '/api/health?check=1'],
    ['/api/gateway?check=1', { __fd_route: 'health' }, '/api/health?check=1'],
    ['/api/research/datasets?limit=2', undefined, '/api/research/datasets?limit=2'],
  ])('forwards preserved public URL %s and Vercel query helpers', async (path, query, expected) => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    const mock = vi.fn(async () => Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', mock);
    const port = await start(query);
    const result = await call(port, path);
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ status: 'ok' });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(String((mock.mock.calls[0] as unknown as [URL])[0])).toBe('https://private-api.example.com' + expected);
  });

  it.each([
    ['/api/health?__fd_route=markets', undefined],
    ['/api/health?__fd_route=health&__fd_route=health', undefined],
    ['/api/gateway?__fd_route=health', { __fd_route: 'markets' }],
    ['/api/health', { __fd_route: ['health', 'markets'] }],
    ['/api/../health', undefined],
    ['/api/research/../health', undefined],
    ['/api/research/%2e%2e/health', undefined],
    ['/api/research%2fdatasets', undefined],
    ['/api//health', undefined],
    ['/api/', undefined],
    ['/markets', undefined],
  ])('rejects ambiguous or malformed public route %s', async (path, query) => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    const mock = vi.fn(async () => Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', mock);
    expect((await call(await start(query), path)).status).toBe(404);
    expect(mock).not.toHaveBeenCalled();
  });

  it('keeps origin checks on preserved public mutation URLs', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com');
    const mock = vi.fn(async () => Response.json({ created: true }, { status: 201 }));
    vi.stubGlobal('fetch', mock);
    const port = await start();
    const path = '/api/research/datasets';
    expect((await call(port, path, 'POST', 'https://attacker.example', '{}')).status).toBe(403);
    expect((await call(port, path, 'POST', undefined, '{}')).status).toBe(403);
    expect(mock).not.toHaveBeenCalled();
    expect((await call(port, path, 'POST', 'https://127.0.0.1:' + port, '{}')).status).toBe(201);
    expect(mock).toHaveBeenCalledTimes(1);
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

it('allows bounded journal payloads without widening other API request limits',async()=>{vi.stubEnv('FLUXDESK_GATEWAY_TOKEN',SECRET);vi.stubEnv('FLUXDESK_BACKEND_URL','https://private-api.example.com/');const mock=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',mock);const port=await start(),origin='https://127.0.0.1:'+port;const medium=JSON.stringify({notes:'x'.repeat(20000)});expect((await call(port,'/api/gateway?__fd_route=journal/trades','POST',origin,medium)).status).toBe(200);expect((await call(port,'/api/gateway?__fd_route=alerts','POST',origin,medium)).status).toBe(413);const importBody=JSON.stringify({notes:'x'.repeat(150000)});expect((await call(port,'/api/gateway?__fd_route=journal/import','POST',origin,importBody)).status).toBe(200);expect((await call(port,'/api/gateway?__fd_route=journal/trades','POST',origin,importBody)).status).toBe(413);expect(mock).toHaveBeenCalledTimes(2);});

it('keeps previews read-only on the shared backend while production can save', async () => {
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
  vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com/');
  vi.stubEnv('VERCEL_ENV', 'preview');
  const mock = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', mock);
  const port = await start(), origin = 'https://127.0.0.1:' + port;
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = await call(port, '/api/journal/trades', method, origin, '{}');
    expect(result.status).toBe(403);
    expect(result.body).toContain('read-only');
  }
  expect(mock).not.toHaveBeenCalled();
  expect((await call(port, '/api/journal')).status).toBe(200);
  vi.stubEnv('VERCEL_ENV', 'production');
  expect((await call(port, '/api/journal/trades', 'POST', origin, '{}')).status).toBe(200);
  expect(mock).toHaveBeenCalledTimes(2);
});
