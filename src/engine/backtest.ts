import type { Candle, EntrySignal, SignalModel } from '../types.ts';
import { fundingCashflow, validateAccounting, type HistoricalAccounting } from './historical-accounting.ts';
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
  /** Entry notional / account equity. Defaults to 1; not a liquidation model. */
  maxGrossLeverage?: number;
  historicalAccounting?: boolean;
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
  exitReason: 'stop' | 'target' | 'sample_end' | 'end_of_data';
  sample: 'development' | 'holdout';
  entryNotional?: number;
  grossLeverage?: number;
  sizeCapped?: boolean;
  fundingPnl?: number;
  exitTiming?: 'open' | 'intrabar' | 'close';
  exitBarOpen?: number;
};
export type ResearchEquityPoint = {
  time: number;
  value: number;
  position: 'flat' | 'long' | 'short';
  sample: 'development' | 'holdout';
};
export type ResearchResult = {
  hypothesis: string;
  config: ResearchConfig;
  bars: number;
  splitIndex: number;
  trades: ResearchTrade[];
  /** Bar-close trade-price proxy, not historical mark-price or intrabar equity. */
  equityCurve?: ResearchEquityPoint[];
  summary: {
    count: number;
    netPnl: number;
    expectancyR: number | null;
    maxDrawdownPct: number;
    maxOpenEquityDrawdownPct?: number;
    maxEntryGrossLeverage?: number;
    sizeCappedCount?: number;
    winRate: number | null;
  };
  development: { count: number; netPnl: number; expectancyR: number | null };
  holdout: { count: number; netPnl: number; expectancyR: number | null };
  accounting?: 'observed-funding-mark-v3';
  warnings: string[];
};

const finitePositive = (x: number) => Number.isFinite(x) && x > 0;

