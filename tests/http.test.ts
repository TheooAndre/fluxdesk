import { createServer, request, type Server } from 'node:http';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
vi.mock('../server/market.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../server/market.ts')>();
  return {
    ...original,
    marketSnapshot: async () => ({
      assets: [],
      asOf: null,
      checkedAt: 100,
      feeds: [
        {
          venue: 'binance',
          status: 'unavailable',
          lastSuccessAt: null,
          lastAttemptAt: 100,
          ageMs: null,
          markets: 0,
          message: 'HTTP 451',
        },
        {
          venue: 'hyperliquid',
          status: 'unavailable',
          lastSuccessAt: null,
          lastAttemptAt: 100,
          ageMs: null,
          markets: 0,
          message: 'timed out',
        },
      ],
    }),
  };
});
import { handler } from '../server/app.ts';
let server: Server, origin: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});
it('serves a complete unavailable-feed response instead of a misleading healthy empty market table', async () => {
  const response = await fetch(`${origin}/api/markets`);
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.feeds.map((f: { status: string }) => f.status)).toEqual(['unavailable', 'unavailable']);
  expect(body.benchmarks).toEqual({});
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it.each([
  '/api/candles?asset=binance:BTCUSDT&limit=NaN',
  '/api/correlations?asset=binance:BTCUSDT&minimum=NaN',
  '/api/pair?a=binance:BTCUSDT&b=hyperliquid:BTC',
  '/api/asset?asset=binance:BTCUSDT:ignored',
  '/api/asset?asset=binance:BTCUSDT&major=binance:BTCUSDT:ignored',
])('rejects invalid research request %s', async (path) => {
  const response = await fetch(origin + path);
  expect(response.status).toBe(400);
});
it('rejects wrong methods and cross-origin alert creation before any writes', async () => {
  const wrong = await fetch(`${origin}/api/markets`, { method: 'POST' });
  expect(wrong.status).toBe(405);
  expect(wrong.headers.get('allow')).toBe('GET');
  const cross = await fetch(`${origin}/api/alerts`, {
    method: 'POST',
    headers: { origin: 'https://other.example', 'content-type': 'application/json' },
    body: '{}',
  });
  expect(cross.status).toBe(400);
});
it('returns 400 for malformed JSON and malformed liquidation windows', async () => {
  expect((await fetch(`${origin}/api/alerts`, { method: 'POST', body: '{' })).status).toBe(400);
  expect((await fetch(`${origin}/api/liquidations?minutes=NaN`)).status).toBe(400);
});

it('offers a read-only research archive catalog with no synthetic datasets', async () => {
  const response = await fetch(origin + '/api/research/datasets');
  expect(response.status).toBe(200);
  const data = (await response.json()) as { datasets: unknown[]; rejected: number };
  expect(Array.isArray(data.datasets)).toBe(true);
  expect(typeof data.rejected).toBe('number');
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('rejects invalid or unsafe research requests before accessing exchange APIs', async () => {
  for (const [path, body] of [
    ['/api/research/datasets', { assetId: 'binance:BTCUSDT', interval: '1h', count: 9999 }],
    ['/api/research/datasets', { assetId: 'binance:BTCUSDT:extra', interval: '1h', count: 500 }],
    ['/api/research/backtests', { datasetId: '../private', config: {} }],
  ] as const) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  }
  const wrongMethod = await fetch(origin + '/api/research/backtests');
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('POST');
});
it('rejects research mutations from a different origin', async () => {
  const response = await fetch(origin + '/api/research/datasets', {
    method: 'POST',
    headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(400);
});


it('accepts same-origin HTTPS browser mutations through a Host-preserving proxy', async () => {
  const requestWithOrigin = (browserOrigin: string) => new Promise<{ status: number; error: string }>((resolve, reject) => {
    // Vite terminates HTTPS and forwards to localhost:8787 over HTTP.
    // Host MUST remain the browser-facing Mac address and preview port.
    const req = request(origin + '/api/research/datasets', {
      method: 'POST',
      headers: {
        host: '192.0.2.10:4183',
        origin: browserOrigin,
        'content-type': 'application/json',
      },
    }, (res) => {
      let payload = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { payload += chunk; });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode ?? 0,
            error: (JSON.parse(payload) as { error: string }).error,
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    // Deliberately out of range. If origin validation succeeds, the API should
    // reject the count; it must not reject the request as cross-origin.
    req.end(JSON.stringify({ assetId: 'binance:BTCUSDT', interval: '1h', count: 20 }));
  });
  const allowed = await requestWithOrigin('https://192.0.2.10:4183');
  expect(allowed).toEqual({ status: 400, error: 'Invalid candle count' });
  const rejected = await requestWithOrigin('https://attacker.example');
  expect(rejected).toEqual({ status: 400, error: 'Cross-origin mutation blocked' });
});
