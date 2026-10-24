import { expect, it } from 'vitest';
import { marketCategories, matchesCategory } from '../src/lib/categories.ts';
it('supports overlapping project themes and exact venue contracts', () => {
  expect(marketCategories({ id: 'hyperliquid:HYPE' })).toEqual(expect.arrayContaining(['dex', 'perps', 'defi']));
  expect(marketCategories({ id: 'binance:ETHUSDT' })).toContain('l1');
  expect(marketCategories({ id: 'binance:BTCUSDT' })).not.toContain('perps');
  expect(matchesCategory({ id: 'binance:BTCUSDT' }, 'perps')).toBe(false);
});
it('maps explicit multiplier tickers without stripping arbitrary ticker prefixes', () => {
  expect(marketCategories({ id: 'binance:1000PEPEUSDT' })).toContain('memecoins');
  expect(marketCategories({ id: 'hyperliquid:kPEPE' })).toContain('memecoins');
  expect(marketCategories({ id: 'binance:1000BTCUSDT' })).toEqual([]);
  expect(marketCategories({ id: 'binance:1INCHUSDT' })).not.toContain('infra');
  expect(marketCategories({ id: 'binance:BEAMXUSDT' })).toContain('gaming');
  expect(marketCategories({ id: 'hyperliquid:BEAM' })).toEqual([]);
});
it('leaves new, malformed and uncertain listings explicitly uncategorized', () => {
  for (const id of ['binance:NEWCOINUSDT', 'binance:BTCUSDC', 'hyperliquid:BTC:extra']) {
    expect(marketCategories({ id })).toEqual([]);
    expect(matchesCategory({ id }, 'uncategorized')).toBe(true);
    expect(matchesCategory({ id }, 'all')).toBe(true);
  }
});
