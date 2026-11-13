import { legMetrics, tradeMetrics, tradeClosedAt, type JournalTrade } from './model.ts';
import type { MarketSnapshot } from '../types.ts';

/** Record completeness only; this does not assess the quality of a trading decision. */
export function reviewGaps(trade: JournalTrade) {
  const gaps: string[] = [];
  if (trade.mode !== 'lite' && !trade.strategy.trim()) gaps.push('Add a setup');
  if (!trade.plan.trim()) gaps.push('Record the plan');
  const metrics = tradeMetrics(trade),
    status = metrics.status;
  if (trade.mode !== 'lite' && !(trade.riskUsd && trade.riskUsd > 0)) gaps.push('Record planned risk');
  if (trade.mode === 'lite') {
    if (!trade.thesis.trim()) gaps.push('Record the thesis');
    if (!trade.invalidation.trim()) gaps.push('Record invalidation');
  }
  if (
    trade.mode !== 'lite' &&
    status === 'open' &&
    trade.legs.some((l) => legMetrics(l).quantity > 0 && l.stop === null)
  )
    gaps.push('Record open-leg stops');
  if (trade.mode !== 'lite' && status === 'closed' && !metrics.hasCompleteAccounting)
    gaps.push('Complete exit fills for P&L');
  if (status === 'closed') {
    if (!trade.review.trim()) gaps.push('Write the review');
    if (!trade.lessons.trim()) gaps.push('Record a lesson');
    if (trade.mode !== 'lite' && !trade.rating) gaps.push('Rate execution');
  }
  return gaps;
}

export function journalQuoteContext(snapshot: MarketSnapshot | undefined) {
  return {
    markets: new Map(snapshot?.assets.map((m) => [m.id, m])),
    liveVenues: new Set(snapshot?.feeds.filter((f) => f.status === 'live').map((f) => f.venue)),
  };
}

export function openPosition(
  trade: JournalTrade,
  snapshot: MarketSnapshot | undefined,
  now: number,
  online: boolean,
  quotes = journalQuoteContext(snapshot),
) {
  const legs = (trade.mode === 'lite' || tradeMetrics(trade).status !== 'open' ? [] : trade.legs).flatMap(
    (leg, index) => {
      const metrics = legMetrics(leg);
      if (metrics.quantity <= 0 || metrics.remainingAverage === null) return [];
      const sign = leg.direction === 'long' ? 1 : -1;
      const quote = quotes.markets.get(leg.assetId);
      const age = quote ? now - quote.asOf : Infinity;
      const usable =
        online &&
        leg.instrument === 'linear_perp' &&
        quote &&
        (quote.priceBasis === 'last' || quote.priceBasis === 'mark') &&
        quotes.liveVenues.has(quote.venue) &&
        age >= -5000 &&
        age <= 45000 &&
        Number.isFinite(quote.price) &&
        quote.price > 0;
      const unrealized = usable ? sign * metrics.quantity * (quote.price - metrics.remainingAverage) : null;
      const stopRisk =
        leg.stop === null
          ? null
          : metrics.quantity * Math.max(0, sign * (metrics.remainingAverage - leg.stop));
      return [{ index, leg, ...metrics, unrealized, stopRisk, quote: usable ? quote : null }];
    },
  );
  const missingQuotes = legs.filter((l) => l.unrealized === null).length;
  const missingStops = legs.filter((l) => l.stopRisk === null).length;
  return {
    legs,
    missingQuotes,
    missingStops,
    unrealized: legs.length && !missingQuotes ? legs.reduce((s, l) => s + l.unrealized!, 0) : null,
    stopRisk: legs.length && !missingStops ? legs.reduce((s, l) => s + l.stopRisk!, 0) : null,
    recordedCash: tradeMetrics(trade).net,
  };
}

export function processAnalytics(trades: JournalTrade[]) {
  const closed = trades
    .map((trade) => {
      const metrics = tradeMetrics(trade);
      const fills = trade.legs.flatMap((l) => l.fills);
      const entry = Math.min(...fills.filter((f) => f.kind === 'entry').map((f) => Date.parse(f.time)));
      const exit = tradeClosedAt(trade) ?? NaN;
      return { trade, ...metrics, entry, exit };
    })
    .filter((t) => t.status === 'closed')
    .sort((a, b) => a.exit - b.exit || a.trade.id.localeCompare(b.trade.id));
  let wins = 0,
    losses = 0,
    maxWins = 0,
    maxLosses = 0;
  const buckets = [
    { name: 'Under 1 hour', max: 3600000, count: 0, net: 0 },
    { name: '1–24 hours', max: 86400000, count: 0, net: 0 },
    { name: '1–7 days', max: 604800000, count: 0, net: 0 },
    { name: '7 days or longer', max: Infinity, count: 0, net: 0 },
  ];
  for (const t of closed) {
    if (!t.hasCompleteAccounting) continue;
    wins = t.net > 0 ? wins + 1 : 0;
    losses = t.net < 0 ? losses + 1 : 0;
    maxWins = Math.max(maxWins, wins);
    maxLosses = Math.max(maxLosses, losses);
    const bucket = buckets.find((b) => t.exit - t.entry < b.max)!;
    bucket.count++;
    bucket.net += t.net;
  }
  return {
    count: closed.length,
    reviewed: closed.filter(
      (t) =>
        t.trade.review.trim() && t.trade.lessons.trim() && (t.trade.mode === 'lite' || t.trade.rating > 0),
    ).length,
    averageHoldingMs: closed.some((t) => t.hasCompleteAccounting)
      ? closed.filter((t) => t.hasCompleteAccounting).reduce((s, t) => s + t.exit - t.entry, 0) /
        closed.filter((t) => t.hasCompleteAccounting).length
      : null,
    maxWins,
    maxLosses,
    buckets,
  };
}
