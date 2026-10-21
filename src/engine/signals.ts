import type { Candle, EntrySignal, SignalModel } from '../types.ts';
import { atr, mean } from './stats.ts';
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1),
    out: number[] = [];
  let v = values[0] ?? 0;
  for (const x of values) {
    v = k * x + (1 - k) * v;
    out.push(v);
  }
  return out;
}
/** All patterns inspect completed bars only. Suggested entry triggers are not executable fills. */
export function detectSignals(
  bars: Candle[],
  models: SignalModel[] = ['sfp', 'msb', 'pullback', 'range'],
): EntrySignal[] {
  if (bars.length < 65) return [];
  const c = bars.at(-1)!;
  const prev = bars.slice(-21, -1);
  const prevHigh = Math.max(...prev.map((x) => x.high)),
    prevLow = Math.min(...prev.map((x) => x.low));
  const vola = atr(bars);
  if (!Number.isFinite(vola) || vola <= 0) return [];
  const closes = bars.map((x) => x.close),
    e20 = ema(closes, 20),
    e50 = ema(closes, 50),
    last20 = e20.at(-1)!,
    last50 = e50.at(-1)!,
    prior20 = e20.at(-5)!;
  const signals: EntrySignal[] = [];
  function append(
    model: SignalModel,
    direction: 'long' | 'short',
    label: string,
    detail: string,
    stop: number,
    entry = c.close,
  ) {
    const risk = Math.abs(entry - stop);
    if (risk <= 0 || risk < vola * 0.1 || risk > vola * 5) return;
    const target = direction === 'long' ? entry + 2 * risk : entry - 2 * risk;
    if (target <= 0) return;
    signals.push({
      model,
      direction,
      label,
      detail,
      trigger: entry,
      stop,
      target,
      rr: 2,
      barTime: c.time,
      barCloseTime: c.closeTime,
      status: 'candidate',
    });
  }
  if (models.includes('sfp')) {
    if (c.low < prevLow && c.close > prevLow && c.close > c.open)
      append(
        'sfp',
        'long',
        'Bullish SFP',
        'Swept prior 20-bar low and closed back above it.',
        c.low - vola * 0.15,
      );
    if (c.high > prevHigh && c.close < prevHigh && c.close < c.open)
      append(
        'sfp',
        'short',
        'Bearish SFP',
        'Swept prior 20-bar high and closed back below it.',
        c.high + vola * 0.15,
      );
  }
  if (models.includes('msb')) {
    // A swing is confirmed only after two candles on its right; no future pivot leak.
    let swingHigh: number | undefined, swingLow: number | undefined;
    for (let j = 2; j < bars.length - 3; j++) {
      const point = bars[j];
      if (!point) continue;
      const left = bars.slice(j - 2, j),
        right = bars.slice(j + 1, j + 3);
      if (right.length < 2) continue;
      if (left.every((x) => point.high > x.high) && right.every((x) => point.high > x.high))
        swingHigh = point.high;
      if (left.every((x) => point.low < x.low) && right.every((x) => point.low < x.low)) swingLow = point.low;
    }
    const before = bars.at(-2)!;
    if (swingHigh && before.close <= swingHigh && c.close > swingHigh)
      append(
        'msb',
        'long',
        'Bullish structure break',
        'Closed above last confirmed swing high.',
        Math.min(before.low, c.low) - vola * 0.2,
      );
    if (swingLow && before.close >= swingLow && c.close < swingLow)
      append(
        'msb',
        'short',
        'Bearish structure break',
        'Closed below last confirmed swing low.',
        Math.max(before.high, c.high) + vola * 0.2,
      );
  }
  if (models.includes('pullback')) {
    if (
      last20 > last50 &&
      last20 > prior20 &&
      c.low < last20 + 0.2 * vola &&
      c.close > last20 &&
      c.close > c.open
    )
      append(
        'pullback',
        'long',
        'Bullish continuation',
        'Rising EMA20 above EMA50; pullback recovered EMA20.',
        Math.min(...bars.slice(-5).map((x) => x.low)) - vola * 0.2,
      );
    if (
      last20 < last50 &&
      last20 < prior20 &&
      c.high > last20 - 0.2 * vola &&
      c.close < last20 &&
      c.close < c.open
    )
      append(
        'pullback',
        'short',
        'Bearish continuation',
        'Falling EMA20 below EMA50; pullback rejected EMA20.',
        Math.max(...bars.slice(-5).map((x) => x.high)) + vola * 0.2,
      );
  }
  if (models.includes('range')) {
    const width = prevHigh - prevLow,
      move = Math.abs(last20 - (e20.at(-11) ?? last20));
    const priorAtr = mean(bars.slice(-21, -1).map((b) => b.high - b.low));
    // Require bounded 20-bar range, muted trend slope, and a rejection at an edge.
    if (width < 7 * vola && move < 1.5 * vola && priorAtr < 2 * vola) {
      if (c.low <= prevLow + 0.25 * vola && c.close > prevLow + 0.4 * vola && c.close > c.open)
        append(
          'range',
          'long',
          'Range support rejection',
          'Sideways 20-bar range; defended lower boundary.',
          c.low - 0.2 * vola,
        );
      if (c.high >= prevHigh - 0.25 * vola && c.close < prevHigh - 0.4 * vola && c.close < c.open)
        append(
          'range',
          'short',
          'Range resistance rejection',
          'Sideways 20-bar range; rejected upper boundary.',
          c.high + 0.2 * vola,
        );
    }
  }
  return signals;
}
