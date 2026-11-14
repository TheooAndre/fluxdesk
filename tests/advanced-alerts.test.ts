import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Candle } from '../src/types.ts';
import { defaultTechnicalCondition } from '../src/lib/advanced-alert.ts';
const mock = vi.hoisted(() => ({
  bars: [] as Candle[],
  failed: false,
  calls: [] as string[],
  active: 0,
  maxActive: 0,
  deliver: vi.fn(),
}));
vi.mock('../server/notifications.ts', () => ({ deliver: mock.deliver, vapidKey: () => '' }));
vi.mock('../server/market.ts', async (original) => ({
  ...(await original<typeof import('../server/market.ts')>()),
  freshMarkets: async () =>
    Array.from({ length: 25 }, (_, i) => ({
      id: `binance:TEST${i}USDT`,
      symbol: `TEST${i}USDT`,
      venue: 'binance',
      base: `TEST${i}`,
      price: 100,
      asOf: Date.now(),
      volumeUsd24h: 1000000,
    })),
  candles: async (id: string, timeframe: string) => {
    mock.calls.push(`${id}:${timeframe}`);
    mock.active++;
    mock.maxActive = Math.max(mock.maxActive, mock.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (mock.failed) throw Error('Stale candle history; analytics withheld');
      return mock.bars;
    } finally {
      mock.active--;
    }
  },
}));
let server: Server, origin: string, directory: string, now: number;
let store: typeof import('../server/store.ts'), scanner: typeof import('../server/alerts.ts');
const condition = () => ({ ...defaultTechnicalCondition('ema_price'), params: { period: 3 } });
function setBars(last = 100) {
  mock.bars = Array.from({ length: 100 }, (_, i) => ({
    time: now - (100 - i) * 60_000,
    closeTime: now - (99 - i) * 60_000 - 1,
    open: 100,
    high: Math.max(101, i === 99 ? last : 100),
    low: Math.min(99, i === 99 ? last : 100),
    close: i === 99 ? last : 100,
    volumeBase: 100,
    volumeUsd: 10000,
  }));
}
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-advanced-'));
  vi.stubEnv('DATA_DIR', directory);
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mock.failed = false;
  mock.calls = [];
  mock.active = mock.maxActive = 0;
  mock.deliver.mockClear();
  setBars();
  store = await import('../server/store.ts');
  await store.load();
  scanner = await import('../server/alerts.ts');
  const { handler } = await import('../server/app.ts');
  server = createServer((req, res) => void handler(req, res));
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
      kind: 'technical',
      assetId: 'binance:TEST0USDT',
      assetIds: ['binance:TEST0USDT'],
      name: 'Test strategy',
      match: 'all',
      conditions: [condition()],
      cooldownMinutes: 5,
      repeat: true,
      ...extra,
    }),
  });
async function sample(last: number, delta = 60_000) {
  now += delta;
  setBars(last);
  await scanner.scanAlerts();
}

