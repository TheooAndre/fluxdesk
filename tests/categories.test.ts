import { expect, it } from 'vitest';
import {
  LOW_FLOAT_HIGH_FDV_CRITERIA,
  LOW_FLOAT_HIGH_FDV_SNAPSHOT,
  marketCategories,
  matchesCategory,
} from '../src/lib/categories.ts';

it('supports overlapping project themes and exact venue contracts', () => {
  expect(marketCategories({ id: 'hyperliquid:HYPE' })).toEqual(
    expect.arrayContaining(['dex', 'perps', 'defi']),
  );
  expect(marketCategories({ id: 'binance:ETHUSDT' })).toContain('l1');
  expect(marketCategories({ id: 'binance:BTCUSDT' })).not.toContain('perps');
  expect(matchesCategory({ id: 'binance:BTCUSDT' }, 'perps')).toBe(false);
});
it('maps explicit multiplier tickers without stripping arbitrary ticker prefixes', () => {
  expect(marketCategories({ id: 'binance:1000PEPEUSDT' })).toContain('memecoins');
  expect(marketCategories({ id: 'hyperliquid:kPEPE' })).toContain('memecoins');
  expect(marketCategories({ id: 'binance:1000CATUSDT' })).toContain('memecoins');
  expect(marketCategories({ id: 'binance:1000RATSUSDT' })).toContain('memecoins');
  expect(marketCategories({ id: 'binance:1000BTCUSDT' })).toEqual([]);
  expect(marketCategories({ id: 'binance:1INCHUSDT' })).not.toContain('infra');
  expect(marketCategories({ id: 'binance:BEAMXUSDT' })).toContain('gaming');
  expect(marketCategories({ id: 'hyperliquid:BEAM' })).toEqual([]);
});

it('covers reviewed current projects without treating generic chains as AI projects', () => {
  expect(marketCategories({ id: 'binance:GRASSUSDT' })).toEqual(expect.arrayContaining(['ai', 'depin']));
  expect(marketCategories({ id: 'binance:ZROUSDT' })).toContain('infra');
  expect(marketCategories({ id: 'binance:COWUSDT' })).toEqual(expect.arrayContaining(['dex', 'defi']));
  expect(marketCategories({ id: 'binance:HUMAUSDT' })).toEqual(expect.arrayContaining(['rwa', 'defi']));
  expect(marketCategories({ id: 'binance:MEGAUSDT' })).toContain('l2');
  expect(marketCategories({ id: 'binance:FARTCOINUSDT' })).toContain('memecoins');
  expect(marketCategories({ id: 'binance:NEARUSDT' })).not.toContain('ai');
  expect(marketCategories({ id: 'binance:ICPUSDT' })).not.toContain('ai');
  expect(marketCategories({ id: 'binance:WLDUSDT' })).not.toContain('ai');
});

it('keeps the low-float/high-FDV screen tied to its documented snapshot rule', () => {
  expect(new Set(LOW_FLOAT_HIGH_FDV_SNAPSHOT.map(({ symbol }) => symbol)).size).toBe(
    LOW_FLOAT_HIGH_FDV_SNAPSHOT.length,
  );
  expect(new Set(LOW_FLOAT_HIGH_FDV_SNAPSHOT.map(({ coingeckoId }) => coingeckoId)).size).toBe(
    LOW_FLOAT_HIGH_FDV_SNAPSHOT.length,
  );

  for (const entry of LOW_FLOAT_HIGH_FDV_SNAPSHOT) {
    expect(entry.marketCapToFdv).toBeLessThan(LOW_FLOAT_HIGH_FDV_CRITERIA.marketCapToFdvExclusive);
    expect(entry.fdvUsd).toBeGreaterThanOrEqual(LOW_FLOAT_HIGH_FDV_CRITERIA.minimumFdvUsdInclusive);
    expect(Number.isFinite(entry.maxSupply)).toBe(true);
    expect(entry.maxSupply).toBeGreaterThan(0);
    expect(marketCategories({ id: `binance:${entry.symbol}USDT` })).toContain('low-float-high-fdv');
    expect(marketCategories({ id: `hyperliquid:${entry.symbol}` })).toContain('low-float-high-fdv');
  }

  expect(marketCategories({ id: 'binance:PUMPUSDT' })).not.toContain('low-float-high-fdv');
  expect(marketCategories({ id: 'binance:FILUSDT' })).not.toContain('low-float-high-fdv');
  expect(marketCategories({ id: 'binance:AEROUSDT' })).not.toContain('low-float-high-fdv');
});

it('leaves new, malformed and uncertain listings explicitly uncategorized', () => {
  for (const id of ['binance:NEWCOINUSDT', 'binance:BTCUSDC', 'hyperliquid:BTC:extra']) {
    expect(marketCategories({ id })).toEqual([]);
    expect(matchesCategory({ id }, 'uncategorized')).toBe(true);
    expect(matchesCategory({ id }, 'all')).toBe(true);
  }
});
