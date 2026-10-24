import { it, expect } from 'vitest';
import { newTrade, legMetrics, tradeMetrics } from '../src/journal/model.ts';
import { openPosition, reviewGaps, processAnalytics } from '../src/journal/insights.ts';
import type { MarketSnapshot } from '../src/types.ts';
const now = Date.UTC(2026, 9, 24, 12);
function trade() {
  const t = newTrade('2026-10-24');
  t.id = 'test';
  t.title = 'Position';
  t.legs[0]!.fills = [
    {
      id: '1',
      kind: 'entry',
      quantity: 1,
      price: 100,
      feeUsd: 1,
      time: new Date(now - 3600000).toISOString(),
    },
    {
      id: '2',
      kind: 'exit',
      quantity: 0.5,
      price: 120,
      feeUsd: 1,
      time: new Date(now - 1800000).toISOString(),
    },
    {
      id: '3',
      kind: 'entry',
      quantity: 1,
      price: 200,
      feeUsd: 1,
      time: new Date(now - 600000).toISOString(),
    },
  ];
  return t;
}
const snapshot = (): MarketSnapshot => ({
  assets: [
    {
      id: 'binance:BTCUSDT',
      venue: 'binance',
      symbol: 'BTCUSDT',
      base: 'BTC',
      price: 180,
      priceBasis: 'last',
      timestampBasis: 'exchange',
      previous24h: 100,
      return24h: 80,
      volumeUsd24h: 1,
      oiUsd: null,
      asOf: now,
    },
  ],
  feeds: [{ venue: 'binance', status: 'live', lastSuccessAt: now, lastAttemptAt: now, ageMs: 0, markets: 1 }],
  asOf: now,
  checkedAt: now,
});
it('prices remaining average cost after partial exits and new entries without multiplying by leverage', () => {
  const t = trade();
  t.legs[0]!.stop = 150;
  t.legs[0]!.leverage = 100;
  t.fundingUsd = -2;
  t.otherCostsUsd = 1;
  expect(legMetrics(t.legs[0]!).entryAverage).toBe(150);
  expect(legMetrics(t.legs[0]!).remainingAverage).toBeCloseTo(250 / 1.5);
  const p = openPosition(t, snapshot(), now, true);
  expect(p.unrealized).toBeCloseTo(20);
  expect(p.recordedCash).toBe(4);
  expect(p.stopRisk).toBeCloseTo(25);
  t.legs[0]!.direction = 'short';
  t.legs[0]!.stop = 190;
  expect(openPosition(t, snapshot(), now, true).unrealized).toBeCloseTo(-20);
  expect(openPosition(t, snapshot(), now, true).stopRisk).toBeCloseTo(35);
  t.legs[0]!.stop = 150;
  expect(openPosition(t, snapshot(), now, true).stopRisk).toBe(0);
});
it('fails closed for stale, future, offline, unknown-basis, invalid, wrong-contract and spot quotes', () => {
  for (const change of [
    (s: MarketSnapshot) => {
      s.assets[0]!.asOf = now - 45001;
    },
    (s: MarketSnapshot) => {
      s.assets[0]!.asOf = now + 5001;
    },
    (s: MarketSnapshot) => {
      s.assets[0]!.priceBasis = undefined;
    },
    (s: MarketSnapshot) => {
      s.assets[0]!.price = NaN;
    },
    (s: MarketSnapshot) => {
      s.assets[0]!.price = 0;
    },
    (s: MarketSnapshot) => {
      s.assets[0]!.id = 'hyperliquid:BTC';
    },
    (s: MarketSnapshot) => {
      s.feeds[0]!.status = 'stale';
    },
  ]) {
    const s = snapshot();
    change(s);
    expect(openPosition(trade(), s, now, true).unrealized).toBeNull();
  }
  expect(openPosition(trade(), snapshot(), now, false).unrealized).toBeNull();
  expect(openPosition(trade(), undefined, now, true).unrealized).toBeNull();
  const t = trade();
  t.legs[0]!.instrument = 'spot';
  expect(openPosition(t, snapshot(), now, true).unrealized).toBeNull();
});
it('does not present partial multi-leg quote/stop totals as complete', () => {
  const t = trade();
  t.legs[0]!.stop = 150;
  t.legs.push({ ...structuredClone(t.legs[0]!), assetId: 'hyperliquid:ETH', stop: null });
  expect(openPosition(t, snapshot(), now, true)).toMatchObject({
    missingQuotes: 1,
    missingStops: 1,
    unrealized: null,
    stopRisk: null,
  });
});
it('tracks record gaps without judging discipline and computes holding time and streaks by final exit', () => {
  const t = trade();
  expect(reviewGaps(t)).toContain('Record open-leg stops');
  t.legs[0]!.fills.push({
    id: '4',
    kind: 'exit',
    quantity: 1.5,
    price: 180,
    feeUsd: 0,
    time: new Date(now).toISOString(),
  });
  expect(reviewGaps(t)).toContain('Write the review');
  expect(reviewGaps(t)).not.toContain('Record open-leg stops');
  t.strategy = 'Mean reversion';
  t.plan = 'Wait';
  t.riskUsd = 50;
  t.review = 'Exited';
  t.lessons = 'Patience';
  t.rating = 3;
  t.rulesFollowed = false;
  expect(reviewGaps(t)).toEqual([]);
  const loss = structuredClone(t);
  loss.id = 'loss';
  loss.otherCostsUsd = 100;
  loss.legs[0]!.fills[3]!.time = new Date(now + 3600000).toISOString();
  const flat = structuredClone(t);
  flat.id = 'flat';
  flat.otherCostsUsd = tradeMetrics(flat).net;
  flat.legs[0]!.fills[3]!.time = new Date(now + 7200000).toISOString();
  const win = structuredClone(t);
  win.id = 'win';
  win.legs[0]!.fills[3]!.time = new Date(now + 10800000).toISOString();
  const stats = processAnalytics([win, flat, loss, t, newTrade(), trade()]);
  expect(stats).toMatchObject({
    count: 4,
    reviewed: 4,
    averageHoldingMs: 2.5 * 3600000,
    maxWins: 1,
    maxLosses: 1,
  });
  expect(stats.buckets[0]!.count).toBe(0);
  expect(stats.buckets[1]!.count).toBe(4);
  expect(processAnalytics([]).averageHoldingMs).toBeNull();
});
