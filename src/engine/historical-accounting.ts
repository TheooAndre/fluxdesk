import type { Candle } from '../types.ts';
import type { ResearchTrade } from './backtest.ts';
export type HistoricalAccounting = {
  marks: { time: number; closeTime: number; close: number }[];
  funding: { time: number; rate: number; markPrice: number; rateType: string }[];
};
export function validateAccounting(bars: Candle[], history: HistoricalAccounting) {
  if (
    !history ||
    !Array.isArray(history.marks) ||
    history.marks.length !== bars.length ||
    !Array.isArray(history.funding) ||
    !history.funding.length
  )
    throw Error('Historical accounting requires matching mark candles and observed funding payments');
  history.marks.forEach((m, i) => {
    if (
      m.time !== bars[i]!.time ||
      m.closeTime !== bars[i]!.closeTime ||
      !Number.isFinite(m.close) ||
      m.close <= 0
    )
      throw Error('Invalid historical mark grid');
  });
  let previous = -1;
  const seen = new Set<string>();
  for (const p of history.funding) {
    const key = `${p.time}:${p.rateType}`;
    if (
      !Number.isSafeInteger(p.time) ||
      p.time < bars[0]!.time ||
      p.time > bars.at(-1)!.closeTime! ||
      p.time < previous ||
      !Number.isFinite(p.rate) ||
      Math.abs(p.rate) > 1 ||
      !Number.isFinite(p.markPrice) ||
      p.markPrice <= 0 ||
      !['Regular', 'Special', 'unspecified'].includes(p.rateType) ||
      seen.has(key)
    )
      throw Error('Invalid historical funding events');
    previous = p.time;
    seen.add(key);
  }
}
/** Positive is a credit. Unknown entry/exit ordering includes debits but omits credits. */
export function fundingCashflow(
  trade: Pick<ResearchTrade, 'entryTime' | 'exitTime' | 'direction' | 'size' | 'exitTiming' | 'exitBarOpen'>,
  history: HistoricalAccounting,
  until = trade.exitTime,
): number {
  let cash = 0;
  for (const event of history.funding) {
    if (event.time < trade.entryTime || event.time > Math.min(until, trade.exitTime)) continue;
    const change = -(trade.direction === 'long' ? 1 : -1) * trade.size * event.markPrice * event.rate;
    const ambiguous =
      event.time === trade.entryTime ||
      (trade.exitTiming === 'intrabar' && event.time >= trade.exitBarOpen!) ||
      (trade.exitTiming === 'open' && event.time === trade.exitTime);
    if (!ambiguous || change < 0) cash += change;
  }
  return cash;
}
