import type { Candle, EntrySignal, SignalModel } from '../types.ts';
import { detectSignals } from './signals.ts';

/**
 * Research-only single-position simulator. Generates decisions from completed bar i
 * and fills no earlier than bar i+1 open. No exchange orders are placed.
 *
 * Intrabar stop and target collisions resolve to the stop (adverse-first).
 * Remaining positions close at the final available close and are labelled as such.
 */
export type ResearchCosts = {
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
};
export type ResearchConfig = {
  model: SignalModel;
  initialEquity: number;
  riskFraction: number;
  costs: ResearchCosts;
  holdoutFraction: number;
};
export type ResearchTrade = {
  signalTime: number;
  entryTime: number;
  exitTime: number;
  direction: 'long' | 'short';
  entry: number;
  exit: number;
  stop: number;
  target: number;
  size: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
  rMultiple: number;
  exitReason: 'stop' | 'target' | 'end_of_data';
  sample: 'development' | 'holdout';
};
export type ResearchResult = {
  hypothesis: string;
  config: ResearchConfig;
  bars: number;
  splitIndex: number;
  trades: ResearchTrade[];
  summary: {
    count: number;
    netPnl: number;
    expectancyR: number | null;
    maxDrawdownPct: number;
    winRate: number | null;
  };
  development: { count: number; netPnl: number; expectancyR: number | null };
  holdout: { count: number; netPnl: number; expectancyR: number | null };
  warnings: string[];
};

const finitePositive = (x: number) => Number.isFinite(x) && x > 0;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-10;

function validate(bars: Candle[], c: ResearchConfig) {
  if (bars.length < 67) throw Error('At least 67 completed candles required');
  if (!finitePositive(c.initialEquity) || !finitePositive(c.riskFraction) || c.riskFraction > 0.05)
    throw Error('Invalid initial equity or risk fraction (max 5%)');
  if (!Number.isFinite(c.holdoutFraction) || c.holdoutFraction < 0.1 || c.holdoutFraction > 0.5)
    throw Error('Holdout must cover between 10% and 50% of observations');
  if (![c.costs.feeBpsPerSide, c.costs.slippageBpsPerSide].every(
    (v) => Number.isFinite(v) && v >= 0 && v <= 100,
  )) throw Error('Invalid transaction costs');
  if (!['sfp', 'msb', 'pullback', 'range'].includes(c.model)) throw Error('Unsupported strategy');
  let previousClose = -1;
  for (const b of bars) {
    if (![b.time, b.closeTime, b.open, b.high, b.low, b.close].every(
      (v) => typeof v === 'number' && Number.isFinite(v),
    )) throw Error('Invalid or incomplete candle timestamp/OHLC');
    if (b.time <= previousClose || b.closeTime! < b.time ||
        ![b.open, b.high, b.low, b.close].every(finitePositive) ||
        b.low > Math.min(b.open, b.close) || b.high < Math.max(b.open, b.close))
      throw Error('Overlapping, unordered or invalid candles');
    previousClose = b.closeTime!;
  }
}

const stats = (trades: ResearchTrade[]) => ({
  count: trades.length,
  netPnl: trades.reduce((n, t) => n + t.netPnl, 0),
  expectancyR: trades.length ? trades.reduce((n, t) => n + t.rMultiple, 0) / trades.length : null,
});

