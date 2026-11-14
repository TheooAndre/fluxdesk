import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Market } from '../src/types.ts';
import { marketCategories } from '../src/lib/categories.ts';
let mod: typeof import('../server/float-screen.ts');
let now: number;
const row = (extra = {}) => ({
  id: 'arbitrum',
  symbol: 'arb',
  market_cap: 400e6,
  fully_diluted_valuation: 2e9,
  max_supply: 10e9,
  last_updated: new Date(now - 1000).toISOString(),
  ...extra,
});
const market = { id: 'binance:ARBUSDT', symbol: 'ARBUSDT' } as Market;
beforeEach(async () => {
  vi.resetModules();
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mod = await import('../server/float-screen.ts');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('uses exact provider identities and finite, recent supply, excluding missing, mismatched and future data', () => {
  expect(mod.parseFloatScreen([row()]).get('ARB')?.marketCapToFdv).toBe(0.2);
  for (const bad of [
    { max_supply: null },
    { market_cap: Infinity },
    { symbol: 'different' },
    { last_updated: new Date(now + 1).toISOString() },
    { last_updated: new Date(now - 25 * 3600_000).toISOString() },
  ])
    expect(mod.parseFloatScreen([row(bad)]).size).toBe(0);
  expect(() => mod.parseFloatScreen({ data: [] })).toThrow();
});
it('adds/removes screen membership on refresh, coalesces requests and never labels a failed refresh fresh', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([row()]));
  vi.stubGlobal('fetch', fetcher);
  await Promise.all([mod.refreshFloatScreen(), mod.refreshFloatScreen()]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  let value = mod.withFloatScreen([market])[0]!;
  expect(value.floatScreen?.status).toBe('fresh');
  expect(marketCategories(value)).toContain('low-float-high-fdv');
  now += 3600_001;
  fetcher.mockResolvedValue(Response.json([row({ market_cap: 1.5e9 })]));
  await mod.refreshFloatScreen();
  value = mod.withFloatScreen([market])[0]!;
  expect(marketCategories(value)).not.toContain('low-float-high-fdv');
  now += 3600_001;
  fetcher.mockRejectedValue(Error('key or provider details'));
  await mod.refreshFloatScreen();
  value = mod.withFloatScreen([market])[0]!;
  expect(value.floatScreen?.status).toBe('stale');
  expect(JSON.stringify(value)).not.toContain('provider details');
});
it('keeps unknown listings out of the dynamic screen instead of guessing a symbol mapping', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([row()])));
  await mod.refreshFloatScreen();
  const missing = mod.withFloatScreen([{ id: 'hyperliquid:SOMETHING' } as Market])[0]!;
  expect(missing.floatScreen?.status).toBe('unknown');
  expect(marketCategories(missing)).not.toContain('low-float-high-fdv');
});
it('expires dynamic membership on the client even if an offline snapshot still carries a fresh status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([row()])));
  await mod.refreshFloatScreen();
  const snapshot = mod.withFloatScreen([market])[0]!;
  expect(marketCategories(snapshot)).toContain('low-float-high-fdv');
  now += 25 * 3600_000;
  expect(marketCategories(snapshot)).not.toContain('low-float-high-fdv');
});
