import { stockSymbol } from './market-data.ts';
export const INVESTMENT_STATUSES = [
  'Review',
  'Buy',
  'Accumulate',
  'Hold',
  'Too Expensive',
  'Thesis Broken',
] as const;
export type InvestmentStatus = (typeof INVESTMENT_STATUSES)[number];
export type InvestmentStock = {
  id: string;
  name: string;
  symbol: string;
  exchange: string;
  country: string;
  currency: string;
  theme: string;
  targetWeight: number;
  status: InvestmentStatus;
  referenceSymbol: string;
  marketSymbol?: string;
  brokerUrl: string;
  thesis: string;
  catalysts: string;
  invalidation: string;
  risks: string;
  metrics: string;
  notes: string;
  reviewedAt: string;
  archived: boolean;
  sources: { label: string; url: string }[];
};
export type InvestmentPortfolio = {
  id: string;
  name: string;
  description: string;
  horizon: string;
  researchAsOf: string;
  relationships: string;
  stocks: InvestmentStock[];
};
export type Investments = { schemaVersion: 1; revision: number; portfolios: InvestmentPortfolio[] };
export const MAX_INVESTMENT_BYTES = 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid investment record');
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))
  )
    throw Error(`Invalid ${name}`);
  const result = value.trim();
  if (required && !result) throw Error(`${name} is required`);
  return result;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw Error('Invalid investment ID');
  return value;
}
function date(value: unknown): string {
  const raw = text(value, 'research date', 10);
  if (
    raw &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) ||
      new Date(raw).toISOString().slice(0, 10) !== raw)
  )
    throw Error('Invalid research date');
  return raw;
}
export function investmentUrl(value: unknown): string {
  const raw = text(value, 'source URL', 2048);
  if (!raw) return '';
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw Error('Use an HTTPS source URL without credentials');
  return url.href;
}
export function validateInvestmentStock(input: unknown): InvestmentStock {
  const v = record(input);
  const symbol = text(v.symbol, 'stock ticker', 40, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9.&^/_-]*$/.test(symbol)) throw Error('Invalid stock ticker');
  const referenceSymbol = text(v.referenceSymbol, 'TradingView reference', 100);
  if (referenceSymbol && !/^[A-Za-z0-9_]{1,24}:[A-Za-z0-9][A-Za-z0-9.&^/_-]{0,60}$/.test(referenceSymbol))
    throw Error('Use an exchange-qualified reference such as NASDAQ:AAPL');
  if (
    typeof v.targetWeight !== 'number' ||
    !Number.isFinite(v.targetWeight) ||
    v.targetWeight < 0 ||
    v.targetWeight > 100
  )
    throw Error('Target weight must be between 0 and 100');
  if (!INVESTMENT_STATUSES.includes(v.status as InvestmentStatus)) throw Error('Invalid thesis status');
  if (typeof v.archived !== 'boolean' || !Array.isArray(v.sources) || v.sources.length > 10)
    throw Error('Invalid investment sources or archive flag');
  return {
    id: id(v.id),
    name: text(v.name, 'company name', 120, true),
    symbol,
    exchange: text(v.exchange, 'listing exchange', 60, true),
    country: text(v.country, 'country', 60, true),
    currency: text(v.currency, 'listing currency', 8, true),
    theme: text(v.theme, 'economic theme', 80, true),
    targetWeight: v.targetWeight,
    status: v.status as InvestmentStatus,
    referenceSymbol,
    marketSymbol: v.marketSymbol ? stockSymbol(v.marketSymbol) : '',
    brokerUrl: investmentUrl(v.brokerUrl),
    thesis: text(v.thesis, 'investment thesis', 4000),
    catalysts: text(v.catalysts, 'catalysts', 3000),
    invalidation: text(v.invalidation, 'invalidation', 3000),
    risks: text(v.risks, 'risks', 3000),
    metrics: text(v.metrics, 'metrics', 3000),
    notes: text(v.notes, 'research notes', 6000),
    reviewedAt: date(v.reviewedAt),
    archived: v.archived,
    sources: v.sources.map((raw) => {
      const source = record(raw);
      const url = investmentUrl(source.url);
      if (!url) throw Error('Source URL is required');
      return { label: text(source.label, 'source label', 160, true), url };
    }),
  };
}
export function validateInvestments(input: unknown): Investments {
  const v = record(input);
  if (
    v.schemaVersion !== 1 ||
    !Number.isSafeInteger(v.revision) ||
    (v.revision as number) < 0 ||
    !Array.isArray(v.portfolios) ||
    v.portfolios.length > 20
  )
    throw Error('Invalid investment workspace');
  const seen = new Set<string>();
  let stockCount = 0;
  const portfolios = v.portfolios.map((input): InvestmentPortfolio => {
    const p = record(input),
      portfolioId = id(p.id);
    if (seen.has(portfolioId)) throw Error('Duplicate portfolio ID');
    seen.add(portfolioId);
    if (!Array.isArray(p.stocks) || p.stocks.length > 250) throw Error('Invalid stock list');
    stockCount += p.stocks.length;
    const stocks = p.stocks.map(validateInvestmentStock);
    const ids = new Set(stocks.map((s) => s.id));
    if (ids.size !== stocks.length) throw Error('Duplicate stock ID');
    const listings = stocks.filter((s) => !s.archived).map((s) => `${s.exchange}:${s.symbol}`.toUpperCase());
    if (new Set(listings).size !== listings.length) throw Error('This listing is already in the thesis');
    if (stocks.filter((s) => !s.archived).reduce((n, s) => n + s.targetWeight, 0) > 100 + 1e-8)
      throw Error('Active target weights exceed 100%. Reduce a weight before adding more.');
    return {
      id: portfolioId,
      name: text(p.name, 'thesis name', 140, true),
      description: text(p.description, 'thesis description', 6000),
      horizon: text(p.horizon, 'time horizon', 80),
      researchAsOf: date(p.researchAsOf),
      relationships: text(p.relationships, 'fundamental relationships', 8000),
      stocks,
    };
  });
  if (stockCount > 250) throw Error('Investment workspace limit is 250 stock entries');
  return { schemaVersion: 1, revision: v.revision as number, portfolios };
}

