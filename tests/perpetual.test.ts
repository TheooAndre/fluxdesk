import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Market } from '../src/types.ts';
import { priceBasisLabel, quoteAge, relativeToBenchmark } from '../src/lib/market-quality.ts';

const now = Date.UTC(2026, 9, 23, 12, 30);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function fixture(
  options: {
    premium?: object;
    fundingInfo?: unknown;
    metadataStatus?: number;
    premiumStatus?: number;
    hyper?: object;
  } = {},
) {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const fetchMock = vi.fn(async (input: string) => {
    const url = String(input);
    if (url.endsWith('/exchangeInfo'))
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
    if (url.endsWith('/ticker/24hr'))
      return Response.json([
        {
          symbol: 'BTCUSDT',
          lastPrice: '100',
          openPrice: '95',
          quoteVolume: '1000000',
          closeTime: Date.now(),
        },
      ]);
    if (url.includes('/premiumIndex'))
      return Response.json(
        options.premium ?? {
          markPrice: '101',
          indexPrice: '100',
          lastFundingRate: '-0.0002',
          nextFundingTime: now + 3600_000,
          time: now,
        },
        { status: options.premiumStatus ?? 200 },
      );
    if (url.endsWith('/fundingInfo'))
      return Response.json(options.fundingInfo ?? [{ symbol: 'BTCUSDT', fundingIntervalHours: 4 }], {
        status: options.metadataStatus ?? 200,
      });
    if (url.includes('/openInterest')) return Response.json({ openInterest: '5', time: Date.now() });
    if (url.includes('hyperliquid'))
      return Response.json([
        { universe: [{ name: 'BTC' }] },
        [
          {
            markPx: '102',
            oraclePx: '100',
            funding: '0.0000125',
            prevDayPx: '100',
            dayNtlVlm: '1000000',
            openInterest: '10',
            ...options.hyper,
          },
        ],
      ]);
    throw Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { market: await import('../server/market.ts'), fetchMock };
}
describe('venue price and funding integrity', () => {
  it('keeps last trade distinct from mark and labels exchange vs receipt time', async () => {
    const { market } = await fixture();
    const assets = (await market.marketSnapshot()).assets;
    expect(assets.find((x) => x.venue === 'binance')).toMatchObject({
      price: 100,
      priceBasis: 'last',
      timestampBasis: 'exchange',
      asOf: now,
    });
    expect(assets.find((x) => x.venue === 'hyperliquid')).toMatchObject({
      price: 102,
      priceBasis: 'mark',
      timestampBasis: 'received',
      asOf: now,
    });
  });
  it('uses the adjusted Binance interval and calculates premium from mark/index', async () => {
    const { market } = await fixture();
    const quote = await market.perpetualQuote('binance:BTCUSDT');
    expect(quote).toMatchObject({
      status: 'live',
      markPrice: 101,
      referencePrice: 100,
      fundingRate: -0.0002,
      intervalHours: 4,
      referenceKind: 'index',
      nextFundingAt: now + 3600_000,
      nextFundingSource: 'exchange',
      asOf: now,
    });
    expect(quote.premiumPct).toBeCloseTo(1);
  });
  it('uses the documented default only when interval metadata is valid and successful', async () => {
    const { market } = await fixture({ fundingInfo: [] });
    expect((await market.perpetualQuote('binance:BTCUSDT')).intervalHours).toBe(8);
  });
  it.each([
    { fundingInfo: {} },
    { fundingInfo: [{ symbol: 'BTCUSDT', fundingIntervalHours: 0 }] },
    { metadataStatus: 429 },
  ])('does not invent an interval on failed or malformed metadata: %j', async (options) => {
    const { market, fetchMock } = await fixture(options);
    expect(await market.perpetualQuote('binance:BTCUSDT')).toMatchObject({
      intervalHours: null,
      markPrice: 101,
    });
    vi.setSystemTime(now + 10_000);
    await market.perpetualQuote('binance:BTCUSDT');
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('fundingInfo'))).toHaveLength(1);
  });
  it('refreshes changed interval metadata after one minute', async () => {
    const { market, fetchMock } = await fixture();
    expect((await market.perpetualQuote('binance:BTCUSDT')).intervalHours).toBe(4);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url) =>
      url.endsWith('/fundingInfo')
        ? Response.json([{ symbol: 'BTCUSDT', fundingIntervalHours: 1 }])
        : original(url),
    );
    vi.setSystemTime(now + 60_000);
    expect((await market.perpetualQuote('binance:BTCUSDT')).intervalHours).toBe(1);
  });
  it('reuses Hyperliquid contexts, preserves signed hourly rates and labels schedule estimates', async () => {
    const { market, fetchMock } = await fixture({ hyper: { funding: '-0.0000125' } });
    await market.marketSnapshot();
    const calls = fetchMock.mock.calls.length;
    expect(await market.perpetualQuote('hyperliquid:BTC')).toMatchObject({
      status: 'live',
      fundingRate: -0.0000125,
      intervalHours: 1,
      referenceKind: 'oracle',
      referencePrice: 100,
      nextFundingAt: Date.UTC(2026, 9, 23, 13),
      nextFundingSource: 'hourly_schedule',
      timestampBasis: 'received',
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('keeps missing and corrupt reference prices / rates unknown instead of treating them as zero', async () => {
    const { market } = await fixture({
      hyper: { oraclePx: null, funding: '' },
      premium: {
        markPrice: '101',
        indexPrice: 'NaN',
        lastFundingRate: 'Infinity',
        nextFundingTime: now - 1,
        time: now,
      },
    });
    for (const asset of ['binance:BTCUSDT', 'hyperliquid:BTC']) {
      expect(await market.perpetualQuote(asset)).toMatchObject({
        referencePrice: null,
        fundingRate: null,
        premiumPct: null,
      });
    }
    expect(await market.perpetualQuote('binance:BTCUSDT')).toMatchObject({
      nextFundingAt: null,
      nextFundingSource: null,
    });
  });
  it('preserves a genuine zero funding rate', async () => {
    const { market } = await fixture({ hyper: { funding: '0' } });
    expect((await market.perpetualQuote('hyperliquid:BTC')).fundingRate).toBe(0);
  });
  it('coalesces concurrent mark / funding / OI requests', async () => {
    const { market, fetchMock } = await fixture();
    await Promise.all([
      market.enrichedOpenInterest('binance:BTCUSDT'),
      ...Array.from({ length: 8 }, () => market.perpetualQuote('binance:BTCUSDT')),
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('premiumIndex'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('fundingInfo'))).toHaveLength(1);
  });
  it.each([418, 429, 451])(
    'backs off HTTP %s without relabeling a previous quote as fresh',
    async (status) => {
      const { market, fetchMock } = await fixture();
      await market.perpetualQuote('binance:BTCUSDT');
      const original = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (url) =>
        url.includes('premiumIndex') ? Response.json({}, { status }) : original(url),
      );
      vi.setSystemTime(now + 10_000);
      expect(await market.perpetualQuote('binance:BTCUSDT')).toMatchObject({
        status: 'unavailable',
        fundingRate: null,
        asOf: null,
      });
      for (let seconds = 20; seconds < 70; seconds += 10) {
        vi.setSystemTime(now + seconds * 1000);
        await market.perpetualQuote('binance:BTCUSDT');
      }
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('premiumIndex'))).toHaveLength(2);
      vi.setSystemTime(now + 70_000);
      await market.perpetualQuote('binance:BTCUSDT');
      expect(fetchMock.mock.calls.filter(([url]) => url.includes('premiumIndex'))).toHaveLength(3);
    },
  );
  it('rejects stale Binance mark timestamps and unknown contracts', async () => {
    const { market, fetchMock } = await fixture({ premium: { markPrice: '100', time: now - 121_000 } });
    expect((await market.perpetualQuote('binance:BTCUSDT')).status).toBe('unavailable');
    const calls = fetchMock.mock.calls.length;
    expect((await market.perpetualQuote('binance:UNKNOWN')).status).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('retains Hyperliquid receipt time on failure, marks data stale, then removes expired data', async () => {
    const { market, fetchMock } = await fixture();
    await market.perpetualQuote('hyperliquid:BTC');
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url) =>
      url.includes('hyperliquid') ? Response.json({}, { status: 429 }) : original(url),
    );
    vi.setSystemTime(now + 10_000);
    expect(await market.perpetualQuote('hyperliquid:BTC')).toMatchObject({ status: 'stale', asOf: now });
    vi.setSystemTime(now + 901_000);
    expect(await market.perpetualQuote('hyperliquid:BTC')).toMatchObject({
      status: 'unavailable',
      asOf: null,
      fundingRate: null,
    });
  });
});
describe('comparison eligibility', () => {
  const last = { priceBasis: 'last', return24h: 10 } as Market;
  const mark = { priceBasis: 'mark', return24h: 5 } as Market;
  it('rejects mixed / unknown bases but permits cash and matching bases', () => {
    expect(relativeToBenchmark(last, mark, false)).toBeNull();
    expect(relativeToBenchmark({ return24h: 10 } as Market, last, false)).toBeNull();
    expect(relativeToBenchmark(last, null, false)).toBeNull();
    expect(relativeToBenchmark(last, null, true)).toBeCloseTo(10);
    expect(relativeToBenchmark(last, { ...last, return24h: 5 }, false)).toBeCloseTo(4.76190476);
    expect(priceBasisLabel({} as Market)).toBe('Basis unknown');
    expect(quoteAge(now, now + 65_000)).toBe('1m 5s old');
    expect(quoteAge(null, now)).toBe('Age unknown');
  });
});