function validate(bars: Candle[], c: ResearchConfig) {
  if (bars.length < 67) throw Error('At least 67 completed candles required');
  if (!finitePositive(c.initialEquity) || !finitePositive(c.riskFraction) || c.riskFraction > 0.05)
    throw Error('Invalid initial equity or risk fraction (max 5%)');
  if (!finitePositive(c.maxGrossLeverage ?? 1) || (c.maxGrossLeverage ?? 1) > 3)
    throw Error('Invalid gross exposure cap (greater than 0, max 3x)');
  if (!Number.isFinite(c.holdoutFraction) || c.holdoutFraction < 0.1 || c.holdoutFraction > 0.5)
    throw Error('Holdout must cover between 10% and 50% of observations');
  if (
    ![c.costs.feeBpsPerSide, c.costs.slippageBpsPerSide].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 100,
    )
  )
    throw Error('Invalid transaction costs');
  if (!['sfp', 'msb', 'pullback', 'range'].includes(c.model)) throw Error('Unsupported strategy');
  let previousClose = -1;
  for (const b of bars) {
    if (
      ![b.time, b.closeTime, b.open, b.high, b.low, b.close].every(
        (v) => typeof v === 'number' && Number.isFinite(v),
      )
    )
      throw Error('Invalid or incomplete candle timestamp/OHLC');
    if (
      (previousClose >= 0 && b.time !== previousClose + 1) ||
      b.closeTime! < b.time ||
      ![b.open, b.high, b.low, b.close].every(finitePositive) ||
      b.low > Math.min(b.open, b.close) ||
      b.high < Math.max(b.open, b.close)
    )
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
  history?: HistoricalAccounting,
): ResearchResult {
  validate(bars, config);
  const accounting = config.historicalAccounting ? history : undefined;
  if (config.historicalAccounting) {
    if (!accounting) throw Error('Historical accounting requires an enriched dataset');
    validateAccounting(bars, accounting);
  }
  const splitIndex = Math.floor(bars.length * (1 - config.holdoutFraction));
  const trades: ResearchTrade[] = [];
  const maxGrossLeverage = config.maxGrossLeverage ?? 1;
  let equity = config.initialEquity;
  let peak = equity;
  let maxDrawdownPct = 0;
  const cost = (config.costs.feeBpsPerSide + config.costs.slippageBpsPerSide) / 10_000;
  // Never carry an open trade across the locked chronological sample boundary.
  // The holdout can use old bars to warm up indicators, but its signal and
  // entry must both occur *within* the holdout period.
  const phases = [
    { first: 64, end: splitIndex, sample: 'development' },
    { first: splitIndex, end: bars.length, sample: 'holdout' },
  ] as const;
  for (const phase of phases) {
    for (let i = phase.first; i < phase.end - 1; i++) {
      const decision = bars[i]!;
      const signal = signalAt(bars.slice(0, i + 1), [config.model]).find(
        (s) => s.model === config.model && s.barTime === decision.time,
      );
      if (!signal) continue;
      const next = bars[i + 1]!;
      const direction = signal.direction === 'long' ? 1 : -1;
      const entry = next.open * (1 + (direction * config.costs.slippageBpsPerSide) / 10_000);
      const stop = signal.stop;
      if (
        !finitePositive(entry) ||
        !finitePositive(stop) ||
        !finitePositive(signal.target) ||
        direction * (entry - stop) <= 0 ||
        direction * (signal.target - entry) <= 0
      )
        continue;
      const riskPerUnit = Math.abs(entry - stop);
      // Include round-trip fees in the budget to avoid sizing beyond the specified risk.
      const riskSize = (equity * config.riskFraction) / (riskPerUnit + 2 * entry * cost);
      // Reserve the entry fee as well as capital for the entry notional cap.
      // This is an exposure constraint, not exchange-specific margin simulation.
      const feeRate = config.costs.feeBpsPerSide / 10_000;
      const exposureSize = (equity * maxGrossLeverage) / (entry * (1 + maxGrossLeverage * feeRate));
      const size = Math.min(riskSize, exposureSize);
      if (!finitePositive(size)) continue;
      let exit = NaN,
        exitIndex = -1;
      let exitReason: ResearchTrade['exitReason'] = 'end_of_data';
      let exitTiming: 'open' | 'intrabar' | 'close' = 'close';
      for (let j = i + 1; j < phase.end; j++) {
        const b = bars[j]!;
        // Gaps through the stop exit at the worse opening price.
        if ((direction === 1 && b.open <= stop) || (direction === -1 && b.open >= stop)) {
          exitTiming = 'open';
          exit = b.open;
          exitIndex = j;
          exitReason = 'stop';
          break;
        }
        if ((direction === 1 && b.low <= stop) || (direction === -1 && b.high >= stop)) {
          exitTiming = 'intrabar';
          exit = stop;
          exitIndex = j;
          exitReason = 'stop';
          break;
        }
        if ((direction === 1 && b.high >= signal.target) || (direction === -1 && b.low <= signal.target)) {
          // Favor no price improvement from favorable gaps.
          exitTiming = 'intrabar';
          exit = signal.target;
          exitIndex = j;
          exitReason = 'target';
          break;
        }
      }
      if (exitIndex < 0) {
        exitIndex = phase.end - 1;
        exit = bars[exitIndex]!.close;
        exitReason = phase.sample === 'development' ? 'sample_end' : 'end_of_data';
      }
      const exitFill = exit * (1 - (direction * config.costs.slippageBpsPerSide) / 10_000);
      const grossPnl = direction * (exitFill - entry) * size;
      const fees = ((entry + exitFill) * size * config.costs.feeBpsPerSide) / 10_000;
      const exitTime = accounting && exitTiming === 'open' ? bars[exitIndex]!.time : bars[exitIndex]!.closeTime!;
      const fundingPnl = accounting ? fundingCashflow({entryTime: next.time, exitTime, direction: signal.direction, size, exitTiming, exitBarOpen: bars[exitIndex]!.time}, accounting) : 0;
      const netPnl = grossPnl - fees + fundingPnl;
      const riskBudget = equity * config.riskFraction;
      trades.push({
        signalTime: decision.closeTime!,
        entryTime: next.time,
        exitTime,
        ...(accounting ? {fundingPnl, exitTiming, exitBarOpen: bars[exitIndex]!.time} : {}),
        direction: signal.direction,
        entry,
        exit: exitFill,
        stop,
        target: signal.target,
        size,
        grossPnl,
        fees,
        netPnl,
        rMultiple: netPnl / riskBudget,
        exitReason,
        sample: phase.sample,
        entryNotional: size * entry,
        grossLeverage: (size * entry) / equity,
        sizeCapped: exposureSize < riskSize,
      });
      equity += netPnl;
      peak = Math.max(peak, equity);
      maxDrawdownPct = Math.max(maxDrawdownPct, (100 * (peak - equity)) / peak);
      // Prevent overlapping trades and prevent an exit bar creating an immediately
      // executable new entry using information already consumed by this trade.
      i = exitIndex;
      if (equity <= 0) break;
    }
    if (equity <= 0) break;
  }
  const openEquity = barCloseEquity(
    bars,
    trades,
    config.initialEquity,
    config.costs.feeBpsPerSide,
    splitIndex,
    accounting,
  );
  const development = stats(trades.filter((t) => t.sample === 'development'));
  const holdout = stats(trades.filter((t) => t.sample === 'holdout'));
  const overall = stats(trades);
  return {
    hypothesis:
      'A fixed completed-candle pattern has positive net expectancy after realistic costs; reject absent out-of-sample evidence.',
    config: { ...config, maxGrossLeverage },
    bars: bars.length,
    splitIndex,
    trades,
    equityCurve: openEquity.points,
    ...(accounting ? {accounting: 'observed-funding-mark-v3' as const} : {}),
    summary: {
      ...overall,
      maxDrawdownPct,
      maxOpenEquityDrawdownPct: openEquity.maxDrawdownPct,
      maxEntryGrossLeverage: trades.reduce((max, trade) => Math.max(max, trade.grossLeverage ?? 0), 0),
      sizeCappedCount: trades.filter((trade) => trade.sizeCapped).length,
      winRate: trades.length ? trades.filter((t) => t.netPnl > 0).length / trades.length : null,
    },
    development,
    holdout,
    warnings: [
      ...(accounting ? ['Exploratory observed funding and bar-close mark accounting. Historical payment schedule completeness is unaudited; missing payments can bias results.', 'Funding near entries and intrabar exits uses conservative ordering: debits included, ambiguous credits omitted. Intrabar margin/liquidation and liquidity are not modeled.'] : [
      'Research simulation only: funding, historical mark prices, intrabar equity, exchange margin/liquidations, liquidity and market impact are not modeled.',
      'Open-position equity uses completed trade-candle closes with entry fees deducted; exit fees and slippage are realized on exit. It can understate intrabar or mark-price drawdown.']),
      'Gross exposure is capped at entry only; price moves can change leverage, and gap losses can exceed the planned stop risk or account equity.',
      'No parameter tuning or strategy selection is permitted using holdout outcomes.',
      'Bar-level exit sequencing assumes the adverse stop triggers before the target.',
      'Open development trades are marked to market at the split boundary and never enter holdout.',
      ...(holdout.count < 30
        ? ['Holdout contains fewer than 30 closed trades; evidence is insufficient.']
        : []),
    ],
  };
}