export function backtest(
  bars: Candle[],
  config: ResearchConfig,
  signalAt: (history: Candle[], models: SignalModel[]) => EntrySignal[] = detectSignals,
): ResearchResult {
  validate(bars, config);
  const splitIndex = Math.floor(bars.length * (1 - config.holdoutFraction));
  const trades: ResearchTrade[] = [];
  let equity = config.initialEquity;
  let peak = equity;
  let maxDrawdownPct = 0;
  const cost = (config.costs.feeBpsPerSide + config.costs.slippageBpsPerSide) / 10_000;
  // Warm-up and decision bar are fully historical at the moment of execution.
  for (let i = 64; i < bars.length - 1; i++) {
    const decision = bars[i]!;
    const signal = signalAt(bars.slice(0, i + 1), [config.model])
      .find((s) => s.model === config.model && s.barTime === decision.time);
    if (!signal) continue;
    const next = bars[i + 1]!;
    const direction = signal.direction === 'long' ? 1 : -1;
    const entry = next.open * (1 + direction * config.costs.slippageBpsPerSide / 10_000);
    const stop = signal.stop;
    if (!finitePositive(entry) || !finitePositive(stop) ||
      direction * (entry - stop) <= 0 || direction * (signal.target - entry) <= 0) continue;
    const riskPerUnit = Math.abs(entry - stop);
    // Include round-trip fees in the budget to avoid sizing beyond the specified risk.
    const size = (equity * config.riskFraction) / (riskPerUnit + 2 * entry * cost);
    if (!finitePositive(size)) continue;
    let exit = NaN, exitIndex = -1;
    let exitReason: ResearchTrade['exitReason'] = 'end_of_data';
    for (let j = i + 1; j < bars.length; j++) {
      const b = bars[j]!;
      // Gaps through the stop exit at the worse opening price.
      if (direction === 1 && b.open <= stop || direction === -1 && b.open >= stop) {
        exit = b.open; exitIndex = j; exitReason = 'stop'; break;
      }
      if (direction === 1 && b.low <= stop || direction === -1 && b.high >= stop) {
        exit = stop; exitIndex = j; exitReason = 'stop'; break;
      }
      if (direction === 1 && b.high >= signal.target || direction === -1 && b.low <= signal.target) {
        // Favor no price improvement from favorable gaps.
        exit = signal.target; exitIndex = j; exitReason = 'target'; break;
      }
    }
    if (exitIndex < 0) { exitIndex = bars.length - 1; exit = bars[exitIndex]!.close; }
    const exitFill = exit * (1 - direction * config.costs.slippageBpsPerSide / 10_000);
    const grossPnl = direction * (exitFill - entry) * size;
    const fees = (entry + exitFill) * size * config.costs.feeBpsPerSide / 10_000;
    const netPnl = grossPnl - fees;
    const riskBudget = equity * config.riskFraction;
    trades.push({
      signalTime: decision.closeTime!, entryTime: next.time,
      exitTime: bars[exitIndex]!.closeTime!, direction: signal.direction,
      entry, exit: exitFill, stop, target: signal.target, size,
      grossPnl, fees, netPnl, rMultiple: netPnl / riskBudget, exitReason,
      sample: i + 1 < splitIndex ? 'development' : 'holdout',
    });
    equity += netPnl;
    peak = Math.max(peak, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, 100 * (peak - equity) / peak);
    // Prevent overlapping trades and prevent an exit bar creating an immediately
    // executable new entry using information already consumed by this trade.
    i = exitIndex;
    if (equity <= 0) break;
  }
  const development = stats(trades.filter((t) => t.sample === 'development'));
  const holdout = stats(trades.filter((t) => t.sample === 'holdout'));
  const overall = stats(trades);
  return {
    hypothesis: 'A fixed completed-candle pattern has positive net expectancy after realistic costs; reject absent out-of-sample evidence.',
    config, bars: bars.length, splitIndex, trades,
    summary: { ...overall, maxDrawdownPct,
      winRate: trades.length ? trades.filter((t) => t.netPnl > 0).length / trades.length : null },
    development, holdout,
    warnings: [
      'Research simulation only: market impact, funding, liquidity, margin and capacity are not modeled.',
      'No parameter tuning or strategy selection is permitted using holdout outcomes.',
      'Bar-level exit sequencing assumes the adverse stop triggers before the target.',
      ...(holdout.count < 30 ? ['Holdout contains fewer than 30 closed trades; evidence is insufficient.'] : []),
    ],
  };
}
