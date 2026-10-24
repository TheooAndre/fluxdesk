import { expect, it } from 'vitest';
import { readScanPreferences, scanCandleAge, validateScanConfig } from '../src/engine/statarb-settings.ts';
it('recovers invalid saved preferences and rejects venue-incompatible intervals', () => {
  expect(readScanPreferences('{broken').config.timeframe).toBe('4h');
  expect(() =>
    validateScanConfig({ venue: 'hyperliquid', timeframe: '6h', formationBars: 300, preset: 'crypto' }),
  ).toThrow();
  const p = {
    version: 1,
    config: { venue: 'hyperliquid', timeframe: '15m', formationBars: 180, preset: 'crypto' },
    onlySignals: false,
    sort: 'deviation',
    direction: 'long_spread',
  };
  expect(readScanPreferences(JSON.stringify(p))).toEqual(p);
});
it('ages a snapshot from candle close rather than candle open', () => {
  expect(scanCandleAge(0, '1h', 3599999).barsBehind).toBe(0);
  expect(scanCandleAge(0, '1h', 7199999).barsBehind).toBe(0);
  expect(scanCandleAge(0, '1h', 7200000)).toEqual({ closedAt: 3600000, barsBehind: 1 });
});
