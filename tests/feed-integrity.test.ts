import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestCache } from '../server/cache.ts';
import { validateCandles, assetIdentity } from '../server/market.ts';
import { nextCandleStart } from '../src/engine/intervals.ts';
import { liqSummary } from '../server/liquidations.ts';
import type { Candle } from '../src/types.ts';

const now = Date.UTC(2026, 9, 19, 12, 30);
const closed = (n = 80): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const time = Date.UTC(2026, 9, 19, 12) - (n - i) * 3600_000;
    return {
      time,
      closeTime: time + 3600_000 - 1,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volumeBase: 5,
      volumeUsd: 505,
    };
  });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('completed candle integrity', () => {
  it('drops the active candle and sorts valid history', () => {
    const bars = closed();
    const current = {
      ...bars.at(-1)!,
      time: Date.UTC(2026, 9, 19, 12),
      closeTime: Date.UTC(2026, 9, 19, 13) - 1,
    };
    expect(validateCandles([current, ...bars.reverse()], '1h', now)).toHaveLength(80);
  });
  it.each(['gap', 'duplicate', 'invalid', 'negative volume', 'stale', 'wrong close time'])(
    'rejects %s history',
    (defect) => {
      const bars = closed();
      if (defect === 'gap') bars.splice(25, 1);
      if (defect === 'duplicate') bars.push({ ...bars[5]! });
      if (defect === 'invalid') bars[3]!.close = NaN;
      if (defect === 'negative volume') bars[3]!.volumeBase = -1;
      if (defect === 'stale') bars.splice(-2);
      if (defect === 'wrong close time') bars[3]!.closeTime! -= 500;
      expect(() => validateCandles(bars, '1h', now)).toThrow();
    },
  );
  it('handles calendar month boundaries including leap years', () => {
    expect(nextCandleStart(Date.UTC(2024, 1, 1), '1M')).toBe(Date.UTC(2024, 2, 1));
    expect(nextCandleStart(Date.UTC(2025, 11, 1), '1M')).toBe(Date.UTC(2026, 0, 1));
  });
  it('uses upstream Hyperliquid monthly boundaries instead of forcing calendar months', () => {
    const start = Date.UTC(2026, 8, 4);
    const monthly = Array.from({ length: 2 }, (_, i) => ({
      ...closed(1)[0]!,
      time: start + i * 30 * 86400_000,
      closeTime: start + (i + 1) * 30 * 86400_000 - 1,
    }));
    expect(validateCandles(monthly, '1M', start + 65 * 86400_000, 'hyperliquid')).toHaveLength(2);
    expect(() => validateCandles(monthly, '1M', start + 65 * 86400_000, 'binance')).toThrow();
  });
  it('does not silently accept extra asset delimiters', () => {
    expect(() => assetIdentity('binance:BTCUSDT:ignored')).toThrow();
  });
  it('reports missing liquidation coverage as unknown, not zero', () => {
    expect(liqSummary('hyperliquid:BTC').observedUsd).toBeNull();
    expect(liqSummary('hyperliquid:BTC').coverage).toBe('unavailable');
    expect(liqSummary('binance:BTCUSDT').observedUsd).toBeNull();
  });
});