it('creates canonical parameters, strips client state, persists and reloads a private rule', async () => {
  const response = await create({ technicalState: { fake: { matched: true } }, ownerId: 'forged' });
  expect(response.status).toBe(201);
  const { alert } = await response.json();
  expect(alert).toMatchObject({
    kind: 'technical',
    conditions: [condition()],
    assetIds: ['binance:TEST0USDT'],
  });
  expect(alert.technicalState).toBeUndefined();
  expect(alert.ownerId).toBeUndefined();
  expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).alerts[0]).toEqual(alert);
  await store.load();
  expect(store.snapshot().alerts[0]).toEqual(alert);
});
it('rejects unsupported signals, unknown markets and out-of-budget input before writes', async () => {
  for (const invalid of [
    { assetIds: [] },
    { assetIds: ['binance:TEST0USDT', 'binance:TEST0USDT'] },
    { assetIds: Array.from({ length: 21 }, (_, i) => `binance:TEST${i}USDT`) },
    { assetIds: ['binance:UNKNOWN'] },
    { match: 'eval' },
    { cooldownMinutes: 0 },
    { cooldownMinutes: '5' },
    { name: 'a'.repeat(61) },
    { conditions: [] },
    { conditions: Array(6).fill(condition()) },
    { conditions: [{ ...condition(), signal: 'invalid' }] },
    { conditions: [{ ...condition(), timeframe: '1s' }] },
    { conditions: [{ ...condition(), params: { period: '3' } }] },
    { repeat: 'yes' },
  ])
    expect((await create(invalid)).status).toBe(400);
  expect(store.snapshot().alerts).toHaveLength(0);
});
it('seeds first observation, sends a true crossing once, and preserves dedupe across restart', async () => {
  await create();
  await sample(100);
  expect(mock.deliver).not.toHaveBeenCalled();
  await sample(110);
  expect(mock.deliver).toHaveBeenCalledTimes(1);
  expect(mock.deliver.mock.calls[0]![0]).toMatchObject({ kind: 'technical', assetId: 'binance:TEST0USDT' });
  expect(mock.deliver.mock.calls[0]![0].message).toContain('Price vs EMA');
  vi.resetModules();
  store = await import('../server/store.ts');
  await store.load();
  scanner = await import('../server/alerts.ts');
  await scanner.scanAlerts();
  expect(mock.deliver).toHaveBeenCalledTimes(1);
  await sample(100);
  await sample(110);
  expect(mock.deliver).toHaveBeenCalledTimes(1);
  await sample(100, 300000);
  await sample(110);
  expect(mock.deliver).toHaveBeenCalledTimes(2);
});
it('disables after the first trigger and allows manual reactivation without replay', async () => {
  const { alert } = await (await create({ repeat: false })).json();
  await sample(100);
  await sample(110);
  expect(store.snapshot().alerts[0]!.enabled).toBe(false);
  expect(mock.deliver).toHaveBeenCalledTimes(1);
  const response = await fetch(origin + '/api/alerts/' + alert.id, {
    method: 'PUT',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  expect(response.status).toBe(200);
  expect(store.snapshot().alerts[0]).not.toHaveProperty('technicalState');
  await sample(110);
  expect(mock.deliver).toHaveBeenCalledTimes(1);
  await sample(100);
  await sample(110);
  expect(mock.deliver).toHaveBeenCalledTimes(2);
});
it('records data failures without changing matched state or inventing a recovery signal', async () => {
  await create({
    conditions: [
      { ...defaultTechnicalCondition('rsi'), signal: 'above', params: { period: 14, threshold: 40 } },
    ],
  });
  await sample(100);
  expect(mock.deliver).not.toHaveBeenCalled(); // flat RSI=50 seeds true
  mock.failed = true;
  await sample(100);
  const rule = store.snapshot().alerts[0]!;
  expect(rule.kind === 'technical' && rule.technicalState?.['binance:TEST0USDT']).toMatchObject({
    matched: true,
    error: 'Stale candle history; analytics withheld',
  });
  mock.failed = false;
  await sample(100);
  expect(mock.deliver).not.toHaveBeenCalled();
});
it('deduplicates a slow-timeframe event even if faster filters leave and re-enter', async () => {
  const { alert } = await (await create()).json();
  const record = (key: string, matched: boolean, eventKey?: string) =>
    store.recordTechnicalEvaluations(alert.id, [
      { assetId: alert.assetId, key, matched, ...(eventKey ? { eventKey } : {}), message: 'Mixed timeframe' },
    ]);
  await record('0:0', false);
  now += 300000;
  expect(await record('1:1', true, 'slow:1')).toHaveLength(1);
  now += 300000;
  await record('1:2', false);
  expect(await record('1:3', true, 'slow:1')).toHaveLength(0);
  now += 300000;
  expect(await record('2:4', true, 'slow:2')).toHaveLength(1);
});
it('uses independent cooldowns for each market and keeps accounts isolated', async () => {
  const { alert } = await (await create({ assetIds: ['binance:TEST0USDT', 'binance:TEST1USDT'] })).json();
  const observe = (assetId: string, key: string, matched: boolean) =>
    store.recordTechnicalEvaluations(alert.id, [{ assetId, key, matched, message: assetId }]);
  for (const id of alert.assetIds) await observe(id, '0', false);
  expect(await observe(alert.assetIds[0], '1', true)).toHaveLength(1);
  expect(await observe(alert.assetIds[1], '1', true)).toHaveLength(1);
  const owned = { ...store.snapshot().alerts[0]!, id: crypto.randomUUID(), ownerId: 'alice' };
  vi.stubEnv('FLUXDESK_PUBLIC_MODE', 'true');
  await store.addAlert(owned);
  expect(store.snapshotFor('bob').alerts.some((a) => a.id === owned.id)).toBe(false);
  expect(await store.setAlertEnabled(owned.id, false, 'bob')).toBeNull();
});
it('shares histories across rules, bounds parallel requests and combines AND/OR conditions', async () => {
  const assetIds = Array.from({ length: 20 }, (_, i) => `binance:TEST${i}USDT`);
  const conditions = [
    condition(),
    {
      ...defaultTechnicalCondition('rsi'),
      timeframe: '4h',
      signal: 'above',
      params: { period: 14, threshold: 100 },
    },
  ];
  await create({ assetIds, conditions, match: 'all' });
  await create({ assetIds, conditions, match: 'any' });
  await sample(100);
  expect(mock.calls).toHaveLength(40);
  expect(mock.maxActive).toBeLessThanOrEqual(4);
  mock.calls = [];
  await sample(110);
  expect(mock.calls).toHaveLength(40);
  expect(mock.deliver).toHaveBeenCalledTimes(20);
});
it('keeps many-account baskets within request/concurrency budgets and advances unchecked jobs on the next scan', async () => {
  const template = (await (await create()).json()).alert;
  await store.deleteAlert(template.id);
  const ids = Array.from({ length: 20 }, (_, i) => `binance:TEST${i}USDT`);
  for (let owner = 0; owner < 10; owner++)
    for (let r = 0; r < 10; r++)
      await store.addAlert({
        ...template,
        id: `owner-${owner}-rule-${r}`,
        ownerId: `x:${owner + 1}`,
        assetIds: ids,
      });
  const scan = (await import('../server/technical-alerts.ts')).scanTechnicalAlerts;
  const markets = ids.map((id) => ({
    id,
    symbol: id.split(':')[1]!,
    price: 100,
    asOf: now,
  })) as import('../src/types.ts').Market[];
  await scan(
    store.snapshot().alerts as Extract<import('../src/types.ts').AlertRule, { kind: 'technical' }>[],
    markets,
  );
  const checked = () =>
    store
      .snapshot()
      .alerts.flatMap((a) =>
        a.kind === 'technical' ? Object.keys(a.technicalState ?? {}).map((id) => `${a.id}:${id}`) : [],
      );
  const first = checked();
  expect(first).toHaveLength(80);
  expect(mock.calls.length).toBeLessThanOrEqual(40);
  expect(mock.maxActive).toBeLessThanOrEqual(4);
  now += 60_000;
  mock.calls = [];
  await scan(
    store.snapshot().alerts as Extract<import('../src/types.ts').AlertRule, { kind: 'technical' }>[],
    markets.map((m) => ({ ...m, asOf: now })),
  );
  expect(checked()).toHaveLength(160);
  expect(mock.calls.length).toBeLessThanOrEqual(40);
  expect(mock.deliver).not.toHaveBeenCalled();
});
