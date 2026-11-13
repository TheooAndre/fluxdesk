import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EconomicEvent } from '../src/types.ts';
const feed = vi.hoisted(() => ({ events: [] as EconomicEvent[], deliver: vi.fn(), freshMarkets: vi.fn() }));
vi.mock('../server/notifications.ts', () => ({ deliver: feed.deliver, vapidKey: () => '' }));
vi.mock('../server/calendar.ts', () => ({
  calendar: async () => ({
    configured: true,
    source: 'xoomar',
    staleSources: [],
    sources: [],
    events: feed.events,
  }),
}));
vi.mock('../server/market.ts', async (original) => ({
  ...(await original<typeof import('../server/market.ts')>()),
  freshMarkets: feed.freshMarkets,
}));
let server: Server,
  origin = '',
  directory = '',
  now = 0;
let scanner: typeof import('../server/alerts.ts'), store: typeof import('../server/store.ts');
function release(id: string, forecast = '3.1%', previous = '3.0%', providerForecast = '3.2%'): EconomicEvent {
  return {
    id,
    time: new Date(now + 10 * 60_000).toISOString(),
    country: 'US',
    title: 'Consumer Price Index',
    importance: 3,
    forecast,
    providerForecast,
    previous,
    actual: '',
  };
}
beforeEach(async () => {
  vi.resetModules();
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-macro-'));
  vi.stubEnv('DATA_DIR', directory);
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  feed.events = [release('cpi')];
  feed.deliver.mockClear();
  feed.freshMarkets.mockReset();
  store = await import('../server/store.ts');
  await store.load();
  scanner = await import('../server/alerts.ts');
  const { handler } = await import('../server/app.ts');
  server = createServer((request, response) => void handler(request, response));
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
    body: JSON.stringify({ kind: 'macro', leadMinutes: 15, ...extra }),
  });
it('creates a recurring high-impact macro rule without requiring a market asset', async () => {
  const response = await create();
  expect(response.status).toBe(201);
  expect((await response.json()).alert).toMatchObject({
    assetId: 'macro:US',
    kind: 'macro',
    leadMinutes: 15,
    enabled: true,
    repeat: true,
  });
  expect(feed.freshMarkets).not.toHaveBeenCalled();
  expect((await create({ leadMinutes: 7 })).status).toBe(400);
});
it('delivers consensus, previous and actual state once per release, including simultaneous releases', async () => {
  await create();
  await scanner.scanAlerts();
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  expect(feed.deliver.mock.calls[0]![0].message).toBe(
    'US macro in 10m — Consumer Price Index. Analyst consensus: 3.1%. Previous: 3.0%. Actual: pending until release. Provider forecast: 3.2%.',
  );
  feed.events = [
    release('cpi'),
    { ...release('employment', '180K', '175K', '182K'), title: 'Employment Situation' },
  ];
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(2);
  expect(feed.deliver.mock.calls[1]![0].message).toContain(
    'Analyst consensus: 180K. Previous: 175K. Actual: pending until release. Provider forecast: 182K.',
  );
  expect(store.snapshot().alerts[0]).toMatchObject({ lastTriggeredEventId: 'employment', enabled: true });
});
it('marks unavailable provider values explicitly instead of guessing them', async () => {
  feed.events = [release('cpi', '', '', '')];
  await create({ repeat: false, leadMinutes: 5 });
  feed.events[0]!.time = new Date(now + 4 * 60_000).toISOString();
  await scanner.scanAlerts();
  expect(feed.deliver.mock.calls[0]![0].message).toContain(
    'Analyst consensus: not supplied by source. Previous: not supplied by source. Actual: pending until release.',
  );
  expect(store.snapshot().alerts[0]).toMatchObject({ enabled: false, repeat: false });
});

it('waits for published actual data, then sends actual, consensus and previous without a countdown', async () => {
  await create({ timing: 'release', leadMinutes: 0 });
  await scanner.scanAlerts();
  expect(feed.deliver).not.toHaveBeenCalled();
  now += 10 * 60_000;
  await scanner.scanAlerts();
  expect(feed.deliver).not.toHaveBeenCalled();
  for (const actual of ['', '—', 'N/A', 'pending', 'pending 1m']) {
    feed.events[0]!.actual = actual;
    await scanner.scanAlerts();
  }
  expect(feed.deliver).not.toHaveBeenCalled();
  feed.events[0]!.actual = '0.0%';
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(1);
  expect(feed.deliver.mock.calls[0]![0].message).toBe(
    'US macro released — Consumer Price Index. Actual: 0.0%. Analyst consensus: 3.1%. Previous: 3.0%. Provider forecast: 3.2%.',
  );
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(1);
});

it('persists deduplication across simultaneous releases, reordered feeds and scanner reloads', async () => {
  await create({ timing: 'release' });
  feed.events.push({ ...release('core-cpi'), title: 'Core CPI' });
  now += 11 * 60_000;
  for (const event of feed.events) event.actual = '3.0%';
  await scanner.scanAlerts();
  feed.events.reverse();
  await scanner.scanAlerts();
  await store.load();
  scanner = await import('../server/alerts.ts');
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(2);
  const alert = store.snapshot().alerts[0]!;
  expect(alert.kind === 'macro' && alert.triggeredEvents).toHaveLength(2);
});

it('does not send stale, future, expired or pre-activation actuals', async () => {
  await create({ timing: 'release' });
  const event = feed.events[0]!;
  event.actual = '3.2%';
  await scanner.scanAlerts();
  now += 11 * 60_000;
  event.stale = true;
  await scanner.scanAlerts();
  event.stale = false;
  event.time = new Date(now - 12 * 60_000).toISOString();
  await scanner.scanAlerts();
  event.time = new Date(now - 7 * 3600_000).toISOString();
  await scanner.scanAlerts();
  expect(feed.deliver).not.toHaveBeenCalled();
});

it('supports hour/day reminders, rejects unsupported timing, and keeps release and reminder rules independent', async () => {
  for (const leadMinutes of [120, 240, 720, 1440])
    expect((await create({ timing: 'before', leadMinutes })).status).toBe(201);
  expect((await create({ timing: 'bad' })).status).toBe(400);
  expect((await create({ timing: 'before', leadMinutes: 0 })).status).toBe(400);
  await create({ timing: 'release', repeat: false });
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(4);
  now += 10 * 60_000;
  feed.events[0]!.actual = '3.2%';
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(5);
  expect(store.snapshot().alerts.at(-1)).toMatchObject({ enabled: false, repeat: false });
});

it('preserves legacy reminder timing and deduplicates multiple recurring reminders', async () => {
  await store.addAlert({
    id: 'legacy',
    assetId: 'macro:US',
    kind: 'macro',
    leadMinutes: 15,
    enabled: true,
    repeat: true,
    createdAt: now,
  });
  feed.events.push(release('other'));
  await scanner.scanAlerts();
  await scanner.scanAlerts();
  expect(feed.deliver).toHaveBeenCalledTimes(2);
  expect(feed.deliver.mock.calls[0]![0].message).toContain('in 10m');
});
