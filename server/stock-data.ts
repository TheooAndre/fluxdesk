import { InvestmentError } from './investment-error.ts';
import { stockSymbol, type StockMatch, type StockData } from '../src/investments/market-data.ts';

type ObjectData = Record<string, unknown>;
const object = (v: unknown): ObjectData =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as ObjectData) : {};
const string = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const number = (v: unknown): number | null => {
  const raw = typeof v === 'object' ? object(v).raw : v;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
};
const safeUrl = (v: unknown) => {
  try {
    const u = new URL(string(v, 2048));
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch {
    return '';
  }
};
const Q = 'https://query1.finance.yahoo.com';
const headers = { 'user-agent': 'Mozilla/5.0', accept: 'application/json' };
// Bounded process-local caches. Only public provider data is cached; never owner memos.
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, ttl: number, task: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const promise = task()
    .then((value) => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, { until: Date.now() + ttl, value });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
async function read(url: string, extra: Record<string, string> = {}, allow404 = false) {
  const r = await fetch(url, {
    headers: { ...headers, ...extra },
    redirect: 'error',
    signal: AbortSignal.timeout(7000),
  });
  if (!r.ok && !(allow404 && r.status === 404))
    throw new InvestmentError(`Yahoo Finance unavailable (HTTP ${r.status})`, 502);
  const length = Number(r.headers.get('content-length'));
  if (length > 2_000_000) throw new InvestmentError('Market-data response too large', 502);
  const reader = r.body?.getReader();
  if (!reader) throw new InvestmentError('Empty market-data response', 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new InvestmentError('Market-data response too large', 502);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), headers: r.headers };
}
async function json(url: string, extra?: Record<string, string>) {
  try {
    return object(JSON.parse((await read(url, extra)).text));
  } catch (e) {
    if (e instanceof InvestmentError) throw e;
    throw new InvestmentError('Market-data provider did not return valid data', 502);
  }
}
export async function searchStocks(raw: string): Promise<{ matches: StockMatch[] }> {
  const q = raw.trim();
  if (q.length < 1 || q.length > 100 || Array.from(q).some((c) => c.charCodeAt(0) < 32))
    throw new InvestmentError('Enter a company or ticker');
  return cached('search:' + q.toLowerCase(), 300_000, async () => {
    const data = await json(
      Q + '/v1/finance/search?' + new URLSearchParams({ q, quotesCount: '12', newsCount: '0' }),
    );
    if (!Array.isArray(data.quotes)) throw new InvestmentError('Invalid stock-search response', 502);
    const matches: StockMatch[] = [];
    for (const raw of data.quotes) {
      const row = object(raw);
      if (!['EQUITY', 'ETF'].includes(string(row.quoteType))) continue;
      try {
        const symbol = stockSymbol(row.symbol),
          name = string(row.longname ?? row.shortname, 120);
        if (!name || matches.some((m) => m.symbol === symbol)) continue;
        matches.push({
          symbol,
          name,
          exchange: string(row.exchDisp ?? row.exchange, 60),
          type: row.quoteType as StockMatch['type'],
          sector: string(row.sector, 80),
        });
      } catch {
        /* Unsupported instrument. */
      }
    }
    return { matches };
  });
}
// Yahoo uses an anonymous cookie/crumb for fundamentals. It never leaves this process.
let session: { cookie: string; crumb: string; until: number } | undefined;
let sessionPending: Promise<NonNullable<typeof session>> | undefined;
async function anonymousSession() {
  if (session && session.until > Date.now()) return session;
  if (sessionPending) return sessionPending;
  sessionPending = (async () => {
    const initial = await read('https://fc.yahoo.com', { accept: '*/*' }, true);
    const cookie = initial.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    if (!cookie || cookie.length > 8192) throw new Error('Provider session unavailable');
    const crumb = (await read(Q + '/v1/test/getcrumb', { cookie, accept: '*/*' })).text.trim();
    if (!crumb || crumb.length > 256 || /[<>\r\n]/.test(crumb))
      throw new Error('Provider session unavailable');
    session = { cookie, crumb, until: Date.now() + 1_800_000 };
    return session;
  })().finally(() => {
    sessionPending = undefined;
  });
  return sessionPending;
}
async function fundamentals(symbol: string): Promise<ObjectData> {
  return cached('summary:' + symbol, 3_600_000, async () => {
    const { cookie, crumb } = await anonymousSession();
    let data: ObjectData;
    try {
      data = await json(
        Q +
          '/v10/finance/quoteSummary/' +
          encodeURIComponent(symbol) +
          '?' +
          new URLSearchParams({
            modules: 'assetProfile,summaryDetail,financialData,defaultKeyStatistics',
            crumb,
          }),
        { cookie },
      );
    } catch (e) {
      session = undefined;
      throw e;
    }
    const result = object(data.quoteSummary).result;
    if (!Array.isArray(result) || !result.length) throw new Error('Fundamentals unavailable');
    return object(result[0]);
  });
}
function xmlText(xml: string, tag: string) {
  return (new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)?.[1] ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[n]!,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n: string) => {
      const code = n[0]?.toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .trim();
}
async function headlines(symbol: string): Promise<StockData['news']> {
  return cached('news:' + symbol, 600_000, async () => {
    const { text } = await read(
      'https://feeds.finance.yahoo.com/rss/2.0/headline?' +
        new URLSearchParams({ s: symbol, region: 'US', lang: 'en-US' }),
    );
    if (!/<rss[\s>]/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error('News feed unavailable');
    return [...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 12).flatMap((item) => {
      const title = xmlText(item[1]!, 'title').slice(0, 500),
        url = safeUrl(xmlText(item[1]!, 'link')),
        publishedAt = Date.parse(xmlText(item[1]!, 'pubDate'));
      return title && url && Number.isFinite(publishedAt) && publishedAt <= Date.now()
        ? [{ title, url, publishedAt }]
        : [];
    });
  });
}
export async function stockData(raw: string): Promise<StockData> {
  let symbol: string;
  try {
    symbol = stockSymbol(raw);
  } catch {
    throw new InvestmentError('Choose a valid stock listing');
  }
  return cached('stock:' + symbol, 60_000, async () => {
    const chart = await json(
      Q + '/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=6mo',
    );
    const result = object(chart.chart).result;
    if (!Array.isArray(result) || !result.length) throw new InvestmentError('Stock listing not found', 404);
    const row = object(result[0]),
      meta = object(row.meta),
      price = number(meta.regularMarketPrice),
      quoteAt = (number(meta.regularMarketTime) ?? 0) * 1000;
    if (
      string(meta.symbol).toUpperCase() !== symbol ||
      !['EQUITY', 'ETF'].includes(string(meta.instrumentType)) ||
      price === null ||
      price <= 0 ||
      quoteAt <= 0 ||
      quoteAt > Date.now() + 5000 ||
      !string(meta.currency)
    )
      throw new InvestmentError('Provider could not verify this stock listing', 502);
    const times = Array.isArray(row.timestamp) ? row.timestamp : [],
      quotes = object(row.indicators).quote;
    const closes = Array.isArray(quotes) ? object(quotes[0]).close : [];
    const history = times.flatMap((t, i) => {
      const at = (number(t) ?? 0) * 1000,
        close = Array.isArray(closes) ? number(closes[i]) : null;
      return at > 0 && at <= Date.now() && close !== null && close > 0 ? [{ at, close }] : [];
    });
    const [summary, news] = await Promise.allSettled([fundamentals(symbol), headlines(symbol)]);
    const info = summary.status === 'fulfilled' ? summary.value : {},
      profile = object(info.assetProfile),
      detail = object(info.summaryDetail),
      financial = object(info.financialData),
      stats = object(info.defaultKeyStatistics);
    const previousClose =
      number(detail.previousClose) ?? number(meta.previousClose) ?? history.at(-2)?.close ?? null;
    const regular = object(object(meta.currentTradingPeriod).regular),
      start = (number(regular.start) ?? 0) * 1000,
      end = (number(regular.end) ?? 0) * 1000;
    return {
      symbol,
      name: string(meta.longName ?? meta.shortName, 120) || symbol,
      exchange: string(meta.fullExchangeName ?? meta.exchangeName, 60),
      currency: string(meta.currency, 8),
      type: meta.instrumentType as StockData['type'],
      country: string(profile.country, 60),
      sector: string(profile.sector, 80),
      industry: string(profile.industry, 120),
      description: string(profile.longBusinessSummary, 8000),
      website: safeUrl(profile.website),
      price,
      changePercent:
        number(meta.regularMarketChangePercent) ?? (previousClose ? (price / previousClose - 1) * 100 : null),
      quoteAt,
      fetchedAt: Date.now(),
      delayMinutes: number(meta.exchangeDataDelayedBy),
      marketState: Date.now() >= start && Date.now() < end ? 'open' : 'closed',
      previousClose,
      dayHigh: number(meta.regularMarketDayHigh),
      dayLow: number(meta.regularMarketDayLow),
      yearHigh: number(meta.fiftyTwoWeekHigh),
      yearLow: number(meta.fiftyTwoWeekLow),
      volume: number(meta.regularMarketVolume),
      marketCap: number(detail.marketCap),
      trailingPE: number(detail.trailingPE),
      forwardPE: number(detail.forwardPE),
      dividendYield: number(detail.dividendYield),
      targetMean: number(financial.targetMeanPrice),
      analystCount: number(financial.numberOfAnalystOpinions),
      recommendation: string(financial.recommendationKey, 60),
      financialCurrency: string(financial.financialCurrency, 8),
      revenueGrowth: number(financial.revenueGrowth),
      profitMargin: number(financial.profitMargins ?? stats.profitMargins),
      history,
      news: news.status === 'fulfilled' ? news.value : [],
      issues: [
        ...(summary.status === 'rejected' ? ['Fundamentals unavailable'] : []),
        ...(news.status === 'rejected' ? ['News unavailable'] : []),
      ],
      sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`,
    };
  });
}
