import type { Venue } from '../types.ts';

export const ADVANCED_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
export type AdvancedTimeframe = (typeof ADVANCED_TIMEFRAMES)[number];
export const ALERT_COOLDOWNS = [1, 5, 15, 30, 60, 240, 1440] as const;
export const MAX_ALERT_MARKETS = 20;
export const MAX_ALERT_CONDITIONS = 5;
export type IndicatorId =
  | 'rsi'
  | 'stochastic'
  | 'stoch_rsi'
  | 'macd'
  | 'macd_zero'
  | 'ema_cross'
  | 'sma_cross'
  | 'ema_price'
  | 'sma_price'
  | 'bollinger'
  | 'bb_squeeze'
  | 'keltner'
  | 'supertrend'
  | 'psar'
  | 'ichimoku'
  | 'dmi'
  | 'cci'
  | 'cmf'
  | 'cmo'
  | 'mfi'
  | 'williams'
  | 'atr'
  | 'price_delta'
  | 'volume_change'
  | 'donchian'
  | 'support_resistance'
  | 'fibonacci'
  | 'candlestick'
  | 'inside_bar'
  | 'color_change'
  | 'td_setup'
  | 'divergence';
export type TechnicalCondition = {
  indicator: IndicatorId;
  signal: string;
  timeframe: AdvancedTimeframe;
  params: Record<string, number>;
};
export type TechnicalObservation = {
  key: string;
  matched: boolean;
  evaluatedAt: number;
  lastEventKey?: string;
  lastTriggeredAt?: number;
  error?: string;
};
type Parameter = { key: string; label: string; value: number; min: number; max: number; step?: number };
export type IndicatorDefinition = {
  id: IndicatorId;
  label: string;
  group: 'Momentum' | 'Trend' | 'Volatility' | 'Price action' | 'Volume';
  params: Parameter[];
  signals: { id: string; label: string; event?: boolean }[];
};
const period = (value = 14, key = 'period', label = 'Length'): Parameter => ({
  key,
  label,
  value,
  min: 2,
  max: 100,
});
const threshold = (value: number, min = -100, max = 100): Parameter => ({
  key: 'threshold',
  label: 'Level',
  value,
  min,
  max,
  step: 0.1,
});
const multiplier = (value = 2): Parameter => ({
  key: 'multiplier',
  label: 'Multiplier',
  value,
  min: 0.1,
  max: 10,
  step: 0.1,
});
const comparisons = [
  { id: 'above', label: 'Above level' },
  { id: 'below', label: 'Below level' },
  { id: 'cross_up', label: 'Crosses above level', event: true },
  { id: 'cross_down', label: 'Crosses below level', event: true },
];
const crosses = [
  { id: 'cross_up', label: 'Bullish crossover', event: true },
  { id: 'cross_down', label: 'Bearish crossover', event: true },
  { id: 'above', label: 'Bullish alignment' },
  { id: 'below', label: 'Bearish alignment' },
];
const channels = [
  { id: 'upper_break', label: 'Breaks above upper band', event: true },
  { id: 'lower_break', label: 'Breaks below lower band', event: true },
  { id: 'upper_return', label: 'Returns below upper band', event: true },
  { id: 'lower_return', label: 'Returns above lower band', event: true },
];
export const ADVANCED_INDICATORS: readonly IndicatorDefinition[] = [
  {
    id: 'rsi',
    label: 'RSI',
    group: 'Momentum',
    params: [period(), threshold(70, 0, 100)],
    signals: comparisons,
  },
  {
    id: 'stochastic',
    label: 'Stochastic',
    group: 'Momentum',
    params: [
      period(),
      period(3, 'smoothing', 'K smoothing'),
      period(3, 'signalPeriod', 'D length'),
      threshold(80, 0, 100),
    ],
    signals: [
      ...comparisons,
      ...crosses
        .slice(0, 2)
        .map((s) => ({
          ...s,
          id: s.id + '_signal',
          label: s.id === 'cross_up' ? 'K crosses above D' : 'K crosses below D',
        })),
    ],
  },
  {
    id: 'stoch_rsi',
    label: 'Stochastic RSI',
    group: 'Momentum',
    params: [
      period(),
      period(14, 'slowPeriod', 'Stochastic length'),
      period(3, 'smoothing', 'K smoothing'),
      period(3, 'signalPeriod', 'D length'),
      threshold(80, 0, 100),
    ],
    signals: [
      ...comparisons,
      ...crosses
        .slice(0, 2)
        .map((s) => ({
          ...s,
          id: s.id + '_signal',
          label: s.id === 'cross_up' ? 'K crosses above D' : 'K crosses below D',
        })),
    ],
  },
  {
    id: 'macd',
    label: 'MACD · signal line',
    group: 'Momentum',
    params: [
      period(12, 'period', 'Fast length'),
      period(26, 'slowPeriod', 'Slow length'),
      period(9, 'signalPeriod', 'Signal length'),
    ],
    signals: crosses,
  },
  {
    id: 'macd_zero',
    label: 'MACD · zero line',
    group: 'Momentum',
    params: [period(12, 'period', 'Fast length'), period(26, 'slowPeriod', 'Slow length')],
    signals: crosses,
  },
  ...(['ema', 'sma'] as const).flatMap((method) => [
    {
      id: `${method}_cross` as IndicatorId,
      label: `${method.toUpperCase()} crossover`,
      group: 'Trend' as const,
      params: [period(20, 'period', 'Fast length'), period(50, 'slowPeriod', 'Slow length')],
      signals: crosses,
    },
    {
      id: `${method}_price` as IndicatorId,
      label: `Price vs ${method.toUpperCase()}`,
      group: 'Trend' as const,
      params: [period(20)],
      signals: crosses,
    },
  ]),
  {
    id: 'bollinger',
    label: 'Bollinger Bands',
    group: 'Volatility',
    params: [period(20), multiplier()],
    signals: channels,
  },
  {
    id: 'bb_squeeze',
    label: 'Bollinger squeeze',
    group: 'Volatility',
    params: [period(20), multiplier(), { ...threshold(2, 0.01, 100), label: 'Bandwidth (%)' }],
    signals: [
      { id: 'below', label: 'Squeeze starts' },
      { id: 'cross_up', label: 'Squeeze releases', event: true },
    ],
  },
  {
    id: 'keltner',
    label: 'Keltner Channel',
    group: 'Volatility',
    params: [period(20), period(10, 'slowPeriod', 'ATR length'), multiplier()],
    signals: channels,
  },
  {
    id: 'supertrend',
    label: 'Supertrend',
    group: 'Trend',
    params: [period(10), multiplier(3)],
    signals: crosses.slice(0, 2),
  },
  {
    id: 'psar',
    label: 'Parabolic SAR',
    group: 'Trend',
    params: [
      { key: 'multiplier', label: 'Acceleration', value: 0.02, min: 0.001, max: 0.2, step: 0.001 },
      { ...threshold(0.2, 0.01, 1), label: 'Maximum acceleration', step: 0.01 },
    ],
    signals: crosses.slice(0, 2),
  },
  {
    id: 'ichimoku',
    label: 'Ichimoku Cloud',
    group: 'Trend',
    params: [
      period(9, 'period', 'Conversion length'),
      period(26, 'slowPeriod', 'Base / displacement'),
      period(52, 'signalPeriod', 'Span B length'),
    ],
    signals: [
      ...crosses.slice(0, 2),
      { id: 'cloud_up', label: 'Price breaks above cloud', event: true },
      { id: 'cloud_down', label: 'Price breaks below cloud', event: true },
    ],
  },
  {
    id: 'dmi',
    label: 'DMI / ADX',
    group: 'Trend',
    params: [period(), period(14, 'signalPeriod', 'ADX smoothing'), threshold(25, 0, 100)],
    signals: [
      ...crosses.slice(0, 2),
      { id: 'adx_above', label: 'ADX above level' },
      { id: 'adx_below', label: 'ADX below level' },
    ],
  },
  {
    id: 'cci',
    label: 'CCI',
    group: 'Momentum',
    params: [period(20), threshold(100, -1000, 1000)],
    signals: comparisons,
  },
  {
    id: 'cmf',
    label: 'Chaikin Money Flow',
    group: 'Volume',
    params: [period(20), threshold(0, -1, 1)],
    signals: comparisons,
  },
  {
    id: 'cmo',
    label: 'Chande Momentum',
    group: 'Momentum',
    params: [period(), threshold(50)],
    signals: comparisons,
  },
  {
    id: 'mfi',
    label: 'Money Flow Index',
    group: 'Volume',
    params: [period(), threshold(80, 0, 100)],
    signals: comparisons,
  },
  {
    id: 'williams',
    label: 'Williams %R',
    group: 'Momentum',
    params: [period(), threshold(-20, -100, 0)],
    signals: comparisons,
  },
  {
    id: 'atr',
    label: 'ATR (%)',
    group: 'Volatility',
    params: [period(), { ...threshold(2, 0, 100), label: 'ATR / close (%)' }],
    signals: comparisons,
  },
  {
    id: 'price_delta',
    label: 'Price change (%)',
    group: 'Price action',
    params: [
      { ...period(1), min: 1 },
      { ...threshold(3, -100, 100000), label: 'Change (%)' },
    ],
    signals: comparisons,
  },
  {
    id: 'volume_change',
    label: 'Volume change',
    group: 'Volume',
    params: [period(20), { ...threshold(100, 0, 100000), label: 'Above average (%)' }],
    signals: comparisons,
  },
  {
    id: 'donchian',
    label: 'High / low breakout',
    group: 'Price action',
    params: [period(20)],
    signals: channels.slice(0, 2),
  },
  {
    id: 'support_resistance',
    label: 'Support / resistance',
    group: 'Price action',
    params: [period(50), { ...threshold(1, 0.01, 20), label: 'Nearby range (%)' }],
    signals: [
      { id: 'near_support', label: 'Near support' },
      { id: 'near_resistance', label: 'Near resistance' },
      ...channels.slice(0, 2),
    ],
  },
  {
    id: 'fibonacci',
    label: 'Fibonacci retracement',
    group: 'Price action',
    params: [period(50), { ...threshold(61.8, 0, 100), label: 'Retracement (%)' }],
    signals: crosses.slice(0, 2),
  },
  {
    id: 'candlestick',
    label: 'Candlestick pattern',
    group: 'Price action',
    params: [],
    signals: [
      'Doji',
      'Bullish engulfing',
      'Bearish engulfing',
      'Hammer',
      'Shooting star',
      'Bullish harami',
      'Bearish harami',
    ].map((label) => ({ id: label.toLowerCase().replaceAll(' ', '_'), label, event: true })),
  },
  {
    id: 'inside_bar',
    label: 'Inside-bar breakout',
    group: 'Price action',
    params: [],
    signals: crosses.slice(0, 2),
  },
  {
    id: 'color_change',
    label: 'Candle color change',
    group: 'Price action',
    params: [],
    signals: crosses.slice(0, 2),
  },
  {
    id: 'td_setup',
    label: 'TD setup · 9 count',
    group: 'Price action',
    params: [],
    signals: [
      { id: 'bullish', label: 'Buy setup completes', event: true },
      { id: 'bearish', label: 'Sell setup completes', event: true },
    ],
  },
  {
    id: 'divergence',
    label: 'RSI divergence',
    group: 'Momentum',
    params: [period()],
    signals: ['Regular bullish', 'Regular bearish', 'Hidden bullish', 'Hidden bearish'].map((label) => ({
      id: label.toLowerCase().replaceAll(' ', '_'),
      label,
      event: true,
    })),
  },
];
export function indicatorDefinition(id: IndicatorId): IndicatorDefinition {
  const definition = ADVANCED_INDICATORS.find((x) => x.id === id);
  if (!definition) throw Error('Unsupported advanced indicator');
  return definition;
}
export function defaultTechnicalCondition(indicator: IndicatorId = 'rsi'): TechnicalCondition {
  const definition = indicatorDefinition(indicator);
  return {
    indicator,
    signal: definition.signals[0]!.id,
    timeframe: '1h',
    params: Object.fromEntries(definition.params.map((p) => [p.key, p.value])),
  };
}
export function validateTechnicalCondition(raw: unknown): TechnicalCondition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid advanced condition');
  const value = raw as Record<string, unknown>;
  const definition = indicatorDefinition(value.indicator as IndicatorId);
  if (!definition.signals.some((s) => s.id === value.signal)) throw Error('Unsupported indicator signal');
  if (!ADVANCED_TIMEFRAMES.includes(value.timeframe as AdvancedTimeframe))
    throw Error('Unsupported advanced timeframe');
  if (!value.params || typeof value.params !== 'object' || Array.isArray(value.params))
    throw Error('Invalid indicator parameters');
  const parameters = value.params as Record<string, unknown>;
  if (Object.keys(parameters).some((k) => !definition.params.some((p) => p.key === k)))
    throw Error('Unknown indicator parameter');
  const params: Record<string, number> = {};
  for (const parameter of definition.params) {
    const n = parameters[parameter.key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < parameter.min ||
      n > parameter.max ||
      (!parameter.step && !Number.isInteger(n))
    )
      throw Error(`Invalid ${definition.label} ${parameter.label.toLowerCase()}`);
    params[parameter.key] = n;
  }
  if (
    ['macd', 'macd_zero', 'ema_cross', 'sma_cross'].includes(definition.id) &&
    params.period! >= params.slowPeriod!
  )
    throw Error('Invalid lengths: Fast length must be less than slow length');
  if (definition.id === 'psar' && params.multiplier! > params.threshold!)
    throw Error('Invalid acceleration: must not exceed its maximum');
  const history =
    definition.id === 'stoch_rsi'
      ? params.period! + params.slowPeriod! + params.smoothing! + params.signalPeriod! + 3
      : definition.id === 'ichimoku'
        ? params.slowPeriod! + Math.max(params.period!, params.slowPeriod!, params.signalPeriod!) + 3
        : Math.max(params.period ?? 1, params.slowPeriod ?? 1) +
          (params.signalPeriod ?? 0) +
          (params.smoothing ?? 0) +
          3;
  if (history > 295) throw Error('Invalid combined lengths: exceed the 300-candle history limit');
  return {
    indicator: definition.id,
    signal: String(value.signal),
    timeframe: value.timeframe as AdvancedTimeframe,
    params,
  };
}
export function technicalConditionLabel(condition: TechnicalCondition): string {
  const definition = indicatorDefinition(condition.indicator);
  const signal = definition.signals.find((s) => s.id === condition.signal)?.label ?? condition.signal;
  return `${definition.label} · ${signal}${condition.params.threshold !== undefined ? ` ${condition.params.threshold}` : ''} · ${condition.timeframe}`;
}
export const marketVenueLabel = (venue: Venue) => (venue === 'binance' ? 'Binance' : 'Hyperliquid');