/** Reconcile cash plus unrealized P&L at each completed candle close.
 * Only trades already entered by that timestamp affect the observation.
 * Exit bars use their realized result; no future exit P&L is spread backwards.
 */
function barCloseEquity(
  bars: Candle[],
  trades: ResearchTrade[],
  initialEquity: number,
  feeBps: number,
  splitIndex: number,
  accounting?: HistoricalAccounting,
): { points: ResearchEquityPoint[]; maxDrawdownPct: number } {
  let cash = initialEquity,
    index = 0,
    peak = initialEquity,
    maxDrawdownPct = 0;
  const points: ResearchEquityPoint[] = [
    { time: bars[0]!.time, value: cash, position: 'flat', sample: 'development' },
  ];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!,
      time = bar.closeTime!;
    while (trades[index] && trades[index]!.exitTime <= time) cash += trades[index++]!.netPnl;
    const trade = trades[index];
    const open = trade && trade.entryTime <= time;
    const value = open
      ? cash +
        (trade.direction === 'long' ? 1 : -1) * ((accounting?.marks[i]?.close ?? bar.close) - trade.entry) * trade.size -
        (trade.entry * trade.size * feeBps) / 10_000 +
        (accounting ? fundingCashflow(trade, accounting, time) : 0)
      : cash;
    peak = Math.max(peak, value);
    maxDrawdownPct = Math.max(maxDrawdownPct, (100 * (peak - value)) / peak);
    points.push({
      time,
      value,
      position: open ? trade.direction : 'flat',
      sample: i < splitIndex ? 'development' : 'holdout',
    });
  }
  return { points, maxDrawdownPct };
}
