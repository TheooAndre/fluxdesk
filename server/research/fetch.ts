import type { Candle } from '../../src/types.ts';
import { intervalDurationMs, type CandleInterval } from '../../src/engine/intervals.ts';
import { assetIdentity, getJson } from '../market.ts';
import { validateHistoricalDataset, type HistoricalDataset } from './datasets.ts';

/**
 * Bounded historical backfill, deliberately separate from the short-lived live
 * candle cache. Missing pages fail closed; there is no gap interpolation.
 * Initially supports fixed-duration intervals only, not exchange monthly bars.
 */
export async function fetchHistoricalDataset(
  assetId: string,
  interval: CandleInterval,
  count: number,
  now = Date.now(),
): Promise<HistoricalDataset> {
  const { venue, symbol } = assetIdentity(assetId);
  if (!(['15m', '1h', '4h', '1d'] as string[]).includes(interval))
    throw Error('Research ingestion supports 15m, 1h, 4h and 1d intervals');
  if (!Number.isSafeInteger(count) || count < 80 || count > 3_000)
    throw Error('Research history requires 80 to 3000 completed bars');
  if (!Number.isSafeInteger(now) || now <= 0) throw Error('Invalid research capture time');
  const duration = intervalDurationMs(interval);
  const endExclusive = Math.floor(now / duration) * duration;
  const first = endExclusive - count * duration;
  if (first < 0) throw Error('Requested history is before Unix epoch');
  const all: Candle[] = [];
  for (let cursor = first; cursor < endExclusive;) {
    const pageBars = Math.min(500, (endExclusive - cursor) / duration);
    const end = cursor + pageBars * duration - 1;
    let page: Candle[];
    if (venue === 'binance') {
      type Kline = [number, string, string, string, string, string, number, string];
      const raw = await getJson<Kline[]>(
        'https://fapi.binance.com/fapi/v1/klines?' +
        new URLSearchParams({
          symbol, interval, startTime: String(cursor),
          endTime: String(end), limit: String(pageBars),
        }).toString(),
      );
      if (!Array.isArray(raw)) throw Error('Malformed Binance history page');
      page = raw.map((k) => ({
        time: k[0], closeTime: k[6],
        open: Number(k[1]), high: Number(k[2]), low: Number(k[3]),
        close: Number(k[4]), volumeBase: Number(k[5]), volumeUsd: Number(k[7]),
      }));
    } else {
      type HLCandle = { t: number; T: number; o: string; h: string; l: string; c: string; v: string };
      const raw = await getJson<HLCandle[]>('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin: symbol, interval, startTime: cursor, endTime: end },
        }),
      });
      if (!Array.isArray(raw)) throw Error('Malformed Hyperliquid history page');
      page = raw.map((x) => {
        const open = Number(x.o), close = Number(x.c), volumeBase = Number(x.v);
        return {
          time: x.t, closeTime: x.T, open, high: Number(x.h), low: Number(x.l),
          close, volumeBase,
          // Estimate, not an exchange-reported historical quote notional.
          volumeUsd: volumeBase * (open + close) / 2,
        };
      });
    }
    if (page.length !== pageBars || page.some((x, i) => x.time !== cursor + i * duration))
      throw Error('Exchange returned missing, duplicate or misaligned historical candles');
    all.push(...page);
    cursor += pageBars * duration;
  }
  const dataset: HistoricalDataset = {
    schemaVersion: 1, venue, assetId, interval, capturedAt: Date.now(),
    candles: all,
  };
  validateHistoricalDataset(dataset);
  return dataset;
}
