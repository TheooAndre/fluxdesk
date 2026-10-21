import { describe, it, expect } from 'vitest';
import {
  correlation,
  relativeReturn,
  pairStats,
  volumeSpikePct,
  priceLevels,
  crossedPriceLevel,
} from '../src/engine/stats.ts';
import { detectSignals } from '../src/engine/signals.ts';
import { intervalsFor, assertInterval } from '../src/engine/intervals.ts';
import type { Candle } from '../src/types.ts';
const BAR = 3600_000;
function bar(i: number, close: number, high = close + 1, low = close - 1, volume = 100): Candle {
  return { time: i * BAR, open: close - 0.3, high, low, close, volumeBase: 1, volumeUsd: volume };
}
describe('relative performance', () => {
  it('calculates exact multiplicative relative return', () => {
    expect(relativeReturn(10, 5)).toBeCloseTo(4.76190476, 4);
  });
  it('is not simple subtraction', () => {
    expect(relativeReturn(-10, 10)).toBeCloseTo(-18.181818, 4);
  });
});
describe('bias guards', () => {
  it('rejects inadequate correlation sample sizes and constant returns', () => {
    expect(Number.isNaN(correlation([1, 2], [1, 2]))).toBe(true);
    expect(Number.isNaN(correlation(Array(40).fill(1), Array(40).fill(2)))).toBe(true);
  });
  it('rejects misaligned candle pairs', () => {
    const a = Array.from({ length: 100 }, (_, i) => bar(i, 100 + i + Math.sin(i / 3)));
    const b = Array.from({ length: 100 }, (_, i) => bar(i + 1000, 90 + i + Math.sin(i / 3)));
    expect(pairStats('a', 'b', a, b, 50)).toBeNull();
  });
  it('requires 20 preceding completed candles for volume spike', () => {
    const a = Array.from({ length: 20 }, (_, i) => bar(i, 100, 101, 99, 100));
    expect(volumeSpikePct(a)).toBeNull();
    expect(volumeSpikePct([...a, bar(20, 100, 101, 99, 300)])).toBeCloseTo(200);
  });
  it('uses previous bars for support and resistance levels', () => {
    const a = Array.from({ length: 50 }, (_, i) => bar(i, 100, 102, 98));
    a[a.length - 1] = bar(49, 110, 130, 80);
    const levels = priceLevels(a);
    expect(levels.find((x) => x.note.includes('range high'))?.price).toBe(102);
  });
  it('does not emit signal candidates without adequate completed history', () =>
    expect(detectSignals(Array.from({ length: 20 }, (_, i) => bar(i, 100)))).toHaveLength(0));
  it('detects bearish sweep-and-reject only from confirmed current close', () => {
    const a = Array.from({ length: 65 }, (_, i) => bar(i, 100 + 0.05 * Math.sin(i)));
    a.push({ ...bar(65, 99, 104, 98), open: 101 });
    const signals = detectSignals(a);
    expect(signals.some((s) => s.model === 'sfp' && s.direction === 'short')).toBe(true);
  });
});

describe('price alert edge detection', () => {
  it('alerts only on a genuine crossing, not a persistent above-threshold state', () => {
    expect(crossedPriceLevel(99, 101, 100, 'above')).toBe(true);
    expect(crossedPriceLevel(101, 103, 100, 'above')).toBe(false);
    expect(crossedPriceLevel(101, 99, 100, 'below')).toBe(true);
    expect(crossedPriceLevel(99, 98, 100, 'below')).toBe(false);
  });
});

describe('venue-supported timeframe coverage', () => {
  it('includes all fifteen Binance and fourteen Hyperliquid candle granularities', () => {
    expect(intervalsFor('binance')).toHaveLength(15);
    expect(intervalsFor('hyperliquid')).toHaveLength(14);
    expect(() => assertInterval('binance', '6h')).not.toThrow();
    expect(() => assertInterval('hyperliquid', '6h')).toThrow();
    expect(() => assertInterval('hyperliquid', '1M')).not.toThrow();
  });
});

// The displayed hedge ratio must correspond to the same past-only fit as the current z-score.
it('does not change the displayed hedge beta when only the latest candle changes', () => {
  const a = Array.from({ length: 120 }, (_, i) => ({
    time: i,
    open: 100,
    high: 200,
    low: 50,
    close: 100 + i * 0.1 + Math.sin(i),
    volumeBase: 1,
    volumeUsd: 100,
  }));
  const b = a.map((x, i) => ({ ...x, close: 80 + i * 0.06 + Math.cos(i * 0.8) }));
  const before = pairStats('a', 'b', a, b, 80);
  const changed = a.map((x, i) => (i === 119 ? { ...x, close: x.close * 1.3 } : x));
  const after = pairStats('a', 'b', changed, b, 80);
  expect(before).not.toBeNull();
  expect(after?.beta).toBe(before?.beta);
  expect(after?.zScore).not.toBe(before?.zScore);
});
