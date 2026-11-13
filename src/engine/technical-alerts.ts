import type { Candle } from '../types.ts';
import {
  indicatorDefinition,
  technicalConditionLabel,
  type TechnicalCondition,
} from '../lib/advanced-alert.ts';

type Series = (number | null)[];
const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
export function movingAverage(values: Series, period: number, method: 'sma' | 'ema' | 'rma' = 'sma'): Series {
  const out: Series = Array(values.length).fill(null);
  let prior: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (!finite(values[i])) {
      prior = null;
      continue;
    }
    const window = values.slice(i - period + 1, i + 1);
    if (i < period - 1 || window.length !== period || !window.every(finite)) continue;
    const average = window.reduce<number>((sum, v) => sum + v!, 0) / period;
    const alpha = method === 'rma' ? 1 / period : 2 / (period + 1);
    prior = method === 'sma' || prior === null ? average : prior + alpha * (values[i]! - prior);
    out[i] = prior;
  }
  return out;
}
export function relativeStrengthIndex(closes: number[], period: number): Series {
  const changes = closes.map((c, i) => (i ? c - closes[i - 1]! : null));
  const gains = movingAverage(
    changes.map((c) => (c === null ? null : Math.max(0, c))),
    period,
    'rma',
  );
  const losses = movingAverage(
    changes.map((c) => (c === null ? null : Math.max(0, -c))),
    period,
    'rma',
  );
  return gains.map((gain, i) =>
    !finite(gain) || !finite(losses[i])
      ? null
      : gain + losses[i]! === 0
        ? 50
        : losses[i] === 0
          ? 100
          : 100 - 100 / (1 + gain / losses[i]!),
  );
}
export function averageTrueRange(bars: Candle[], period: number): Series {
  return movingAverage(
    bars.map((b, i) =>
      i
        ? Math.max(
            b.high - b.low,
            Math.abs(b.high - bars[i - 1]!.close),
            Math.abs(b.low - bars[i - 1]!.close),
          )
        : null,
    ),
    period,
    'rma',
  );
}
function rolling(values: Series, period: number, operation: 'high' | 'low' | 'sum'): Series {
  return values.map((_, i) => {
    const window = values.slice(i - period + 1, i + 1);
    if (i < period - 1 || window.length !== period || !window.every(finite)) return null;
    return operation === 'high'
      ? Math.max(...(window as number[]))
      : operation === 'low'
        ? Math.min(...(window as number[]))
        : (window as number[]).reduce((s, n) => s + n, 0);
  });
}
const mapSeries = (a: Series, b: Series, work: (a: number, b: number) => number): Series =>
  a.map((v, i) => (finite(v) && finite(b[i]) ? work(v, b[i]!) : null));
