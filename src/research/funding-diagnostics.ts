export type FundingDiagnostics = {
  status: 'review_required';
  regularOrUnspecifiedPayments: number;
  specialPayments: number;
  unspecifiedTypes: number;
  positiveRates: number;
  negativeRates: number;
  zeroRates: number;
  firstPaymentAt: number | null;
  lastPaymentAt: number | null;
  leadingGapHours: number;
  trailingGapHours: number;
  spacingVariantCount: number;
  spacingHours: { hours: number; count: number }[];
  gapsOver8h: { from: number; to: number; hours: number }[];
  gapCountOver8h: number;
  largestMarkTradeCloseDifferencePct: number | null;
};
/** Observed spacing is descriptive. It never establishes the historical payment schedule. */
export function fundingDiagnostics(input: {
  startTime: number;
  endTime: number;
  funding: { time: number; rate: number; rateType: string }[];
  marks: { close: number }[];
  tradeCloses: number[];
}): FundingDiagnostics {
  const ordinary = [
    ...new Set(input.funding.filter((p) => p.rateType !== 'Special').map((p) => p.time)),
  ].sort((a, b) => a - b);
  const spacing = new Map<number, number>();
  const gaps: FundingDiagnostics['gapsOver8h'] = [];
  for (let i = 1; i < ordinary.length; i++) {
    const from = ordinary[i - 1]!,
      to = ordinary[i]!,
      hours = (to - from) / 3600000;
    spacing.set(hours, (spacing.get(hours) ?? 0) + 1);
    if (hours > 8) gaps.push({ from, to, hours });
  }
  let largest: number | null = null;
  input.marks.forEach((mark, i) => {
    const trade = input.tradeCloses[i];
    if (trade && Number.isFinite(trade) && Number.isFinite(mark.close))
      largest = Math.max(largest ?? 0, Math.abs(mark.close / trade - 1) * 100);
  });
  const first = ordinary[0] ?? null,
    last = ordinary.at(-1) ?? null;
  return {
    status: 'review_required',
    regularOrUnspecifiedPayments: input.funding.filter((p) => p.rateType !== 'Special').length,
    specialPayments: input.funding.filter((p) => p.rateType === 'Special').length,
    unspecifiedTypes: input.funding.filter((p) => p.rateType === 'unspecified').length,
    positiveRates: input.funding.filter((p) => p.rate > 0).length,
    negativeRates: input.funding.filter((p) => p.rate < 0).length,
    zeroRates: input.funding.filter((p) => p.rate === 0).length,
    firstPaymentAt: first,
    lastPaymentAt: last,
    leadingGapHours: ((first ?? input.endTime) - input.startTime) / 3600000,
    trailingGapHours: (input.endTime - (last ?? input.startTime)) / 3600000,
    spacingVariantCount: spacing.size,
    spacingHours: [...spacing]
      .sort(([a], [b]) => a - b)
      .slice(0, 16)
      .map(([hours, count]) => ({ hours, count })),
    gapsOver8h: gaps.slice(0, 8),
    gapCountOver8h: gaps.length,
    largestMarkTradeCloseDifferencePct: largest,
  };
}
