import { expect, it } from 'vitest';
import { backtest, type ResearchConfig } from '../src/engine/backtest.ts';
import { fundingCashflow, type HistoricalAccounting } from '../src/engine/historical-accounting.ts';
import type { Candle, EntrySignal } from '../src/types.ts';
const step = 60000;
const bars = (): Candle[] =>
  Array.from({ length: 100 }, (_, i) => ({
    time: i * step,
    closeTime: (i + 1) * step - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volumeBase: 1,
    volumeUsd: 100,
  }));
const config: ResearchConfig = {
  model: 'sfp',
  initialEquity: 10000,
  riskFraction: 0.01,
  holdoutFraction: 0.25,
  costs: { feeBpsPerSide: 0, slippageBpsPerSide: 0 },
  historicalAccounting: true,
};
const history = (b: Candle[]): HistoricalAccounting => ({
  marks: b.map((x) => ({ time: x.time, closeTime: x.closeTime!, close: 90 })),
  funding: [{ time: 71 * step, rate: 0.001, markPrice: 100, rateType: 'Regular' }],
});
const signal =
  (side: 'long' | 'short' = 'long') =>
  (b: Candle[]): EntrySignal[] =>
    b.length === 70
      ? [
          {
            model: 'sfp',
            direction: side,
            label: 'fixture',
            detail: 'fixture',
            trigger: 100,
            stop: side === 'long' ? 95 : 105,
            target: side === 'long' ? 110 : 90,
            rr: 2,
            barTime: b.at(-1)!.time,
            status: 'candidate',
          },
        ]
      : [];
it('charges longs, credits shorts, and reconciles funding, mark equity and realized cash', () => {
  const b = bars(),
    h = history(b);
  const long = backtest(b, config, signal(), h),
    short = backtest(b, config, signal('short'), h);
  expect(long.trades[0]!.fundingPnl).toBe(-2);
  expect(short.trades[0]!.fundingPnl).toBe(2);
  expect(long.trades[0]!.netPnl).toBe(-2);
  expect(long.equityCurve![71]!.value).toBe(9800); // close of entry bar, before funding
  expect(long.equityCurve![72]!.value).toBe(9798);
  expect(long.equityCurve!.at(-1)!.value).toBe(9998);
  expect(long.accounting).toBe('observed-funding-mark-v3');
});
it('uses conservative debits but no credits when funding and exit ordering is unknown', () => {
  const b = bars();
  b[72]!.low = 94;
  const h = history(b);
  h.funding = [
    { time: 72 * step + 100, rate: 0.001, markPrice: 100, rateType: 'Regular' },
    { time: 72 * step + 200, rate: -0.002, markPrice: 100, rateType: 'Regular' },
  ];
  const r = backtest(b, config, signal(), h);
  expect(r.trades[0]!.exitTiming).toBe('intrabar');
  expect(r.trades[0]!.fundingPnl).toBe(-2);
  expect(r.trades[0]!.netPnl).toBe(-102);
});
it('does not assign future payments to open equity or closed sample trades', () => {
  const b = bars(),
    h = history(b);
  h.funding[0]!.time = 75 * step;
  const r = backtest(b, config, signal(), h);
  expect(r.trades[0]!.fundingPnl).toBe(0);
  expect(r.equityCurve!.at(-1)!.value).toBe(10000);
});
it('handles gap exits at the opening time and excludes later funding', () => {
  const b = bars();
  b[72] = { ...b[72]!, open: 90, low: 89, high: 91, close: 90 };
  const h = history(b);
  h.funding[0]!.time = 72 * step + 1;
  const r = backtest(b, config, signal(), h);
  expect(r.trades[0]!.exitTime).toBe(72 * step);
  expect(r.trades[0]!.fundingPnl).toBe(0);
});
it('keeps legacy results unchanged unless enabled and fails on missing or invalid history', () => {
  const b = bars(),
    h = history(b),
    legacy = { ...config, historicalAccounting: false };
  expect(backtest(b, legacy, signal(), h)).toEqual(backtest(b, legacy, signal()));
  expect(() => backtest(b, config, signal())).toThrow('enriched');
  h.marks.pop();
  expect(() => backtest(b, config, signal(), h)).toThrow();
});
it('does not assume funding at entry is a guaranteed credit', () => {
  const h = history(bars());
  h.funding = [{ time: 10, rate: -0.01, markPrice: 100, rateType: 'Regular' }];
  expect(
    fundingCashflow({ entryTime: 10, exitTime: 20, direction: 'long', size: 1, exitTiming: 'close' }, h),
  ).toBe(0);
  h.funding[0]!.rate = 0.01;
  expect(
    fundingCashflow({ entryTime: 10, exitTime: 20, direction: 'long', size: 1, exitTiming: 'close' }, h),
  ).toBe(-1);
});
