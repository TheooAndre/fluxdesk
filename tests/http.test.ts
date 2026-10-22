import { createServer, type Server } from 'node:http';
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