export function emptyStock(): InvestmentStock {
  return {
    id: crypto.randomUUID(),
    name: '',
    symbol: '',
    exchange: '',
    country: '',
    currency: '',
    theme: '',
    targetWeight: 0,
    status: 'Review',
    referenceSymbol: '',
    brokerUrl: '',
    thesis: '',
    catalysts: '',
    invalidation: '',
    risks: '',
    metrics: '',
    notes: '',
    reviewedAt: '',
    archived: false,
    sources: [],
  };
}

/** Read the original MCGA JSON literal as data. Never execute the imported HTML. */
export function parseInvestmentImport(raw: string): InvestmentPortfolio[] {
  if (new TextEncoder().encode(raw).length > MAX_INVESTMENT_BYTES) throw Error('Import exceeds 1 MiB');
  const match = raw.match(/const\s+STOCKS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) {
    const input = record(JSON.parse(raw));
    return validateInvestments({ ...input, schemaVersion: 1, revision: 0 }).portfolios;
  }
  const rows: unknown = JSON.parse(match[1]!);
  if (!Array.isArray(rows) || !rows.length || rows.length > 250) throw Error('Invalid MCGA stock list');
  const newsMatch = raw.match(/const\s+NEWS\s*=\s*(\[[\s\S]*?\]);/);
  const news: unknown = newsMatch ? JSON.parse(newsMatch[1]!) : [];
  if (
    !Array.isArray(news) ||
    news.length > 100 ||
    news.some((item) => !Array.isArray(item) || item.length !== 2 || item.some((v) => typeof v !== 'string'))
  )
    throw Error('Invalid MCGA research sources');
  const researchSources = news as [string, string][];
  const stocks = rows.map((row, index) => {
    const r = record(row),
      base = emptyStock();
    const optional = (key: string) => (r[key] === undefined ? '' : r[key]);
    return validateInvestmentStock({
      ...base,
      id: `mcga-${index + 1}`,
      name: r.name,
      symbol: r.symbol,
      exchange: r.market,
      country: 'China',
      currency: r.market === 'Gettex' ? 'EUR' : 'USD',
      theme: r.theme,
      targetWeight: r.weight,
      status: r.status,
      referenceSymbol: r.tv,
      brokerUrl: r.link,
      thesis: r.thesis,
      catalysts: r.trigger,
      invalidation: r.fail,
      risks: r.risks,
      metrics: optional('metrics'),
      notes: optional('news'),
      reviewedAt: '2026-10-19',
      sources: researchSources
        .filter(([label]) => {
          const value = label.toLowerCase();
          return (
            value.startsWith(String(r.symbol).toLowerCase()) ||
            value.startsWith(String(r.name).split(' ')[0]!.toLowerCase()) ||
            value.startsWith('trading 212')
          );
        })
        .map(([label, url]) => ({ label, url })),
    });
  });
  return validateInvestments({
    schemaVersion: 1,
    revision: 0,
    portfolios: [
      {
        id: 'mcga-v2-20261019',
        name: 'MCGA · China Ascendancy',
        horizon: '2026–2031',
        researchAsOf: '2026-10-19',
        description:
          'Imported MCGA v2 research from 19 October 2026. Target allocations and qualitative statuses are historical research, not current recommendations. Recheck instrument availability in your Trading 212 account.',
        relationships:
          'Semiconductor factory investment → equipment demand. Renewable capacity → storage demand. Automation → optical and LiDAR demand. Consumer spending → commerce and logistics. These are economic links, not verified supply contracts or statistical correlations.',
        stocks,
      },
    ],
  }).portfolios;
}

export function investmentCsv(portfolio: InvestmentPortfolio): string {
  const escape = (value: unknown) => {
    let raw = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(raw)) raw = "'" + raw;
    return '"' + raw.replaceAll('"', '""') + '"';
  };
  const columns = [
    'name',
    'symbol',
    'exchange',
    'country',
    'currency',
    'theme',
    'targetWeight',
    'status',
    'referenceSymbol',
    'brokerUrl',
    'thesis',
    'catalysts',
    'invalidation',
    'risks',
    'metrics',
    'notes',
    'reviewedAt',
    'archived',
  ] as const;
  return [
    columns.join(','),
    ...portfolio.stocks.map((stock) => columns.map((key) => escape(stock[key])).join(',')),
  ].join('\r\n');
}
