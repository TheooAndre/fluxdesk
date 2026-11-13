import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/types.ts';
import {
  ADVANCED_INDICATORS,
  defaultTechnicalCondition,
  validateTechnicalCondition,
} from '../src/lib/advanced-alert.ts';
import {
  averageTrueRange,
  evaluateTechnicalCondition,
  movingAverage,
  relativeStrengthIndex,
} from '../src/engine/technical-alerts.ts';

const bars = (values: number[]): Candle[] =>
  values.map((close, i) => ({
    time: i * 60_000,
    closeTime: (i + 1) * 60_000 - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volumeBase: 100 + i,
    volumeUsd: (100 + i) * close,
  }));
const wave = bars(Array.from({ length: 300 }, (_, i) => 200 + 10 * Math.sin(i / 5) + i * 0.1));
describe('published indicator catalog', () => {
  for (const definition of ADVANCED_INDICATORS) {
    for (const signal of definition.signals)
      it(`${definition.id}: ${signal.id} is validated and executable`, () => {
        const condition = { ...defaultTechnicalCondition(definition.id), signal: signal.id };
        expect(validateTechnicalCondition(condition)).toEqual(condition);
        const result = evaluateTechnicalCondition(condition, wave);
        expect(typeof result.matched).toBe('boolean');
        expect(result.event).toBe(signal.event === true);
        expect(result.barTime).toBe(wave.at(-1)!.closeTime);
      });
  }
});
it('seeds SMA, EMA and Wilder averages from complete windows', () => {
  expect(movingAverage([2, 4, 6, 8, 10], 3)).toEqual([null, null, 4, 6, 8]);
  expect(movingAverage([2, 4, 6, 8, 10], 3, 'ema')).toEqual([null, null, 4, 6, 8]);
  expect(movingAverage([2, 4, 6, 8, 10], 3, 'rma').at(-1)).toBeCloseTo(6.8888888889);
});
it('matches the Wilder RSI reference calculation and handles flat and one-way series', () => {
  const reference = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    46.0,
  ];
  expect(relativeStrengthIndex(reference, 14)[14]).toBeCloseTo(70.464135, 5);
  expect(relativeStrengthIndex(reference, 14)[15]).toBeCloseTo(66.249619, 5);
  expect(relativeStrengthIndex(Array(40).fill(10), 14).at(-1)).toBe(50);
  expect(
    relativeStrengthIndex(
      Array.from({ length: 40 }, (_, i) => i + 1),
      14,
    ).at(-1),
  ).toBe(100);
  expect(
    relativeStrengthIndex(
      Array.from({ length: 40 }, (_, i) => 100 - i),
      14,
    ).at(-1),
  ).toBe(0);
});
it('uses gaps in true range and Wilder ATR smoothing', () => {
  expect(averageTrueRange(bars([10, 12, 9, 11]), 3).at(-1)).toBeCloseTo(10 / 3);
});
it('detects both price/EMA crossings, without treating static alignment as a new cross', () => {
  const c = { ...defaultTechnicalCondition('ema_price'), params: { period: 3 } };
  expect(evaluateTechnicalCondition(c, bars([...Array(30).fill(100), 110])).matched).toBe(true);
  expect(
    evaluateTechnicalCondition({ ...c, signal: 'cross_down' }, bars([...Array(30).fill(100), 90])).matched,
  ).toBe(true);
  expect(evaluateTechnicalCondition(c, bars([...Array(30).fill(100), 110, 115])).matched).toBe(false);
});
it('detects band and displaced cloud breakouts without using unfinished future candles', () => {
  const series = bars([...Array(100).fill(100), 130]);
  expect(evaluateTechnicalCondition(defaultTechnicalCondition('bollinger'), series).matched).toBe(true);
  expect(
    evaluateTechnicalCondition({ ...defaultTechnicalCondition('ichimoku'), signal: 'cloud_up' }, series)
      .matched,
  ).toBe(true);
});
it('requires an actual inside bar and a close beyond the mother bar', () => {
  const series = bars(Array(30).fill(100));
  Object.assign(series.at(-3)!, { high: 110, low: 90 });
  Object.assign(series.at(-2)!, { high: 105, low: 95 });
  Object.assign(series.at(-1)!, { open: 100, close: 111, high: 112 });
  expect(evaluateTechnicalCondition(defaultTechnicalCondition('inside_bar'), series).matched).toBe(true);
  series.at(-1)!.close = 109;
  expect(evaluateTechnicalCondition(defaultTechnicalCondition('inside_bar'), series).matched).toBe(false);
});
it('counts exactly nine TD setup bars and does not repeat on the tenth', () => {
  const values = [...Array(30).fill(100), ...Array.from({ length: 9 }, (_, i) => 99 - i)];
  expect(evaluateTechnicalCondition(defaultTechnicalCondition('td_setup'), bars(values)).matched).toBe(true);
  expect(
    evaluateTechnicalCondition(defaultTechnicalCondition('td_setup'), bars([...values, 90])).matched,
  ).toBe(false);
});
it('confirms divergence only after two trailing pivot candles', () => {
  const series = bars(Array.from({ length: 80 }, (_, i) => (i < 65 ? 200 - i : 135 + (i - 65) * 2)));
  series[70]!.low = 100;
  series[77]!.low = 90;
  const c = defaultTechnicalCondition('divergence');
  expect(evaluateTechnicalCondition(c, series).matched).toBe(true);
  expect(evaluateTechnicalCondition(c, series.slice(0, -1)).matched).toBe(false);
  expect(
    evaluateTechnicalCondition(c, [...series, ...bars([170]).map((b) => ({ ...b, time: 80 * 60_000 }))])
      .matched,
  ).toBe(false);
});
it('rejects insufficient or corrupt history and unsupported numeric configurations', () => {
  expect(() => evaluateTechnicalCondition(defaultTechnicalCondition(), bars([100, 101, 102]))).toThrow(
    'Insufficient',
  );
  expect(() =>
    evaluateTechnicalCondition(defaultTechnicalCondition(), [{ ...wave[0]!, close: NaN }, ...wave.slice(1)]),
  ).toThrow('Invalid');
  for (const extra of [
    { signal: 'eval' },
    { timeframe: '1s' },
    { indicator: '__proto__' },
    { params: { period: '14', threshold: 70 } },
    { params: { period: 1, threshold: 70 } },
    { params: { period: 14, threshold: Infinity } },
    { params: { period: 14, threshold: 70, script: 1 } },
  ])
    expect(() => validateTechnicalCondition({ ...defaultTechnicalCondition(), ...extra })).toThrow();
  expect(() =>
    validateTechnicalCondition({
      ...defaultTechnicalCondition('ema_cross'),
      params: { period: 50, slowPeriod: 20 },
    }),
  ).toThrow('Fast length');
  expect(() =>
    validateTechnicalCondition({
      ...defaultTechnicalCondition('stoch_rsi'),
      params: { period: 100, slowPeriod: 100, smoothing: 100, signalPeriod: 100, threshold: 80 },
    }),
  ).toThrow('history limit');
});
