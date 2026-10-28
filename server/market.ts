import type { Candle, Market, MarketSnapshot, FeedStatus, Venue, PerpetualQuote } from '../src/types.ts';
import { assertInterval, intervalDurationMs, nextCandleStart } from '../src/engine/intervals.ts';
import { RequestCache } from './cache.ts';

const BINANCE = 'https://fapi.binance.com';
const HL = 'https://api.hyperliquid.xyz/info';
// Quote reuse is shorter than the browser polling interval to avoid an extra
// polling cycle on the old snapshot. Keep OI caching/freshness thresholds separate.
export const TTL = {
  marketRefresh: 5_000,
  markets: 45_000,
  history: 30_000,
  info: 24 * 3600_000,
  stale: 15 * 60_000,
};
const cache = new RequestCache();
export class UpstreamError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function getJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { accept: 'application/json', ...options.headers },
    });
    if (!response.ok) {
      const detail =
        response.status === 451
          ? 'unavailable in this server region'
          : response.status === 429 || response.status === 418
            ? 'rate limited; retry later'
            : 'upstream request failed';
      throw new UpstreamError(
        `${new URL(url).hostname}: ${detail} (HTTP ${response.status})`,
        response.status,
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (controller.signal.aborted) throw Error(`${new URL(url).hostname}: request timed out`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function hyper<T>(body: object) {
  return getJson<T>(HL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function number(value: unknown): number {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    ? Number(value)
    : NaN;
}
function nonnegative(value: unknown): number | null {
  const n = number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
type BinanceTicker = {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  openPrice: string;
  closeTime: number;
};
type BinanceInfo = {
  symbols: { symbol: string; baseAsset: string; quoteAsset: string; contractType: string; status: string }[];
};
type HyperInfo = [
  { universe: { name: string; isDelisted?: boolean }[] },
  Array<{
    markPx: string;
    midPx?: string;
    oraclePx?: string;
    funding?: string;
    prevDayPx: string;
    dayNtlVlm: string;
    openInterest: string;
  }>,
];
const hyperPerpetuals = new Map<string, PerpetualQuote>();
async function binanceMarkets(): Promise<Market[]> {
  const [tickers, info] = await Promise.all([
    getJson<BinanceTicker[]>(`${BINANCE}/fapi/v1/ticker/24hr`),
    cache.get('exchangeinfo', TTL.info, () => getJson<BinanceInfo>(`${BINANCE}/fapi/v1/exchangeInfo`)),
  ]);
  const valid = new Map(
    info.symbols
      .filter((x) => x.contractType === 'PERPETUAL' && x.status === 'TRADING' && x.quoteAsset === 'USDT')
      .map((x) => [x.symbol, x.baseAsset]),
  );
  const out: Market[] = [];
  for (const t of tickers) {
    const base = valid.get(t.symbol),
      price = number(t.lastPrice),
      previous = number(t.openPrice),
      volume = nonnegative(t.quoteVolume),
      asOf = number(t.closeTime);
    if (
      !base ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(previous) ||
      previous <= 0 ||
      volume === null ||
      !Number.isFinite(asOf) ||
      Math.abs(Date.now() - asOf) > 120_000
    )
      continue;
    out.push({
      id: `binance:${t.symbol}`,
      venue: 'binance',
      priceBasis: 'last',
      timestampBasis: 'exchange',
      symbol: t.symbol,
      base,
      price,
      previous24h: previous,
      return24h: (price / previous - 1) * 100,
      volumeUsd24h: volume,
      oiUsd: null,
      asOf,
    });
  }
  if (!out.length) throw Error('Binance returned no valid, recent perpetual market quotes');
  return out;
}
async function hyperMarkets(): Promise<Market[]> {
  const [meta, contexts] = await hyper<HyperInfo>({ type: 'metaAndAssetCtxs' });
  const quotes = new Map<string, PerpetualQuote>();
  const asOf = Date.now(),
    out: Market[] = [];
  meta.universe.forEach((asset, i) => {
    const ctx = contexts[i];
    if (!ctx || asset.isDelisted) return;
    const price = number(ctx.markPx),
      previous = number(ctx.prevDayPx),
      volume = nonnegative(ctx.dayNtlVlm),
      oi = nonnegative(ctx.openInterest);
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(previous) ||
      previous <= 0 ||
      volume === null
    )
      return;
    quotes.set(
      `hyperliquid:${asset.name}`,
      makePerpetualQuote(
        `hyperliquid:${asset.name}`,
        price,
        ctx.oraclePx,
        ctx.funding,
        1,
        (Math.floor(asOf / 3600_000) + 1) * 3600_000,
        asOf,
      ),
    );
    out.push({
      id: `hyperliquid:${asset.name}`,
      venue: 'hyperliquid',
      priceBasis: 'mark',
      timestampBasis: 'received',
      symbol: asset.name,
      base: asset.name,
      price,
      previous24h: previous,
      return24h: (price / previous - 1) * 100,
      volumeUsd24h: volume,
      oiUsd: oi === null ? null : oi * price,
      asOf,
    });
  });
  if (!out.length) throw Error('Hyperliquid returned no valid perpetual market quotes');
  // Keep detail fields off the high-frequency market-list response.
  hyperPerpetuals.clear();
  for (const [id, quote] of quotes) hyperPerpetuals.set(id, quote);
  return out;
}

type VenueState = {
  assets: Market[];
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  retryAt: number;
  error?: string;
  pending?: Promise<void>;
};
const feeds: Record<Venue, VenueState> = {
  binance: { assets: [], lastSuccessAt: null, lastAttemptAt: null, retryAt: 0 },
  hyperliquid: { assets: [], lastSuccessAt: null, lastAttemptAt: null, retryAt: 0 },
};
async function refreshVenue(venue: Venue) {
  const state = feeds[venue];
  if (state.pending) return state.pending;
  if (Date.now() < state.retryAt) return;
  state.lastAttemptAt = Date.now();
  state.pending = (async () => {
    try {
      state.assets = await (venue === 'binance' ? binanceMarkets() : hyperMarkets());
      state.lastSuccessAt = Date.now();
      state.error = undefined;
      state.retryAt = Date.now() + TTL.marketRefresh;
    } catch (error) {
      state.error = error instanceof Error ? error.message : 'Market feed failed';
      // Respect bans and throttles. A previously obtained snapshot retains its original age.
      state.retryAt =
        Date.now() +
        (error instanceof UpstreamError && [418, 429, 451].includes(error.status) ? 60_000 : 15_000);
    }
  })().finally(() => {
    state.pending = undefined;
  });
  return state.pending;
}
export async function marketSnapshot(): Promise<MarketSnapshot> {
  await Promise.all([refreshVenue('binance'), refreshVenue('hyperliquid')]);
  return cachedMarketSnapshot();
}
/** Read current ages/status without initiating exchange requests (e.g. health probes). */
export function cachedMarketSnapshot(): MarketSnapshot {
  const now = Date.now(),
    assets: Market[] = [],
    status: FeedStatus[] = [];
  for (const venue of ['binance', 'hyperliquid'] as const) {
    const state = feeds[venue];
    const age = state.lastSuccessAt === null ? null : now - state.lastSuccessAt;
    const usable = age !== null && age <= TTL.stale;
    if (usable) assets.push(...state.assets);
    status.push({
      venue,
      status: !usable ? 'unavailable' : state.error || age! > TTL.markets ? 'stale' : 'live',
      lastSuccessAt: state.lastSuccessAt,
      lastAttemptAt: state.lastAttemptAt,
      ageMs: age,
      markets: usable ? state.assets.length : 0,
      message: state.error ?? (!usable ? 'No current snapshot' : undefined),
    });
  }
  assets.sort((a, b) => b.volumeUsd24h - a.volumeUsd24h);
  return {
    assets,
    feeds: status,
    asOf: assets.length ? Math.min(...assets.map((x) => x.asOf)) : null,
    checkedAt: now,
  };
}
export async function markets(): Promise<Market[]> {
  return (await marketSnapshot()).assets;
}
export async function freshMarkets(): Promise<Market[]> {
  const snapshot = await marketSnapshot();
  const fresh = new Set(snapshot.feeds.filter((x) => x.status === 'live').map((x) => x.venue));
  return snapshot.assets.filter((x) => fresh.has(x.venue));
}
export function assetIdentity(id: string): { venue: Venue; symbol: string } {
  const match = /^(binance|hyperliquid):([A-Za-z0-9_]{1,32})$/.exec(id);
  if (!match) throw Error('Invalid asset identifier');
  return { venue: match[1] as Venue, symbol: match[2]! };
}
/** Reject corrupted, duplicated, missing and obsolete closed candles before analytics. */
export function validateCandles(
  raw: Candle[],
  interval: string,
  now = Date.now(),
  venue: Venue = 'binance',
): Candle[] {
  assertInterval('binance', interval);
  const vendorMonth = venue === 'hyperliquid' && interval === '1M';
  const nextOpen = (bar: Candle) => (vendorMonth ? bar.closeTime! + 1 : nextCandleStart(bar.time, interval));
  const sorted = [...raw].sort((a, b) => a.time - b.time);
  for (const bar of sorted) {
    if (
      ![bar.time, bar.open, bar.high, bar.low, bar.close, bar.volumeBase, bar.volumeUsd, bar.closeTime].every(
        (x) => typeof x === 'number' && Number.isFinite(x),
      ) ||
      !Number.isSafeInteger(bar.time) ||
      bar.time < 0 ||
      Math.min(bar.open, bar.high, bar.low, bar.close) <= 0 ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.volumeBase < 0 ||
      bar.volumeUsd < 0 ||
      bar.closeTime! < bar.time ||
      (vendorMonth
        ? bar.closeTime! - bar.time + 1 < 28 * 86400_000 || bar.closeTime! - bar.time + 1 > 31 * 86400_000
        : Math.abs(bar.closeTime! - nextCandleStart(bar.time, interval)) > 1)
    )
      throw Error('Invalid upstream candle data');
  }
  const closed = sorted.filter((x) => x.closeTime! < now);
  for (let i = 1; i < closed.length; i++) {
    if (closed[i]!.time !== nextOpen(closed[i - 1]!))
      throw Error('Missing or duplicate completed candles; analytics withheld');
  }
  const last = closed.at(-1);
  if (!last) throw Error('No completed candles available');
  const expectedNextClose = vendorMonth
    ? nextOpen(last) + (nextOpen(last) - last.time)
    : nextCandleStart(nextOpen(last), interval);
  if (now >= expectedNextClose + 5_000) throw Error('Stale candle history; analytics withheld');
  return closed;
}
export async function candles(assetId: string, interval: string, limit = 140): Promise<Candle[]> {
  const { venue, symbol } = assetIdentity(assetId);
  assertInterval(venue, interval);
  if (!Number.isSafeInteger(limit) || limit < 20 || limit > 300) throw Error('Limit must be 20–300');
  const key = `candles:${assetId}:${interval}:${limit}`;
  const fetchSeries = async () => {
    let out: Candle[];
    if (venue === 'binance') {
      type Kline = [number, string, string, string, string, string, number, string];
      const raw = await getJson<Kline[]>(
        `${BINANCE}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit + 1}`,
      );
      out = raw.map((k) => ({
        time: k[0],
        open: number(k[1]),
        high: number(k[2]),
        low: number(k[3]),
        close: number(k[4]),
        volumeBase: number(k[5]),
        volumeUsd: number(k[7]),
        closeTime: k[6],
      }));
    } else {
      type HLCandle = { t: number; T: number; o: string; h: string; l: string; c: string; v: string };
      const raw = await hyper<HLCandle[]>({
        type: 'candleSnapshot',
        req: {
          coin: symbol,
          interval,
          startTime: Date.now() - (limit + 4) * intervalDurationMs(interval),
          endTime: Date.now(),
        },
      });
      out = raw.map((x) => ({
        time: x.t,
        closeTime: x.T,
        open: number(x.o),
        high: number(x.h),
        low: number(x.l),
        close: number(x.c),
        volumeBase: number(x.v),
        volumeUsd: (number(x.v) * (number(x.o) + number(x.c))) / 2,
      }));
    }
    return validateCandles(out, interval, Date.now(), venue).slice(-limit);
  };
  const series = await cache.get(key, TTL.history, fetchSeries);
  // A closed-only cached sample can expire at a candle boundary before its TTL.
  // Refetch it; never promote a cached, unfinished snapshot to a completed bar.
  try { return validateCandles(series, interval, Date.now(), venue); }
  catch (error) {
    if (!(error instanceof Error) || error.message !== 'Stale candle history; analytics withheld') throw error;
    cache.invalidate(key);
    return validateCandles(await cache.get(key, TTL.history, fetchSeries), interval, Date.now(), venue);
  }
}
export async function enrichedOpenInterest(assetId: string): Promise<number | null> {
  const { venue, symbol } = assetIdentity(assetId);
  if (venue === 'hyperliquid') return (await freshMarkets()).find((x) => x.id === assetId)?.oiUsd ?? null;
  try {
    return await cache.get(`oi:${assetId}`, TTL.markets, async () => {
      const [oi, mark] = await Promise.all([
        getJson<{ openInterest: string; time: number }>(`${BINANCE}/fapi/v1/openInterest?symbol=${symbol}`),
        binancePremium(symbol),
      ]);
      const base = nonnegative(oi.openInterest),
        price = number(mark?.markPrice);
      if (
        base === null ||
        !Number.isFinite(price) ||
        price <= 0 ||
        ![oi.time, mark?.time].every(
          (t) => typeof t === 'number' && Number.isFinite(t) && Math.abs(Date.now() - t) < 120_000,
        )
      )
        throw Error('Invalid or stale open interest');
      return base * price;
    });
  } catch {
    return null;
  }
}

type BinancePremium = {
  markPrice: string;
  indexPrice?: string;
  lastFundingRate?: string;
  nextFundingTime?: number;
  time: number;
};
function positive(value: unknown): number | null {
  const n = number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function makePerpetualQuote(
  assetId: string,
  mark: unknown,
  reference: unknown,
  funding: unknown,
  intervalHours: number | null,
  next: unknown,
  asOf: number,
): PerpetualQuote {
  const hyperliquid = assetId.startsWith('hyperliquid:');
  const markPrice = positive(mark),
    referencePrice = positive(reference),
    rate = number(funding);
  const nextTime = positive(next);
  const premiumPct =
    markPrice !== null && referencePrice !== null ? (markPrice / referencePrice - 1) * 100 : NaN;
  const validNext = nextTime !== null && Number.isSafeInteger(nextTime) && nextTime > asOf;
  return {
    assetId,
    status: Date.now() - asOf > TTL.markets ? 'stale' : 'live',
    markPrice,
    referencePrice,
    referenceKind: hyperliquid ? 'oracle' : 'index',
    premiumPct: Number.isFinite(premiumPct) ? premiumPct : null,
    fundingRate: Number.isFinite(rate) && Math.abs(rate) <= 1 ? rate : null,
    intervalHours,
    nextFundingAt: validNext ? nextTime : null,
    nextFundingSource: validNext ? (hyperliquid ? 'hourly_schedule' : 'exchange') : null,
    asOf,
    timestampBasis: hyperliquid ? 'received' : 'exchange',
  };
}
function unavailablePerpetual(assetId: string): PerpetualQuote {
  return {
    assetId,
    status: 'unavailable',
    markPrice: null,
    referencePrice: null,
    referenceKind: assetId.startsWith('hyperliquid:') ? 'oracle' : 'index',
    premiumPct: null,
    fundingRate: null,
    intervalHours: null,
    nextFundingAt: null,
    nextFundingSource: null,
    asOf: null,
    timestampBasis: assetId.startsWith('hyperliquid:') ? 'received' : 'exchange',
  };
}
// Cache failures too, so multiple views / clients cannot bypass upstream bans.
const premiumRequests = new Map<
  string,
  { retryAt: number; value: BinancePremium | null; pending?: Promise<BinancePremium | null> }
>();
async function binancePremium(symbol: string): Promise<BinancePremium | null> {
  let state = premiumRequests.get(symbol);
  if (!state) {
    if (premiumRequests.size >= 128) {
      const evict = [...premiumRequests].find(([, value]) => !value.pending);
      if (!evict) return null;
      premiumRequests.delete(evict[0]);
    }
    state = { retryAt: 0, value: null };
    premiumRequests.set(symbol, state);
  }
  if (state.pending) return state.pending;
  if (Date.now() < state.retryAt) return state.value;
  const current = state;
  current.pending = (async () => {
    try {
      const result = await getJson<BinancePremium>(`${BINANCE}/fapi/v1/premiumIndex?symbol=${symbol}`);
      if (
        !positive(result.markPrice) ||
        !Number.isSafeInteger(result.time) ||
        Math.abs(Date.now() - result.time) > 120_000
      )
        throw Error('Invalid or stale mark quote');
      current.value = result;
      current.retryAt = Date.now() + TTL.marketRefresh;
    } catch (error) {
      current.value = null;
      current.retryAt =
        Date.now() +
        (error instanceof UpstreamError && [418, 429, 451].includes(error.status) ? 60_000 : 15_000);
    }
    return current.value;
  })().finally(() => {
    current.pending = undefined;
  });
  return current.pending;
}
async function binanceFundingIntervals(): Promise<Map<string, number> | null> {
  // fundingInfo lists adjustments only: absent symbols use the documented 8h
  // default, but ONLY after a successful, validated metadata response.
  return cache.get('funding-intervals', 60_000, async () => {
    try {
      const raw = await getJson<Array<{ symbol: string; fundingIntervalHours: number }>>(
        `${BINANCE}/fapi/v1/fundingInfo`,
      );
      if (
        !Array.isArray(raw) ||
        raw.some(
          (x) =>
            !x ||
            typeof x.symbol !== 'string' ||
            !Number.isInteger(x.fundingIntervalHours) ||
            x.fundingIntervalHours < 1 ||
            x.fundingIntervalHours > 24,
        )
      )
        return null;
      return new Map(raw.map((x) => [x.symbol, x.fundingIntervalHours]));
    } catch {
      return null;
    }
  });
}
export async function perpetualQuote(assetId: string): Promise<PerpetualQuote> {
  const { venue, symbol } = assetIdentity(assetId);
  const snapshot = await marketSnapshot();
  const asset = snapshot.assets.find((x) => x.id === assetId);
  if (!asset) return unavailablePerpetual(assetId);
  if (venue === 'hyperliquid') {
    const quote = hyperPerpetuals.get(assetId);
    if (!quote) return unavailablePerpetual(assetId);
    const live = snapshot.feeds.find((x) => x.venue === venue)?.status === 'live';
    return { ...quote, status: live ? 'live' : 'stale' };
  }
  const [premium, intervals] = await Promise.all([binancePremium(symbol), binanceFundingIntervals()]);
  if (!premium) return unavailablePerpetual(assetId);
  return makePerpetualQuote(
    assetId,
    premium.markPrice,
    premium.indexPrice,
    premium.lastFundingRate,
    intervals === null ? null : (intervals.get(symbol) ?? 8),
    premium.nextFundingTime,
    premium.time,
  );
}
