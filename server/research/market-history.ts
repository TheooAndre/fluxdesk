import type { HistoricalDataset } from './datasets.ts';
import { assetIdentity, getJson } from '../market.ts';

export type MarkBar = {
  time: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
export type FundingPayment = {
  time: number;
  rate: number;
  markPrice: number;
  rateType: 'Regular' | 'Special' | 'unspecified';
};
export type HistoricalMarketHistory = {
  schemaVersion: 1;
  retrievedAt: number;
  startTime: number;
  endTime: number;
  fundingSource: 'https://fapi.binance.com/fapi/v1/fundingRate';
  markSource: 'https://fapi.binance.com/fapi/v1/markPriceKlines';
  fundingCoverage: 'observed_unverified';
  funding: FundingPayment[];
  marks: MarkBar[];
};
const fundingSource = 'https://fapi.binance.com/fapi/v1/fundingRate';
const markSource = 'https://fapi.binance.com/fapi/v1/markPriceKlines';
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Validate archive contents independently of the fetcher, including during restore. */
export function validateMarketHistory(dataset: HistoricalDataset): void {
  const h = dataset.marketHistory;
  if (h === undefined) return;
  if (
    !h ||
    dataset.venue !== 'binance' ||
    h.schemaVersion !== 1 ||
    !Number.isSafeInteger(h.retrievedAt) ||
    h.retrievedAt < dataset.capturedAt ||
    h.startTime !== dataset.candles[0]!.time ||
    h.endTime !== dataset.candles.at(-1)!.closeTime ||
    h.fundingSource !== fundingSource ||
    h.markSource !== markSource ||
    h.fundingCoverage !== 'observed_unverified' ||
    !Array.isArray(h.funding) ||
    !h.funding.length ||
    h.funding.length > 4000 ||
    !Array.isArray(h.marks) ||
    h.marks.length !== dataset.candles.length
  )
    throw Error('Invalid historical funding/mark metadata');
  let previous = -1;
  const seen = new Set<string>();
  for (const payment of h.funding) {
    if (
      !payment ||
      !Number.isSafeInteger(payment.time) ||
      payment.time < h.startTime ||
      payment.time > h.endTime ||
      payment.time < previous ||
      typeof payment.rate !== 'number' ||
      !Number.isFinite(payment.rate) ||
      Math.abs(payment.rate) > 1 ||
      !positive(payment.markPrice) ||
      !['Regular', 'Special', 'unspecified'].includes(payment.rateType) ||
      seen.has(`${payment.time}:${payment.rateType}`)
    )
      throw Error('Invalid historical funding payment');
    previous = payment.time;
    seen.add(`${payment.time}:${payment.rateType}`);
  }
  h.marks.forEach((bar, i) => {
    const candle = dataset.candles[i]!;
    if (
      !bar ||
      bar.time !== candle.time ||
      bar.closeTime !== candle.closeTime ||
      ![bar.open, bar.high, bar.low, bar.close].every(positive) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close)
    )
      throw Error('Historical mark candles do not match the complete trade-candle window');
  });
}

/** Bounded, immutable enrichment. Never reads current funding or fabricates a payment schedule. */
export async function fetchHistoricalMarketHistory(
  dataset: HistoricalDataset,
): Promise<HistoricalMarketHistory> {
  const { venue, symbol } = assetIdentity(dataset.assetId);
  const startTime = dataset.candles[0]!.time,
    endTime = dataset.candles.at(-1)!.closeTime!;
  if (venue !== 'binance') throw Error('Historical mark/funding enrichment currently supports Binance only');
  if (dataset.candles.length > 1000 || endTime - startTime >= 90 * 86400000)
    throw Error('Historical mark/funding enrichment is limited to 1000 bars and 90 days');
  const marks: MarkBar[] = [];
  for (let index = 0; index < dataset.candles.length; index += 500) {
    const expected = dataset.candles.slice(index, index + 500);
    const raw = await getJson<unknown>(
      markSource +
        '?' +
        new URLSearchParams({
          symbol,
          interval: dataset.interval,
          startTime: String(expected[0]!.time),
          endTime: String(expected.at(-1)!.closeTime),
          limit: String(expected.length),
        }),
    );
    if (!Array.isArray(raw) || raw.length !== expected.length)
      throw Error('Incomplete historical mark-price page');
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 7) throw Error('Malformed historical mark-price row');
      marks.push({
        time: row[0],
        closeTime: row[6],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
      });
    }
  }
  const funding: FundingPayment[] = [];
  const seen = new Map<string, FundingPayment>();
  let cursor = startTime,
    complete = false;
  for (let page = 0; page < 5; page++) {
    const raw = await getJson<unknown>(
      fundingSource +
        '?' +
        new URLSearchParams({ symbol, startTime: String(cursor), endTime: String(endTime), limit: '1000' }),
    );
    if (!Array.isArray(raw) || raw.length > 1000) throw Error('Malformed funding-history page');
    let last = cursor;
    const pageKeys = new Set<string>();
    for (const row of raw) {
      if (
        !row ||
        row.symbol !== symbol ||
        !Number.isSafeInteger(row.fundingTime) ||
        row.fundingTime < last ||
        row.fundingTime > endTime ||
        typeof row.fundingRate !== 'string' ||
        !row.fundingRate.trim() ||
        typeof row.markPrice !== 'string' ||
        !row.markPrice.trim()
      )
        throw Error('Malformed funding-history payment');
      const payment: FundingPayment = {
        time: row.fundingTime,
        rate: Number(row.fundingRate),
        markPrice: Number(row.markPrice),
        rateType: row.rateType ?? 'unspecified',
      };
      const key = `${payment.time}:${payment.rateType}`;
      if (pageKeys.has(key)) throw Error('Duplicate funding payment in a history page');
      pageKeys.add(key);
      const prior = seen.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(payment))
        throw Error('Funding history changed during pagination');
      if (!prior) {
        funding.push(payment);
        seen.set(key, payment);
      }
      last = payment.time;
    }
    if (raw.length < 1000) {
      complete = true;
      break;
    }
    if (last <= cursor) throw Error('Funding-history pagination made no progress');
    // Repeat the boundary timestamp to retain multiple rate types at the same time.
    cursor = last;
  }
  if (!complete) throw Error('Funding history exceeded the bounded page limit');
  const history: HistoricalMarketHistory = {
    schemaVersion: 1,
    retrievedAt: Date.now(),
    startTime,
    endTime,
    fundingSource,
    markSource,
    fundingCoverage: 'observed_unverified',
    funding,
    marks,
  };
  validateMarketHistory({ ...dataset, marketHistory: history });
  return history;
}
