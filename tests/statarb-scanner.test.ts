import { it, expect, vi } from 'vitest';
import reference from './fixtures/cointegration-reference.json';
import {
  run,
  parseScan,
  historyPaceMs,
  retainScanPair,
  type ScanPair,
  type ScanJob,
} from '../server/statarb-scanner.ts';
import type { Market } from '../src/types.ts';
const config = {
  venue: 'binance' as const,
  timeframe: '1h' as const,
  formationBars: 300 as const,
  preset: 'crypto' as const,
};
const job = (): ScanJob => ({
  method: 'log-ols-eg-adf1-mackinnon2010-unadjusted-v1',
  id: 'test',
  config,
  status: 'fetching',
  startedAt: Date.now(),
  finishedAt: null,
  universe: 0,
  loaded: 0,
  failed: [],
  tested: 0,
  invalidPairs: 0,
  totalPairs: 0,
  passed: 0,
  opportunities: 0,
  results: [],
});
const asset = (id: string) =>
  ({ id, venue: id.startsWith('binance:') ? 'binance' : 'hyperliquid', volumeUsd24h: 0 }) as Market;
const history = async (id: string, tf: unknown, count: number, now = Date.now()) => {
  expect(tf).toBe('1h');
  expect(count).toBe(301);
  if (id.endsWith('FAIL')) throw Error('No history');
  const c = reference.cases[0]!,
    prices = id.endsWith('A') ? c.y : c.x;
  return {
    schemaVersion: 1 as const,
    assetId: id,
    venue: 'binance' as const,
    interval: '1h' as const,
    capturedAt: now,
    candles: prices.map((close, i) => ({
      time: i * 3600000,
      closeTime: (i + 1) * 3600000 - 1,
      open: close,
      high: close,
      low: close,
      close,
      volumeBase: 1,
      volumeUsd: close,
    })),
  };
};
it('attempts all venue assets with no volume cutoff, tests each unordered pair and shows failures and ±2 direction', async () => {
  const current = job(),
    seen: string[] = [];
  await run(current, {
    markets: async () => [
      asset('binance:A'),
      asset('binance:B'),
      asset('binance:FAIL'),
      asset('hyperliquid:ETH'),
    ],
    history: async (...args) => {
      seen.push(args[0]);
      return history(...args);
    },
    pause: async () => {},
  });
  expect(seen.sort()).toEqual(['binance:A', 'binance:B', 'binance:FAIL']);
  expect(current).toMatchObject({
    status: 'done',
    universe: 3,
    loaded: 2,
    tested: 1,
    totalPairs: 1,
    passed: 1,
    opportunities: 1,
  });
  expect(current.failed).toHaveLength(1);
  expect(current.results[0]).toMatchObject({
    longLeg: 'binance:B',
    shortLeg: 'binance:A',
    direction: 'short_spread',
    outsideStop: true,
  });
});
it('rejects misaligned pairs and near-identical contracts instead of showing bogus opportunities', async () => {
  const current = job();
  await run(current, {
    markets: async () => [asset('binance:B'), asset('binance:C'), asset('binance:D')],
    history: async (...args) => {
      const d = await history(...args);
      if (args[0].endsWith('D')) d.candles[10]!.time++;
      return d;
    },
    pause: async () => {},
  });
  expect(current.tested).toBe(3);
  expect(current.invalidPairs).toBe(3);
  expect(current.results).toEqual([]);
});
it('does not restart pair testing after cancellation during history fetch', async () => {
  const current = job();
  await run(current, {
    markets: async () => [asset('binance:A'), asset('binance:B')],
    history,
    pause: async () => {
      current.status = 'cancelled';
    },
  });
  expect(current.status).toBe('cancelled');
  expect(current.tested).toBe(0);
});
it('rejects unsupported intervals, venues and unbounded requests', () => {
  for (const c of [
    { ...config, venue: 'all' },
    { ...config, timeframe: '1M' },
    { ...config, formationBars: 100000 },
    { ...config, preset: 'garbage' },
  ])
    expect(() => parseScan(c)).toThrow();
  expect(parseScan(config)).toEqual(config);
});

it('paces history weight independently of pair-compute yielding', () => {
  expect(historyPaceMs(config)).toBeGreaterThanOrEqual(200);
  expect(historyPaceMs({ ...config, venue: 'hyperliquid' })).toBeGreaterThan(3000);
  expect(historyPaceMs({ ...config, venue: 'hyperliquid', formationBars: 1080 })).toBeGreaterThan(10000);
});

it('coalesces active jobs, cancels without a stale completion, and enforces start cooldown', async () => {
  vi.resetModules();
  const scanner = await import('../server/statarb-scanner.ts');
  let now = 1800000000000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  let done!: (m: Market[]) => void;
  const pending = new Promise<Market[]>((resolve) => {
    done = resolve;
  });
  const deps = { markets: () => pending, history, pause: async () => {} };
  try {
    const first = scanner.startScan(config, deps);
    expect(first.status).toBe('fetching');
    expect(() => scanner.startScan(config, deps)).toThrow('already running');
    expect(scanner.cancelScan()?.status).toBe('cancelled');
    expect(() => scanner.startScan(config, deps)).toThrow('one minute');
    now += 61000;
    const next = scanner.startScan(config, deps);
    expect(next.id).not.toBe(first.id);
    done([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scanner.scanStatus()?.id).toBe(next.id);
    expect(scanner.scanStatus()?.status).toBe('failed');
  } finally {
    clock.mockRestore();
  }
});

it('retains the best 500 with stable ties and opportunity priority across large universes', () => {
  const input = Array.from(
    { length: 2500 },
    (_, i) => ({ y: String(i), z: (i % 7) - 3, adf: -(i % 97) / 10 }) as ScanPair,
  );
  const expected = [...input]
    .sort((a, b) => Number(Math.abs(b.z) >= 2) - Number(Math.abs(a.z) >= 2) || a.adf - b.adf)
    .slice(0, 500);
  const rows: ScanPair[] = [];
  for (const pair of input) retainScanPair(rows, pair);
  expect(rows).toEqual(expected);
});
