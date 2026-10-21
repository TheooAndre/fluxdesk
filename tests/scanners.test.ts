import { describe, expect, it } from 'vitest';
import { scanSignals, scanCorrelations } from '../server/scanners.ts';
import type { Candle, Market } from '../src/types.ts';
const bars: Candle[] = Array.from({ length: 150 }, (_, i) => {
  const close = 100 + i * 0.03 + Math.sin(i * 0.5);
  return {
    time: i * 3600_000,
    closeTime: (i + 1) * 3600_000 - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volumeBase: 1,
    volumeUsd: 100,
  };
});
const row = (base: string): Market => ({
  id: `binance:${base}USDT`,
  venue: 'binance',
  symbol: `${base}USDT`,
  base,
  price: 100,
  previous24h: 100,
  return24h: 0,
  volumeUsd24h: 10_000_000,
  oiUsd: null,
  asOf: Date.now(),
});
describe('scanner coverage', () => {
  it('reports insufficient history and fetch failures rather than no-signal passes', async () => {
    let active = 0,
      max = 0;
    const result = await scanSignals('hyperliquid:BTC', {
      markets: async () => [],
      candles: async (_asset, tf) => {
        active++;
        max = Math.max(max, active);
        await Promise.resolve();
        active--;
        if (tf === '1m') throw Error('upstream unavailable');
        return tf === '1M' ? bars.slice(0, 30) : bars;
      },
    });
    expect(result.inspected).toHaveLength(12);
    expect(result.failed).toHaveLength(2);
    expect(result.failed.find((x) => x.timeframe === '1M')!.reason).toContain('30/65');
    expect(result.directions).toEqual(['long', 'short']);
    expect(max).toBeLessThanOrEqual(4);
  });
  it('does not count failed pair comparisons as successful screens', async () => {
    const result = await scanCorrelations('binance:BTCUSDT', '1h', 0.87, {
      markets: async () => [row('BTC'), row('ETH'), row('SOL'), row('ADA')],
      candles: async (id) => {
        if (id.includes('SOL')) throw Error('rate limited');
        if (id.includes('ADA')) return bars.slice(-40);
        if (id.includes('ETH'))
          return bars.map((x, i) => ({ ...x, close: x.close * 2 + Math.sin(i * 0.7) * 0.05 }));
        return bars;
      },
    });
    expect(result.screened).toBe(3);
    expect(result.checked).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
  });
});