describe('bounded request cache', () => {
  it('coalesces concurrent work and never returns expired data on an upstream failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const cache = new RequestCache(2),
      work = vi.fn(async () => 4);
    expect(await Promise.all([cache.get('x', 100, work), cache.get('x', 100, work)])).toEqual([4, 4]);
    expect(work).toHaveBeenCalledTimes(1);
    vi.setSystemTime(now + 101);
    await expect(
      cache.get('x', 100, async () => {
        throw Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await cache.get('x', 100, async () => 9)).toBe(9);
  });
  it('evicts old keys instead of growing forever', async () => {
    const cache = new RequestCache(2),
      work = vi.fn(async () => 1);
    await cache.get('a', 10000, work);
    await cache.get('b', 10000, work);
    await cache.get('c', 10000, work);
    await cache.get('a', 10000, work);
    expect(work).toHaveBeenCalledTimes(4);
  });
});

describe('venue snapshots', () => {
  async function fixture() {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let failBinance = false;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('binance') && failBinance) return Response.json({ msg: 'blocked' }, { status: 451 });
      if (url.endsWith('exchangeInfo'))
        return Response.json({
          symbols: [
            {
              symbol: 'BTCUSDT',
              baseAsset: 'BTC',
              quoteAsset: 'USDT',
              contractType: 'PERPETUAL',
              status: 'TRADING',
            },
          ],
        });
      if (url.endsWith('ticker/24hr'))
        return Response.json([
          {
            symbol: 'BTCUSDT',
            lastPrice: '101',
            openPrice: '100',
            priceChangePercent: '1',
            quoteVolume: '10000000',
            closeTime: Date.now(),
          },
        ]);
      return Response.json([
        { universe: [{ name: 'BTC' }] },
        [{ markPx: '102', prevDayPx: '100', dayNtlVlm: '10000000', openInterest: '400' }],
      ]);
    });
    vi.stubGlobal('fetch', fetchMock);
    return {
      market: await import('../server/market.ts'),
      fetchMock,
      fail: () => {
        failBinance = true;
      },
    };
  }
  it('preserves old timestamps on partial failure, retries with backoff, and eventually removes obsolete rows', async () => {
    const { market, fetchMock, fail } = await fixture();
    const first = await market.marketSnapshot();
    expect(first.feeds.map((x) => x.status)).toEqual(['live', 'live']);
    expect(first.assets.find((x) => x.venue === 'hyperliquid')!.oiUsd).toBe(40800);
    fail();
    vi.setSystemTime(now + 46_000);
    const stale = await market.marketSnapshot();
    expect(stale.feeds[0]).toMatchObject({ status: 'stale', lastSuccessAt: now, ageMs: 46_000 });
    expect(stale.feeds[0]!.message).toContain('HTTP 451');
    expect(stale.feeds[1]!.status).toBe('live');
    const calls = fetchMock.mock.calls.length;
    await market.marketSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect((await market.freshMarkets()).map((x) => x.venue)).toEqual(['hyperliquid']);
    vi.setSystemTime(now + 16 * 60_000);
    const expired = await market.marketSnapshot();
    expect(expired.feeds[0]!.status).toBe('unavailable');
    expect(expired.assets.some((x) => x.venue === 'binance')).toBe(false);
  });
  it('refreshes quotes on the next 10-second poll while coalescing concurrent requests', async () => {
    const { market, fetchMock } = await fixture();
    const initial = await market.marketSnapshot();
    expect(initial.feeds.every((feed) => feed.lastSuccessAt === now)).toBe(true);
    const calls = fetchMock.mock.calls.length;
    vi.setSystemTime(now + 4_999);
    expect((await market.marketSnapshot()).feeds[0]!.lastSuccessAt).toBe(now);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    vi.setSystemTime(now + 10_000);
    const snapshots = await Promise.all(Array.from({ length: 8 }, () => market.marketSnapshot()));
    expect(snapshots.every((snapshot) => snapshot.feeds.every((feed) => feed.lastSuccessAt === now + 10_000))).toBe(true);
    // One request per venue, with exchange metadata still cached across polls.
    expect(fetchMock).toHaveBeenCalledTimes(calls + 2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('exchangeInfo'))).toHaveLength(1);
  });
  it('does not let faster polling bypass upstream rate-limit backoff or reset snapshot age', async () => {
    const { market, fetchMock } = await fixture();
    await market.marketSnapshot();
    const fetchDefault = fetchMock.getMockImplementation()!;
    let limited = true;
    fetchMock.mockImplementation(async (input) =>
      String(input).includes('binance') && limited
        ? Response.json({ msg: 'rate limited' }, { status: 429 })
        : fetchDefault(input),
    );
    vi.setSystemTime(now + 10_000);
    const failed = await market.marketSnapshot();
    expect(failed.feeds[0]).toMatchObject({ status: 'stale', lastSuccessAt: now, ageMs: 10_000 });
    const binanceCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('binance')).length;
    const attempts = binanceCalls();
    for (let seconds = 20; seconds < 70; seconds += 10) {
      vi.setSystemTime(now + seconds * 1000);
      const snapshot = await market.marketSnapshot();
      expect(snapshot.feeds[0]!.lastSuccessAt).toBe(now);
      expect(snapshot.feeds[0]!.status).toBe('stale');
    }
    expect(binanceCalls()).toBe(attempts);
    limited = false;
    vi.setSystemTime(now + 70_000);
    const recovered = await market.marketSnapshot();
    expect(recovered.feeds[0]).toMatchObject({ status: 'live', lastSuccessAt: now + 70_000 });
    expect(binanceCalls()).toBe(attempts + 1);
  });
  it('keeps a fresh 451 failure visible even when the other venue works', async () => {
    const { market, fail } = await fixture();
    fail();
    const result = await market.marketSnapshot();
    expect(result.assets).toHaveLength(1);
    expect(result.feeds[0]!.status).toBe('unavailable');
    expect(result.feeds[0]!.lastSuccessAt).toBeNull();
  });
  it('does not convert missing Hyperliquid OI into zero', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', async (input: string) =>
      input.includes('binance')
        ? Response.json({}, { status: 451 })
        : Response.json([
            { universe: [{ name: 'BTC' }] },
            [{ markPx: '100', prevDayPx: '100', dayNtlVlm: '500', openInterest: null }],
          ]),
    );
    const { marketSnapshot } = await import('../server/market.ts');
    expect((await marketSnapshot()).assets[0]!.oiUsd).toBeNull();
  });
  it('refreshes without clients or alerts, starts only once, and health reads never fetch', async () => {
    const { market, fetchMock } = await fixture();
    const worker = await import('../server/market-refresh.ts');
    expect(worker.marketRefreshStatus()).toMatchObject({ running: false, completedCycles: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const stop = worker.startMarketRefresh();
    try {
      expect(worker.startMarketRefresh()).toBe(stop);
      await vi.advanceTimersByTimeAsync(0);
      expect(worker.marketRefreshStatus()).toMatchObject({ running: true, completedCycles: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // No market API reads between worker cycles.
      await vi.advanceTimersByTimeAsync(30_000);
      const state = worker.marketRefreshStatus();
      expect(state).toMatchObject({ completedCycles: 4, lastCompletedAt: now + 30_000 });
      expect(state.feeds.every((feed) => feed.lastSuccessAt === now + 30_000)).toBe(true);
      expect(market.cachedMarketSnapshot().assets).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(9);
      stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(worker.marketRefreshStatus().running).toBe(false);
      expect(worker.marketRefreshStatus().feeds.every((feed) => feed.status === 'stale')).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(9);
    } finally { stop(); }
  });
  it('background refresh respects per-venue backoff and preserves failed snapshot ages', async () => {
    const { fetchMock, fail } = await fixture();
    const worker = await import('../server/market-refresh.ts');
    const stop = worker.startMarketRefresh();
    try {
      await vi.advanceTimersByTimeAsync(0);
      fail();
      await vi.advanceTimersByTimeAsync(10_000);
      const binanceCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('binance')).length;
      const attempts = binanceCalls();
      await vi.advanceTimersByTimeAsync(50_000);
      expect(binanceCalls()).toBe(attempts);
      expect(worker.marketRefreshStatus().feeds[0]).toMatchObject({ status: 'stale', lastSuccessAt: now, ageMs: 60_000 });
      expect(worker.marketRefreshStatus().feeds[1]).toMatchObject({ status: 'live', lastSuccessAt: now + 60_000 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(binanceCalls()).toBe(attempts + 1);
    } finally { stop(); }
  });
  it('does not overlap slow background cycles and recovers after an unexpected rejection', async () => {
    const { market } = await fixture();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const refresh = vi.spyOn(market, 'marketSnapshot').mockImplementationOnce(async () => {
      await pending;
      return market.cachedMarketSnapshot();
    }).mockRejectedValueOnce(Error('temporary failure')).mockResolvedValue(market.cachedMarketSnapshot());
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = await import('../server/market-refresh.ts');
    const stop = worker.startMarketRefresh();
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(worker.marketRefreshStatus()).toMatchObject({ inFlight: true, completedCycles: 0 });
      finish();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(log).toHaveBeenCalledOnce();
      expect(worker.marketRefreshStatus()).toMatchObject({ inFlight: false, completedCycles: 2 });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(refresh).toHaveBeenCalledTimes(3);
      expect(worker.marketRefreshStatus().completedCycles).toBe(3);
    } finally { finish(); stop(); }
  });
});

it('refreshes an unexpired closed-candle cache when a new candle has completed', async () => {
  vi.useFakeTimers();
  const boundary = Date.UTC(2026, 9, 25, 12, 1);
  vi.setSystemTime(boundary - 2);
  let call = 0;
  const fetcher = vi.fn(async () => {
    const shift = call++ ? 1 : 0;
    const raw = Array.from({ length: 21 }, (_, i) => {
      const time = boundary - (21 - i - shift) * 60000;
      const close = shift ? '110' : '100';
      return [time, '100', '120', '90', close, '1', time + 59999, '100'];
    });
    return Response.json(raw);
  });
  vi.stubGlobal('fetch', fetcher);
  const { candles } = await import('../server/market.ts');
  expect((await candles('binance:BOUNDARYUSDT', '1m', 20)).at(-1)!.close).toBe(100);
  vi.setSystemTime(boundary + 6000);
  const next = await candles('binance:BOUNDARYUSDT', '1m', 20);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(next.at(-1)!.time).toBe(boundary - 60000);
  expect(next.at(-1)!.close).toBe(110);
});
