import { describe, expect, it } from 'vitest';
import type { Candle, EntrySignal } from '../src/types.ts';
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
  (history: Candle[]) =>
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
    expect(result.trades[0]!.exitReason).toBe('sample_end');
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

  it('liquidates an unfinished development trade at the split without contaminating holdout', () => {
    const data = bars();
    const result = backtest(data, config, at(73));
    expect(result.splitIndex).toBe(75);
    expect(result.development.count).toBe(1);
    expect(result.holdout.count).toBe(0);
    expect(result.trades[0]).toMatchObject({
      sample: 'development', exitReason: 'sample_end',
      exitTime: data[74]!.closeTime,
    });
  });

  it('never uses the last development signal as a holdout entry', () => {
    const result = backtest(bars(), config, at(74));
    expect(result.trades).toHaveLength(0);
  });

  it('rejects missing candles rather than silently backtesting across gaps', () => {
    const data = bars();
    data.splice(28, 1);
    expect(() => backtest(data, config)).toThrow('Overlapping, unordered or invalid candles');
  });

  it('keeps holdout results separately labeled and discloses insufficient sample', () => {
    const result = backtest(bars(), config, at(82));
    expect(result.development.count).toBe(0);
    expect(result.holdout.count).toBe(1);
    expect(result.warnings.join(' ')).toMatch(/fewer than 30/);
  });
});

describe('open-position equity and bounded gross exposure', () => {
  it.each(['long', 'short'] as const)('captures %s unrealized gains and drawdown before a flat close', (side) => {
    const data = bars();
    data[70] = { ...data[70]!, high: side === 'long' ? 109 : 101, low: side === 'long' ? 99 : 91, close: side === 'long' ? 108 : 92 };
    data[71] = { ...data[71]!, high: side === 'long' ? 101 : 103, low: side === 'long' ? 97 : 99, close: side === 'long' ? 98 : 102 };
    const result = backtest(data, config, at(69, side));
    expect(result.summary.netPnl).toBe(0);
    expect(result.summary.maxDrawdownPct).toBe(0);
    expect(result.summary.maxOpenEquityDrawdownPct).toBeCloseTo(100 * 200 / 10160);
    expect(result.equityCurve?.find((p) => p.time === data[70]!.closeTime)).toMatchObject({ value: 10160, position: side, sample: 'development' });
    expect(result.equityCurve?.at(-1)?.value).toBe(config.initialEquity);
    expect(result.equityCurve).toHaveLength(data.length + 1);
  });
  it('deducts paid entry fees while open and reconciles realized exit costs exactly', () => {
    const result = backtest(bars(), { ...config, costs: { feeBpsPerSide: 10, slippageBpsPerSide: 5 } }, at(69));
    const trade = result.trades[0]!;
    const entryEquity = config.initialEquity + (100 - trade.entry) * trade.size - trade.entry * trade.size * 0.001;
    expect(result.equityCurve?.find((p) => p.time === bars()[70]!.closeTime)?.value).toBeCloseTo(entryEquity);
    expect(result.equityCurve?.find((p) => p.time === trade.exitTime)).toMatchObject({ position: 'flat', value: config.initialEquity + trade.netPnl });
    expect(result.equityCurve?.at(-1)?.value).toBeCloseTo(config.initialEquity + result.summary.netPnl);
  });
  it('does not spread a future exit result back through open-position equity', () => {
    const first = bars();
    const changed = bars();
    changed[74] = { ...changed[74]!, close: 104, high: 105 };
    const a = backtest(first, config, at(69));
    const b = backtest(changed, config, at(69));
    expect(a.summary.netPnl).not.toBe(b.summary.netPnl);
    expect(a.equityCurve?.filter((p) => p.time < first[74]!.closeTime!)).toEqual(b.equityCurve?.filter((p) => p.time < first[74]!.closeTime!));
  });
  it('caps narrow-stop position sizing at default 1x instead of allowing unlimited notional', () => {
    const data = bars();
    data[70] = { ...data[70]!, low: 99.995 };
    const result = backtest(data, config, (history) => history.length === 70 ? [{ ...signal(history.at(-1)!), stop: 99.99 }] : []);
    const trade = result.trades[0]!;
    expect(result.config.maxGrossLeverage).toBe(1);
    expect(trade.size).toBe(100);
    expect(trade.entryNotional).toBe(10_000);
    expect(trade.grossLeverage).toBe(1);
    expect(trade.sizeCapped).toBe(true);
    expect(result.summary.sizeCappedCount).toBe(1);
  });
  it('reserves entry fees when applying an explicit exposure cap', () => {
    const data = bars();
    data[70] = { ...data[70]!, low: 99.995 };
    const result = backtest(data, { ...config, riskFraction: 0.05, maxGrossLeverage: 2, costs: { feeBpsPerSide: 10, slippageBpsPerSide: 0 } }, (history) => history.length === 70 ? [{ ...signal(history.at(-1)!), stop: 99.99 }] : []);
    const trade = result.trades[0]!;
    const entryFee = trade.entryNotional! * 0.001;
    expect(trade.entryNotional! / (config.initialEquity - entryFee)).toBeCloseTo(2);
    expect(trade.grossLeverage).toBeLessThan(2);
    expect(trade.sizeCapped).toBe(true);
  });
  it('closes equity flat at the split, handles no-trade runs, and rejects invalid caps', () => {
    const result = backtest(bars(), config, at(73));
    expect(result.equityCurve?.find((p) => p.time === bars()[74]!.closeTime)?.position).toBe('flat');
    expect(result.equityCurve?.find((p) => p.time === bars()[75]!.closeTime)?.sample).toBe('holdout');
    const empty = backtest(bars(), config, () => []);
    expect(empty.equityCurve?.every((p) => p.value === config.initialEquity && p.position === 'flat')).toBe(true);
    for (const maxGrossLeverage of [0, -1, NaN, Infinity, 3.1]) expect(() => backtest(bars(), { ...config, maxGrossLeverage })).toThrow('gross exposure cap');
  });
});

it('reconciles open-position equity after an adverse held-position gap without capping the loss at planned risk', () => {
  const data = bars();
  data[71] = { ...data[71]!, open: 90, high: 91, low: 89, close: 90 };
  const result = backtest(data, config, at(69));
  expect(result.trades[0]).toMatchObject({ exitReason: 'stop', exit: 90, netPnl: -200, rMultiple: -2 });
  expect(result.equityCurve?.find((point) => point.time === data[71]!.closeTime)).toMatchObject({ position: 'flat', value: 9800 });
  expect(result.summary.maxOpenEquityDrawdownPct).toBe(2);
});

it('rejects detector targets that cannot produce a finite valid fill', () => {
  for (const target of [NaN, Infinity, -1]) {
    const result = backtest(bars(), config, (history) => history.length === 70 ? [{ ...signal(history.at(-1)!), target }] : []);
    expect(result.trades).toHaveLength(0);
  }
});
