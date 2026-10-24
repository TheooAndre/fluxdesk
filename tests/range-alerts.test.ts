import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { priceRangeCrossing } from '../src/engine/stats.ts';
const feed = vi.hoisted(() => ({ price: 100, live: true, deliver: vi.fn() }));
vi.mock('../server/notifications.ts', () => ({ deliver: feed.deliver, vapidKey: () => '' }));
vi.mock('../server/market.ts', async (original) => ({
  ...(await original<typeof import('../server/market.ts')>()),
  freshMarkets: async () =>
    feed.live ? [{ id: 'binance:BTCUSDT', symbol: 'BTCUSDT', price: feed.price }] : [],
}));
let server: Server, origin: string, directory: string;
let store: typeof import('../server/store.ts'), scanner: typeof import('../server/alerts.ts');
let now: number;
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-range-'));
  vi.stubEnv('DATA_DIR', directory);
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  feed.price = 100;
  feed.live = true;
  feed.deliver.mockClear();
  store = await import('../server/store.ts');
  await store.load();
  scanner = await import('../server/alerts.ts');
  const { handler } = await import('../server/app.ts');
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const create = (extra: Record<string, unknown> = {}) =>
  fetch(origin + '/api/alerts', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      assetId: 'binance:BTCUSDT',
      kind: 'price_range',
      lowerPrice: 90,
      upperPrice: 110,
      ...extra,
    }),
  });
async function sample(price: number) {
  feed.price = price;
  now += 60_000;
  await scanner.scanAlerts();
}

it('persists both bounds, reloads them and supports deleting the rule', async () => {
  const response = await create();
  expect(response.status).toBe(201);
  const { alert } = await response.json();
  expect(alert).toMatchObject({ kind: 'price_range', lowerPrice: 90, upperPrice: 110 });
  expect(alert.threshold).toBeUndefined();
  expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).alerts[0]).toEqual(alert);
  await store.load();
  expect(store.snapshot().alerts[0]).toEqual(alert);
  expect(
    (await fetch(origin + '/api/alerts/' + alert.id, { method: 'DELETE', headers: { origin } })).status,
  ).toBe(200);
  await sample(100);
  await sample(120);
  expect(feed.deliver).not.toHaveBeenCalled();
});
it('rejects missing, equal, reversed, nonnumeric and out-of-budget bounds before saving', async () => {
  for (const extra of [
    { lowerPrice: null },
    { upperPrice: null },
    { lowerPrice: 110 },
    { lowerPrice: 120 },
    { lowerPrice: 0 },
    { lowerPrice: -1 },
    { lowerPrice: '90' },
    { upperPrice: true },
    { upperPrice: 1e16 },
  ]) {
    expect((await create(extra)).status).toBe(400);
  }
  expect(store.snapshot().alerts).toHaveLength(0);
});
it('arms on first observation and delivers each outward boundary without outside repeats', async () => {
  await create();
  await sample(100);
  expect(feed.deliver).not.toHaveBeenCalled();
  await sample(110);
  await sample(120);
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  expect(feed.deliver.mock.calls[0]![0].message).toContain('price crossed above 110');
  await sample(100);
  await sample(90);
  await sample(80);
  expect(feed.deliver).toHaveBeenCalledTimes(2);
  expect(feed.deliver.mock.calls[1]![0].message).toContain('price crossed below 90');
});
it('persists independent boundary cooldowns and rearms same-side crossings after five minutes', async () => {
  await create();
  await sample(100);
  await sample(120);
  await store.load();
  await sample(100);
  await sample(120); // same side still cooling down
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  await sample(80); // opposite side must still deliver
  expect(feed.deliver).toHaveBeenCalledTimes(2);
  const saved = store.snapshot().alerts[0]!;
  expect(saved.kind).toBe('price_range');
  if (saved.kind !== 'price_range') throw Error('Wrong rule');
  expect(saved.lastTriggeredAboveAt).toBeDefined();
  expect(saved.lastTriggeredBelowAt).toBeDefined();
  now += 300_000;
  await sample(100);
  await sample(120);
  expect(feed.deliver).toHaveBeenCalledTimes(3);
});
it('does not fire on initial outside values or missing feeds; observes a full gap across the range', async () => {
  await create();
  await sample(120);
  await sample(130);
  expect(feed.deliver).not.toHaveBeenCalled();
  feed.live = false;
  await sample(80);
  expect(feed.deliver).not.toHaveBeenCalled();
  feed.live = true;
  await sample(80);
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  expect(feed.deliver.mock.calls[0]![0].message).toContain('price crossed below 90');
});
it('preserves legacy single-level alerts and their direction', async () => {
  expect((await create({ kind: 'price', threshold: 105, direction: 'above' })).status).toBe(201);
  await sample(100);
  await sample(110);
  await sample(120);
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  expect(store.snapshot().events[0]).toMatchObject({ kind: 'price' });
});
it('requires valid positive prices and only triggers outward crossings, including equality', () => {
  expect(priceRangeCrossing(100, 110, 90, 110)).toBe('above');
  expect(priceRangeCrossing(100, 90, 90, 110)).toBe('below');
  expect(priceRangeCrossing(120, 100, 90, 110)).toBeNull();
  expect(priceRangeCrossing(80, 100, 90, 110)).toBeNull();
  expect(priceRangeCrossing(110, 120, 90, 110)).toBeNull();
  expect(priceRangeCrossing(NaN, 120, 90, 110)).toBeNull();
  expect(priceRangeCrossing(100, 120, 110, 90)).toBeNull();
});

it('infers both single-level directions from the server quote, ignoring client direction', async () => {
  const below = await (
    await create({ kind: 'price', threshold: 90, direction: 'above', referencePrice: 80 })
  ).json();
  expect(below.alert).toMatchObject({ direction: 'below', referencePrice: 100 });
  await sample(90); // already armed at creation: first scheduled sample can trigger
  expect(feed.deliver.mock.calls[0]![0].message).toContain('price below 90');
  const above = await (await create({ kind: 'price', threshold: 110, direction: 'below' })).json();
  expect(above.alert).toMatchObject({ direction: 'above', referencePrice: 90 });
  await sample(110);
  expect(feed.deliver.mock.calls[1]![0].message).toContain('price above 110');
  await store.load();
  expect(store.snapshot().alerts.map((a) => (a.kind === 'price' ? a.direction : ''))).toEqual([
    'below',
    'above',
  ]);
});
it('refuses ambiguous equal levels and unavailable live quotes without creating rules', async () => {
  expect((await create({ kind: 'price', threshold: 100 })).status).toBe(400);
  feed.live = false;
  expect((await create({ kind: 'price', threshold: 90 })).status).toBe(503);
  feed.live = true;
  feed.price = NaN;
  expect((await create({ kind: 'price', threshold: 90 })).status).toBe(503);
  expect(store.snapshot().alerts).toHaveLength(0);
});
it('preserves a saved legacy below rule and does not rearm from an old creation quote on restart', async () => {
  await create({ kind: 'price', threshold: 90 });
  vi.resetModules();
  store = await import('../server/store.ts');
  await store.load();
  scanner = await import('../server/alerts.ts');
  await sample(80); // restart seeds current price, no invented crossing
  expect(feed.deliver).not.toHaveBeenCalled();
  await sample(100);
  await sample(90);
  expect(feed.deliver.mock.calls[0]![0].message).toContain('price below 90');
});
