import { expect, it } from 'vitest';
import {
  closeTrade,
  journalMode,
  newTrade,
  tradeMetrics,
  journalAnalytics,
  validateTrade,
} from '../src/journal/model.ts';
import { openPosition, processAnalytics, reviewGaps } from '../src/journal/insights.ts';
import { exportSummaryCsv } from '../src/journal/files.ts';

function fullTrade() {
  const trade = newTrade('2026-11-13');
  trade.title = 'Beta basket';
  trade.thesis = 'Sector rotation';
  trade.invalidation = 'BTC breaks structure';
  trade.plan = 'Trim at target';
  trade.legs[0]!.fills = [
    { id: 'entry', kind: 'entry', time: '2026-11-13T10:00:00Z', quantity: 2, price: 100, feeUsd: 1 },
  ];
  return trade;
}
it('keeps existing execution records in full mode and allows notes-only entries without prices or legs', () => {
  const full = fullTrade();
  expect(validateTrade(full)).toEqual(full);
  expect(tradeMetrics(full)).toMatchObject({ status: 'open', net: -1 });
  const lite = { ...full, mode: 'lite' as const, manualStatus: 'open' as const, legs: [] };
  expect(validateTrade(lite)).toEqual(lite);
  expect(tradeMetrics(lite)).toMatchObject({ status: 'open', hasCompleteAccounting: false, rMultiple: null });
  expect(reviewGaps(lite)).toEqual([]);
  expect(openPosition(lite, undefined, Date.now(), true).legs).toEqual([]);
});
it('manually closes a full trade without fabricating fills, P&L or open exposure', () => {
  const full = fullTrade(),
    closed = closeTrade(full);
  expect(validateTrade(closed)).toEqual(closed);
  expect(closed.legs).toEqual(full.legs);
  expect(tradeMetrics(closed)).toMatchObject({ status: 'closed', hasCompleteAccounting: false });
  expect(journalAnalytics([closed])).toMatchObject({ count: 0, net: 0, winRate: null });
  expect(processAnalytics([closed])).toMatchObject({ count: 1, averageHoldingMs: null });
  expect(openPosition(closed, undefined, Date.now(), true).legs).toEqual([]);
  expect(reviewGaps(closed)).toContain('Complete exit fills for P&L');
  closed.legs[0]!.fills.push({
    id: 'exit',
    kind: 'exit',
    time: '2026-11-13T11:00:00Z',
    quantity: 2,
    price: 110,
    feeUsd: 1,
  });
  expect(journalAnalytics([closed])).toMatchObject({ count: 1, net: 18, winRate: 1 });
});
it('preserves full execution data and notes when switching modes, and excludes lite records from financial statistics', () => {
  const full = fullTrade(),
    lite = journalMode(full, true);
  expect(lite).toMatchObject({ mode: 'lite', manualStatus: 'open', thesis: full.thesis, legs: full.legs });
  const closed = closeTrade(lite);
  closed.review = 'Waited for confirmation';
  closed.lessons = 'Keep size steady';
  expect(reviewGaps(closed)).toEqual([]);
  expect(processAnalytics([closed])).toMatchObject({
    count: 1,
    reviewed: 1,
    averageHoldingMs: null,
    maxWins: 0,
    maxLosses: 0,
  });
  expect(journalAnalytics([closed]).count).toBe(0);
  expect(journalMode(closed, false)).toMatchObject({ mode: 'full', manualStatus: 'closed', legs: full.legs });
  expect(exportSummaryCsv([closed])).toContain('Sector rotation');
  expect(exportSummaryCsv([closed])).toContain('"lite","closed"');
});
it('validates mode and manual closure metadata, while a reopened record derives full status from fills again', () => {
  const full = fullTrade();
  for (const patch of [
    { mode: 'bad' },
    { manualStatus: 'bad' },
    { manualStatus: 'open' },
    { manualStatus: 'closed' },
    { manualStatus: 'closed', closedAt: Infinity },
    { closedAt: Date.now() },
    { manualStatus: 'closed', closedAt: Date.now() + 86400000 },
  ])
    expect(() => validateTrade({ ...full, ...patch })).toThrow();
  const closed = closeTrade(full);
  expect(tradeMetrics({ ...closed, manualStatus: undefined, closedAt: undefined }).status).toBe('open');
  expect(journalMode({ ...journalMode(full, true), legs: [] }, false).legs).toHaveLength(1);
});
