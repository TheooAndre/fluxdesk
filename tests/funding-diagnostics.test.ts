import { expect, it } from 'vitest';
import { fundingDiagnostics } from '../src/research/funding-diagnostics.ts';
const hour = 3600000;
const payment = (h: number, rate = 0.001, rateType = 'Regular') => ({ time: h * hour, rate, rateType });
const diagnostic = (funding: ReturnType<typeof payment>[]) =>
  fundingDiagnostics({
    startTime: 0,
    endTime: 40 * hour,
    funding,
    marks: [{ close: 102 }, { close: 99 }],
    tradeCloses: [100, 100],
  });
it('describes changes in spacing, boundaries, signed rates and mark divergence without certifying completeness', () => {
  const d = diagnostic([payment(4), payment(8, -0.001), payment(16, 0), payment(32)]);
  expect(d.status).toBe('review_required');
  expect(d.spacingHours).toEqual([
    { hours: 4, count: 1 },
    { hours: 8, count: 1 },
    { hours: 16, count: 1 },
  ]);
  expect(d.gapCountOver8h).toBe(1);
  expect(d.leadingGapHours).toBe(4);
  expect(d.trailingGapHours).toBe(8);
  expect([d.positiveRates, d.negativeRates, d.zeroRates]).toEqual([2, 1, 1]);
  expect(d.largestMarkTradeCloseDifferencePct).toBeCloseTo(2);
});
it('excludes special events and same-time extra types from ordinary spacing', () => {
  const d = diagnostic([
    payment(0),
    payment(4, 0.1, 'Special'),
    payment(8, 0.1, 'unspecified'),
    payment(8, 0.1, 'Regular'),
  ]);
  expect(d.spacingHours).toEqual([{ hours: 8, count: 1 }]);
  expect(d.specialPayments).toBe(1);
  expect(d.unspecifiedTypes).toBe(1);
  expect(d.gapCountOver8h).toBe(0);
  expect(d.regularOrUnspecifiedPayments).toBe(3);
});
it('does not infer a schedule from zero or one ordinary observation', () => {
  const empty = diagnostic([payment(4, 0.1, 'Special')]);
  expect(empty.firstPaymentAt).toBeNull();
  expect(empty.spacingHours).toEqual([]);
  expect(empty.leadingGapHours).toBe(40);
  expect(diagnostic([payment(4)]).spacingHours).toEqual([]);
});
it('bounds verbose diagnostics without hiding the total gap count', () => {
  const d = fundingDiagnostics({
    startTime: 0,
    endTime: 30000 * hour,
    funding: Array.from({ length: 50 }, (_, i) => payment(i * i * 9)),
    marks: [],
    tradeCloses: [],
  });
  expect(d.gapsOver8h).toHaveLength(8);
  expect(d.gapCountOver8h).toBe(49);
  expect(d.spacingHours).toHaveLength(16);
  expect(d.spacingVariantCount).toBe(49);
});
