import { beforeEach, afterEach, it, expect, vi } from 'vitest';
let data: typeof import('../server/stock-data.ts');
let badSummary = false,
  badChart = false,
  failedNews = false;
let mock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  badSummary = false;
  badChart = false;
  failedNews = false;
  mock = vi.fn(async (raw: string | URL) => {
    const url = new URL(raw);
    if (url.hostname === 'fc.yahoo.com')
      return new Response('', {
        status: 404,
        headers: { 'set-cookie': 'A3=anonymous-test-cookie; Path=/; Secure' },
      });
    if (url.pathname.includes('getcrumb')) return new Response('test-crumb');
    if (url.pathname.includes('/search'))
      return Response.json({
        quotes: [
          {
            symbol: '7203.T',
            longname: 'Toyota Motor',
            exchDisp: 'Tokyo',
            quoteType: 'EQUITY',
            sector: 'Consumer Cyclical',
          },
          { symbol: 'TM', longname: 'Toyota ADR', exchDisp: 'NYSE', quoteType: 'EQUITY' },
          { symbol: 'JPY=X', shortname: 'Yen', quoteType: 'CURRENCY' },
          { symbol: '7203.T', longname: 'Duplicate', quoteType: 'EQUITY' },
        ],
      });
    if (url.pathname.includes('/chart'))
      return Response.json({
        chart: {
          result: [
            {
              meta: {
                symbol: badChart ? 'DIFFERENT' : '7203.T',
                longName: 'Toyota Motor',
                fullExchangeName: 'Tokyo',
                currency: 'JPY',
                instrumentType: 'EQUITY',
                regularMarketPrice: 3000,
                regularMarketTime: Math.floor(Date.now() / 1000) - 120,
                fiftyTwoWeekHigh: 3400,
                fiftyTwoWeekLow: 2000,
              },
              timestamp: [Math.floor(Date.now() / 1000) - 86400, Math.floor(Date.now() / 1000) - 120],
              indicators: { quote: [{ close: [2900, 3000] }] },
            },
          ],
        },
      });
    if (url.pathname.includes('quoteSummary'))
      return badSummary
        ? new Response('', { status: 401 })
        : Response.json({
            quoteSummary: {
              result: [
                {
                  assetProfile: {
                    country: 'Japan',
                    sector: 'Consumer Cyclical',
                    industry: 'Auto',
                    website: 'https://global.toyota/',
                    longBusinessSummary: 'Makes cars',
                  },
                  summaryDetail: {
                    marketCap: { raw: 300000000 },
                    trailingPE: { raw: 12 },
                    previousClose: { raw: 2900 },
                  },
                  financialData: {
                    targetMeanPrice: { raw: 3200 },
                    numberOfAnalystOpinions: { raw: 20 },
                    recommendationKey: 'buy',
                  },
                },
              ],
            },
          });
    if (url.hostname === 'feeds.finance.yahoo.com')
      return failedNews
        ? new Response('', { status: 503 })
        : new Response(
            `<rss><channel><item><title>Toyota &amp; demand</title><link>https://finance.yahoo.com/news/toyota</link><pubDate>${new Date(Date.now() - 60000).toUTCString()}</pubDate></item><item><title>Unsafe</title><link>javascript:alert(1)</link><pubDate>Fri, 13 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
          );
    throw Error('Unexpected provider URL');
  });
  vi.stubGlobal('fetch', mock);
  data = await import('../server/stock-data.ts');
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it('matches actual stock listings separately by exchange, excludes other asset classes and deduplicates', async () => {
  const r = await data.searchStocks('Toyota');
  expect(r.matches.map((s) => s.symbol)).toEqual(['7203.T', 'TM']);
  await data.searchStocks('toyota');
  expect(mock).toHaveBeenCalledTimes(1);
  await expect(data.searchStocks('x'.repeat(101))).rejects.toMatchObject({ status: 400 });
});
it('returns native-currency quotes, dated history, fundamentals and safe stock-specific news without leaking provider credentials', async () => {
  const r = await data.stockData('7203.T');
  expect(r).toMatchObject({
    symbol: '7203.T',
    currency: 'JPY',
    country: 'Japan',
    price: 3000,
    marketCap: 300000000,
    trailingPE: 12,
    targetMean: 3200,
    issues: [],
  });
  expect(r.changePercent).toBeCloseTo(100 * (3000 / 2900 - 1));
  expect(r.history).toHaveLength(2);
  expect(r.news).toHaveLength(1);
  expect(r.news[0]?.title).toBe('Toyota & demand');
  expect(JSON.stringify(r)).not.toMatch(/test-crumb|anonymous-test-cookie/);
  const count = mock.mock.calls.length;
  await data.stockData('7203.T');
  expect(mock).toHaveBeenCalledTimes(count);
});
it('keeps the verified quote available when optional fundamentals or news fail', async () => {
  badSummary = true;
  failedNews = true;
  const r = await data.stockData('7203.T');
  expect(r.price).toBe(3000);
  expect(r.marketCap).toBeNull();
  expect(r.news).toEqual([]);
  expect(r.issues).toEqual(['Fundamentals unavailable', 'News unavailable']);
});
it('rejects arbitrary URLs, unsupported symbols, mismatched identities and provider outages', async () => {
  await expect(data.stockData('https://localhost')).rejects.toMatchObject({ status: 400 });
  expect(mock).not.toHaveBeenCalled();
  badChart = true;
  await expect(data.stockData('7203.T')).rejects.toMatchObject({ status: 502 });
  mock.mockResolvedValue(new Response('', { status: 429 }));
  await expect(data.searchStocks('Apple')).rejects.toThrow('HTTP 429');
});
it('retains the exact verified quote timestamp on refresh failure while optional sections remain usable; stale data cannot verify a new link', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const good = await data.stockData('7203.T');
    const original = mock.getMockImplementation() as (raw: string | URL) => Promise<Response>;
    mock.mockImplementation(async (raw: string | URL) =>
      new URL(raw).pathname.includes('/chart') ? new Response('', { status: 503 }) : original(raw),
    );
    now += 11 * 60_000;
    const partial = await data.stockData('7203.T');
    expect(partial).toMatchObject({
      quoteStale: true,
      quoteAt: good.quoteAt,
      currency: 'JPY',
      symbol: '7203.T',
      marketCap: 300000000,
    });
    expect(partial.news).toHaveLength(1);
    expect(partial.issues).toContain('Quote refresh failed · showing last verified quote');
    await expect(data.verifyStockListing('7203.T')).rejects.toThrow('fresh provider response');
  } finally {
    vi.restoreAllMocks();
  }
});
