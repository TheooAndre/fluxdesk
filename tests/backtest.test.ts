import { describe, expect, it } from 'vitest';
import type { Candle, EntrySignal, SignalModel } from '../src/types.ts';
import { backtest, type ResearchConfig } from '../src/engine/backtest.ts';

const config: ResearchConfig = {
  model: 'sfp', initialEquity: 10_000, riskFraction: 0.01,
  holdoutFraction: 0.25, costs: { feeBpsPerSide: 0, slippageBpsPerSide: 0 },
};
const day = 60_000;
const bars = (n = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({
    time: i * day, closeTime: (i + 1) * day - 1,
    open: 100, high: 101, low: 99, close: 100,
    volumeBase: 100, volumeUsd: 10_000,
  }));
const signal = (bar: Candle, direction: 'long' | 'short' = 'long'): EntrySignal => ({
  model: 'sfp', direction, label: 'synthetic', detail: 'test',
  trigger: 100, stop: direction === 'long' ? 95 : 105,
  target: direction === 'long' ? 110 : 90, rr: 2,
  barTime: bar.time, barCloseTime: bar.closeTime, status: 'candidate',
});
const at = (index: number, direction: 'long' | 'short' = 'long') =>
  (history: Candle[], _models: SignalModel[]) =>
    history.length === index + 1 ? [signal(history.at(-1)!, direction)] : [];

describe('deterministic strategy research', () => {
  it('never passes a future candle to the detector and fills no earlier than next bar', () => {
    const data = bars();
    const examined: number[] = [];
    const result = backtest(data, config, (history) => {
      examined.push(history.length);
      return history.length === 70 ? [signal(history.at(-1)!)] : [];
    });
    expect(Math.max(...examined)).toBe(data.length - 1);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.signalTime).toBe(data[69]!.closeTime);
    expect(result.trades[0]!.entryTime).toBe(data[70]!.time);
    expect(result.trades[0]!.exitReason).toBe('end_of_data');
  });

  it('chooses the stop if a candle crosses both stop and target', () => {
    const data = bars();
    data[70] = { ...data[70]!, low: 94, high: 111 };
    const result = backtest(data, config, at(69));
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.exitReason).toBe('stop');
    expect(result.trades[0]!.netPnl).toBeCloseTo(-100, 6);
  });

  it('accounts for an adverse gap at the actual opening price', () => {
    const data = bars();
    data[70] = { ...data[70]!, open: 90, high: 91, low: 89, close: 90 };
    // The entry bar opens beyond the original stop: the trade must be skipped.
    const result = backtest(data, config, at(69));
    expect(result.trades).toHaveLength(0);
  });

  it('deducts fees and slippage and constrains risk position size', () => {
    const data = bars();
    data[70] = { ...data[70]!, high: 111 };
    const costly = { ...config, costs: { feeBpsPerSide: 10, slippageBpsPerSide: 10 } };
    const result = backtest(data, costly, at(69));
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0]!;
    expect(t.entry).toBeGreaterThan(100);
    expect(t.exit).toBeLessThan(110);
    expect(t.fees).toBeGreaterThan(0);
    expect(t.netPnl).toBeLessThan(t.grossPnl);
    expect(t.size).toBeLessThan(20);
  });

  it('rejects invalid and unordered OHLC without inventing observations', () => {
    const data = bars();
    data[12] = { ...data[12]!, high: 95 };
    expect(() => backtest(data, config)).toThrow('Overlapping, unordered or invalid candles');
    expect(() => backtest(bars(), { ...config, holdoutFraction: 0 })).toThrow('Holdout');
  });

  it('keeps holdout results separately labeled and discloses insufficient sample', () => {
    const result = backtest(bars(), config, at(82));
    expect(result.development.count).toBe(0);
    expect(result.holdout.count).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/fewer than 30/);
  });
});