function compare(a: Series, b: Series | number, signal: string): boolean {
  const i = a.length - 1;
  const current = a[i],
    previous = a[i - 1];
  const target = typeof b === 'number' ? b : b[i],
    priorTarget = typeof b === 'number' ? b : b[i - 1];
  if (![current, previous, target, priorTarget].every(finite)) throw Error('Insufficient indicator history');
  if (signal === 'above') return current! > target!;
  if (signal === 'below') return current! < target!;
  if (signal === 'cross_up') return previous! <= priorTarget! && current! > target!;
  if (signal === 'cross_down') return previous! >= priorTarget! && current! < target!;
  throw Error('Unsupported technical comparison');
}
function channelSignal(close: Series, upper: Series, lower: Series, signal: string) {
  return compare(
    close,
    signal.startsWith('upper') ? upper : lower,
    signal === 'upper_break' || signal === 'lower_return' ? 'cross_up' : 'cross_down',
  );
}
function stoch(values: Series, period: number, highs = values, lows = values): Series {
  const high = rolling(highs, period, 'high'),
    low = rolling(lows, period, 'low');
  return values.map((v, i) =>
    !finite(v) || !finite(high[i]) || !finite(low[i])
      ? null
      : high[i] === low[i]
        ? 50
        : (100 * (v - low[i]!)) / (high[i]! - low[i]!),
  );
}
function supertrend(bars: Candle[], period: number, multiplier: number): Series {
  const atr = averageTrueRange(bars, period),
    out: Series = Array(bars.length).fill(null);
  let upper = NaN,
    lower = NaN,
    bullish = false;
  for (let i = 0; i < bars.length; i++) {
    if (!finite(atr[i])) continue;
    const bar = bars[i]!,
      center = (bar.high + bar.low) / 2,
      previous = bars[i - 1]?.close ?? bar.close;
    const nextUpper = center + multiplier * atr[i]!,
      nextLower = center - multiplier * atr[i]!;
    upper = !Number.isFinite(upper) || nextUpper < upper || previous > upper ? nextUpper : upper;
    lower = !Number.isFinite(lower) || nextLower > lower || previous < lower ? nextLower : lower;
    if (bullish && bar.close < lower) bullish = false;
    else if (!bullish && bar.close > upper) bullish = true;
    out[i] = bullish ? lower : upper;
  }
  return out;
}
function parabolicSar(bars: Candle[], step: number, maximum: number): Series {
  const out: Series = Array(bars.length).fill(null);
  let up = bars[1]!.close >= bars[0]!.close,
    extreme = up ? bars[0]!.high : bars[0]!.low;
  let sar = up ? bars[0]!.low : bars[0]!.high,
    acceleration = step;
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i]!,
      previous = bars[i - 1]!,
      before = bars[Math.max(0, i - 2)]!;
    sar += acceleration * (extreme - sar);
    sar = up ? Math.min(sar, previous.low, before.low) : Math.max(sar, previous.high, before.high);
    if ((up && bar.low < sar) || (!up && bar.high > sar)) {
      up = !up;
      sar = extreme;
      extreme = up ? bar.high : bar.low;
      acceleration = step;
    } else if ((up && bar.high > extreme) || (!up && bar.low < extreme)) {
      extreme = up ? bar.high : bar.low;
      acceleration = Math.min(maximum, acceleration + step);
    }
    out[i] = sar;
  }
  return out;
}
function candlePattern(bars: Candle[], signal: string) {
  const b = bars.at(-1)!,
    a = bars.at(-2)!,
    body = Math.abs(b.close - b.open),
    range = b.high - b.low;
  const upper = b.high - Math.max(b.open, b.close),
    lower = Math.min(b.open, b.close) - b.low;
  if (signal === 'doji') return range > 0 && body <= range * 0.1;
  if (signal === 'bullish_engulfing')
    return a.close < a.open && b.close > b.open && b.open <= a.close && b.close >= a.open;
  if (signal === 'bearish_engulfing')
    return a.close > a.open && b.close < b.open && b.open >= a.close && b.close <= a.open;
  if (signal === 'hammer') return body > range * 0.05 && lower >= 2 * body && upper <= body;
  if (signal === 'shooting_star') return body > range * 0.05 && upper >= 2 * body && lower <= body;
  if (signal === 'bullish_harami')
    return a.close < a.open && b.close > b.open && b.open > a.close && b.close < a.open;
  if (signal === 'bearish_harami')
    return a.close > a.open && b.close < b.open && b.open < a.close && b.close > a.open;
  throw Error('Unsupported candle pattern');
}
function divergence(bars: Candle[], period: number, signal: string) {
  const rsi = relativeStrengthIndex(
      bars.map((b) => b.close),
      period,
    ),
    bullish = signal.endsWith('bullish');
  const prices = bars.map((b) => (bullish ? b.low : b.high)),
    pivots: number[] = [];
  for (let i = Math.max(2, prices.length - 80); i <= prices.length - 3; i++) {
    if (!finite(rsi[i])) continue;
    const neighbors = [prices[i - 2]!, prices[i - 1]!, prices[i + 1]!, prices[i + 2]!];
    if (neighbors.every((p) => (bullish ? prices[i]! < p : prices[i]! > p))) pivots.push(i);
  }
  const recent = pivots.at(-1),
    previous = pivots.at(-2);
  if (recent !== bars.length - 3 || previous === undefined) return false;
  const lowerPrice = prices[recent]! < prices[previous]!,
    higherRsi = rsi[recent]! > rsi[previous]!;
  if (signal === 'regular_bullish') return lowerPrice && higherRsi;
  if (signal === 'regular_bearish')
    return prices[recent]! > prices[previous]! && rsi[recent]! < rsi[previous]!;
  if (signal === 'hidden_bullish')
    return prices[recent]! > prices[previous]! && rsi[recent]! < rsi[previous]!;
  return lowerPrice && higherRsi;
}
export type TechnicalResult = { matched: boolean; event: boolean; barTime: number; detail: string };
/** All inputs are completed, contiguous candles supplied by the validated market connector. */
export function evaluateTechnicalCondition(condition: TechnicalCondition, bars: Candle[]): TechnicalResult {
  if (
    bars.length < 3 ||
    bars.some((b) => ![b.open, b.high, b.low, b.close, b.volumeBase, b.time].every(Number.isFinite))
  )
    throw Error('Invalid indicator history');
  const close = bars.map((b) => b.close),
    highs = bars.map((b) => b.high),
    lows = bars.map((b) => b.low);
  const { indicator, signal, params } = condition;
  const p = params.period ?? 14,
    slow = params.slowPeriod ?? 26,
    smooth = params.smoothing ?? 3;
  const sig = params.signalPeriod ?? 9,
    level = params.threshold ?? 0,
    mult = params.multiplier ?? 2;
  const i = bars.length - 1;
  let matched: boolean;
  if (indicator === 'rsi') matched = compare(relativeStrengthIndex(close, p), level, signal);
  else if (indicator === 'ema_cross' || indicator === 'sma_cross') {
    const method = indicator.startsWith('ema') ? 'ema' : 'sma';
    matched = compare(movingAverage(close, p, method), movingAverage(close, slow, method), signal);
  } else if (indicator === 'ema_price' || indicator === 'sma_price')
    matched = compare(close, movingAverage(close, p, indicator.startsWith('ema') ? 'ema' : 'sma'), signal);
  else if (indicator === 'macd' || indicator === 'macd_zero') {
    const line = mapSeries(
      movingAverage(close, p, 'ema'),
      movingAverage(close, slow, 'ema'),
      (a, b) => a - b,
    );
    matched = compare(line, indicator === 'macd_zero' ? 0 : movingAverage(line, sig, 'ema'), signal);
  } else if (indicator === 'stochastic' || indicator === 'stoch_rsi') {
    const raw =
      indicator === 'stochastic'
        ? stoch(close, p, highs, lows)
        : stoch(relativeStrengthIndex(close, p), slow);
    const k = movingAverage(raw, smooth),
      d = movingAverage(k, sig);
    matched = compare(k, signal.endsWith('_signal') ? d : level, signal.replace('_signal', ''));
  } else if (indicator === 'bollinger' || indicator === 'bb_squeeze') {
    const mean = movingAverage(close, p),
      deviation = close.map((_, index) =>
        index < p - 1
          ? null
          : Math.sqrt(
              close.slice(index - p + 1, index + 1).reduce((s, v) => s + (v - mean[index]!) ** 2, 0) / p,
            ),
      );
    const upper = mapSeries(mean, deviation, (a, b) => a + mult * b),
      lower = mapSeries(mean, deviation, (a, b) => a - mult * b);
    matched =
      indicator === 'bollinger'
        ? channelSignal(close, upper, lower, signal)
        : compare(
            mapSeries(
              mapSeries(upper, lower, (a, b) => a - b),
              mean,
              (a, b) => (a / b) * 100,
            ),
            level,
            signal,
          );
  } else if (indicator === 'keltner') {
    const mean = movingAverage(close, p, 'ema'),
      atr = averageTrueRange(bars, slow);
    matched = channelSignal(
      close,
      mapSeries(mean, atr, (a, b) => a + mult * b),
      mapSeries(mean, atr, (a, b) => a - mult * b),
      signal,
    );
  } else if (indicator === 'supertrend') matched = compare(close, supertrend(bars, p, mult), signal);
  else if (indicator === 'psar') matched = compare(close, parabolicSar(bars, mult, level), signal);
  else if (indicator === 'ichimoku') {
    const midpoint = (length: number) =>
      mapSeries(rolling(highs, length, 'high'), rolling(lows, length, 'low'), (a, b) => (a + b) / 2);
    const conversion = midpoint(p),
      base = midpoint(slow);
    if (signal.startsWith('cloud')) {
      const a = mapSeries(conversion, base, (x, y) => (x + y) / 2),
        b = midpoint(sig);
      const upper = a.map((_, n) =>
        n >= slow && finite(a[n - slow]) && finite(b[n - slow]) ? Math.max(a[n - slow]!, b[n - slow]!) : null,
      );
      const lower = a.map((_, n) =>
        n >= slow && finite(a[n - slow]) && finite(b[n - slow]) ? Math.min(a[n - slow]!, b[n - slow]!) : null,
      );
      matched = channelSignal(close, upper, lower, signal === 'cloud_up' ? 'upper_break' : 'lower_break');
    } else matched = compare(conversion, base, signal);
  } else if (indicator === 'dmi') {
    const atr = averageTrueRange(bars, p);
    const movement = (positive: boolean) =>
      movingAverage(
        bars.map((b, n) => {
          if (!n) return null;
          const up = b.high - bars[n - 1]!.high,
            down = bars[n - 1]!.low - b.low;
          return positive ? (up > down && up > 0 ? up : 0) : down > up && down > 0 ? down : 0;
        }),
        p,
        'rma',
      );
    const plus = mapSeries(movement(true), atr, (a, b) => (b ? (a / b) * 100 : 0)),
      minus = mapSeries(movement(false), atr, (a, b) => (b ? (a / b) * 100 : 0));
    const adx = movingAverage(
      mapSeries(plus, minus, (a, b) => (a + b ? (100 * Math.abs(a - b)) / (a + b) : 0)),
      sig,
      'rma',
    );
    matched = signal.startsWith('adx')
      ? compare(adx, level, signal === 'adx_above' ? 'above' : 'below')
      : compare(plus, minus, signal);
  } else if (indicator === 'atr')
    matched = compare(
      mapSeries(averageTrueRange(bars, p), close, (a, b) => (a / b) * 100),
      level,
      signal,
    );
  else if (indicator === 'price_delta')
    matched = compare(
      close.map((v, n) => (n >= p ? (v / close[n - p]! - 1) * 100 : null)),
      level,
      signal,
    );
  else if (indicator === 'volume_change') {
    const mean = movingAverage(
      bars.map((b) => b.volumeBase),
      p,
    );
    matched = compare(
      bars.map((b, n) => (n > p && mean[n - 1]! > 0 ? (b.volumeBase / mean[n - 1]! - 1) * 100 : null)),
      level,
      signal,
    );
  } else if (indicator === 'cci') {
    const typical = bars.map((b) => (b.high + b.low + b.close) / 3),
      mean = movingAverage(typical, p);
    const cci = typical.map((v, n) => {
      if (!finite(mean[n])) return null;
      const deviation = typical.slice(n - p + 1, n + 1).reduce((s, x) => s + Math.abs(x - mean[n]!), 0) / p;
      return deviation === 0 ? 0 : (v - mean[n]!) / (0.015 * deviation);
    });
    matched = compare(cci, level, signal);
  } else if (indicator === 'cmf') {
    const flow = rolling(
      bars.map((b) =>
        b.high === b.low ? 0 : ((b.close - b.low - (b.high - b.close)) / (b.high - b.low)) * b.volumeBase,
      ),
      p,
      'sum',
    );
    matched = compare(
      mapSeries(
        flow,
        rolling(
          bars.map((b) => b.volumeBase),
          p,
          'sum',
        ),
        (a, b) => (b ? a / b : 0),
      ),
      level,
      signal,
    );
  } else if (indicator === 'cmo') {
    const changes = close.map((v, n) => (n ? v - close[n - 1]! : null));
    const up = rolling(
        changes.map((v) => (v === null ? null : Math.max(v, 0))),
        p,
        'sum',
      ),
      down = rolling(
        changes.map((v) => (v === null ? null : Math.max(-v, 0))),
        p,
        'sum',
      );
    matched = compare(
      mapSeries(up, down, (a, b) => (a + b ? (100 * (a - b)) / (a + b) : 0)),
      level,
      signal,
    );
  } else if (indicator === 'mfi') {
    const typical = bars.map((b) => (b.high + b.low + b.close) / 3);
    const flow = (up: boolean) =>
      rolling(
        typical.map((v, n) =>
          !n ? null : (up ? v > typical[n - 1]! : v < typical[n - 1]!) ? v * bars[n]!.volumeBase : 0,
        ),
        p,
        'sum',
      );
    matched = compare(
      mapSeries(flow(true), flow(false), (a, b) =>
        a + b === 0 ? 50 : b === 0 ? 100 : 100 - 100 / (1 + a / b),
      ),
      level,
      signal,
    );
  } else if (indicator === 'williams')
    matched = compare(
      stoch(close, p, highs, lows).map((v) => (v === null ? null : v - 100)),
      level,
      signal,
    );
  else if (['donchian', 'support_resistance', 'fibonacci'].includes(indicator)) {
    const high = rolling(highs, p, 'high').map((_, n, all) => all[n - 1] ?? null),
      low = rolling(lows, p, 'low').map((_, n, all) => all[n - 1] ?? null);
    if (indicator === 'fibonacci')
      matched = compare(
        close,
        mapSeries(high, low, (a, b) => a - ((a - b) * level) / 100),
        signal,
      );
    else if (signal.startsWith('near')) {
      const reference = signal === 'near_support' ? low : high;
      matched = compare(
        mapSeries(close, reference, (a, b) => Math.abs(a / b - 1) * 100),
        level,
        'below',
      );
    } else matched = channelSignal(close, high, low, signal);
  } else if (indicator === 'candlestick') matched = candlePattern(bars, signal);
  else if (indicator === 'inside_bar') {
    const mother = bars[i - 2]!,
      inside = bars[i - 1]!,
      bar = bars[i]!;
    matched =
      inside.high < mother.high &&
      inside.low > mother.low &&
      (signal === 'cross_up' ? bar.close > mother.high : bar.close < mother.low);
  } else if (indicator === 'color_change') {
    const a = bars[i - 1]!,
      b = bars[i]!;
    matched =
      signal === 'cross_up' ? a.close < a.open && b.close > b.open : a.close > a.open && b.close < b.open;
  } else if (indicator === 'td_setup') {
    let count = 0;
    for (let n = 4; n < bars.length; n++)
      count = (signal === 'bullish' ? close[n]! < close[n - 4]! : close[n]! > close[n - 4]!) ? count + 1 : 0;
    matched = count === 9;
  } else if (indicator === 'divergence') matched = divergence(bars, p, signal);
  else throw Error('Unsupported advanced indicator');
  const definition = indicatorDefinition(indicator),
    bar = bars.at(-1)!;
  return {
    matched,
    event: definition.signals.find((s) => s.id === signal)?.event === true,
    barTime: bar.closeTime ?? bar.time,
    detail: technicalConditionLabel(condition),
  };
}
