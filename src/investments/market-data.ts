/** Provider identity is independent of the owner's thesis and broker listing. */
export type StockMatch = {
  symbol: string;
  name: string;
  exchange: string;
  type: 'EQUITY' | 'ETF';
  sector: string;
};
export type StockData = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  type: 'EQUITY' | 'ETF';
  country: string;
  sector: string;
  industry: string;
  description: string;
  website: string;
  price: number;
  changePercent: number | null;
  quoteAt: number;
  fetchedAt: number;
  delayMinutes: number | null;
  marketState: 'open' | 'closed';
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  volume: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  targetMean: number | null;
  analystCount: number | null;
  recommendation: string;
  financialCurrency: string;
  revenueGrowth: number | null;
  profitMargin: number | null;
  history: { at: number; close: number }[];
  news: { title: string; url: string; publishedAt: number }[];
  issues: string[];
  sourceUrl: string;
};
export function stockSymbol(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/.test(value))
    throw Error('Choose a valid stock listing');
  return value.toUpperCase();
}
