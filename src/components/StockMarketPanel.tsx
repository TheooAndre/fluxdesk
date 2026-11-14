import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Card } from './UiPrimitives.tsx';
import type { InvestmentStock } from '../investments/model.ts';
import type { StockData } from '../investments/market-data.ts';
const value = (n: number | null, digits = 2) =>
  n === null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(n);
const compact = (n: number | null) =>
  n === null
    ? '—'
    : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n);
const percent = (n: number | null) => (n === null ? '—' : `${value(n)}%`);
const date = (at: number) =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function PriceChart({ data }: { data: StockData }) {
  const points = data.history;
  if (points.length < 2) return <p className="small-label">Price history unavailable.</p>;
  const low = Math.min(...points.map((p) => p.close)),
    high = Math.max(...points.map((p) => p.close));
  const width = 600,
    height = 190,
    span = high - low || 1;
  const line = points
    .map(
      (p, i) =>
        `${(i / (points.length - 1)) * width},${height - 12 - ((p.close - low) / span) * (height - 24)}`,
    )
    .join(' ');
  return (
    <div className="stock-price-chart">
      <div className="row-between small-label">
        <span>6M · {data.currency}</span>
        <span>
          {value(low)} – {value(high)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${data.symbol} six-month daily closing prices in ${data.currency}`}
      >
        <line x1="0" y1={height - 12} x2={width} y2={height - 12} stroke="currentColor" opacity="0.15" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="row-between small-label">
        <span>{new Date(points[0]!.at).toLocaleDateString()}</span>
        <span>{new Date(points.at(-1)!.at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}
export default function StockMarketPanel({
  stock,
  offline,
  onLink,
}: {
  stock: InvestmentStock;
  offline: boolean;
  onLink: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'news' | 'profile'>('overview');
  const symbol = stock.marketSymbol ?? '';
  const query = useQuery({
    queryKey: ['investments', 'stock', symbol],
    queryFn: ({ signal }) => api.stockData(symbol, signal),
    enabled: !!symbol && !offline,
    staleTime: 60_000,
    refetchInterval: 60_000,
    gcTime: 0,
    retry: false,
  });
  const data = query.data;
  return (
    <Card
      title="Market"
      aside={
        <button type="button" className="subtle" disabled={offline} onClick={onLink}>
          {symbol ? 'Change listing' : 'Link listing'}
        </button>
      }
    >
      {!symbol ? (
        <p className="small-label">Link a listing for prices, financials and news.</p>
      ) : (
        <>
          {query.isPending && !offline && <p role="status">Loading {symbol}…</p>}
          {(query.isError || offline) && (
            <p className="notice warning" role="alert">
              {offline ? 'Offline · quotes may be outdated.' : query.error?.message}{' '}
              {!offline && (
                <button type="button" className="subtle" onClick={() => void query.refetch()}>
                  Retry
                </button>
              )}
            </p>
          )}
          {data && (
            <>
              <div className="stock-quote">
                <div>
                  <span className="small-label">
                    {data.symbol} · {data.exchange}
                  </span>
                  <div className="stock-quote-price">
                    {value(data.price)} <small>{data.currency}</small>
                  </div>
                </div>
                <span
                  className={data.changePercent !== null && data.changePercent < 0 ? 'negative' : 'positive'}
                >
                  {data.changePercent !== null && data.changePercent > 0 ? '+' : ''}
                  {percent(data.changePercent)}
                </span>
              </div>
              <div className="row-between small-label stock-quote-time">
                <span>
                  {data.quoteStale
                    ? 'Cached quote'
                    : data.marketState === 'closed'
                      ? 'Latest close'
                      : 'Exchange quote'}{' '}
                  · {date(data.quoteAt)}
                </span>
                <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Yahoo Finance ↗
                </a>
              </div>
              <p className="small-label">
                {data.delayMinutes === null ? 'Exchange delays apply' : `${data.delayMinutes}m delay`}
                {stock.currency !== data.currency
                  ? ` · linked quote in ${data.currency}; research listing in ${stock.currency}`
                  : ''}
              </p>
              {!!data.issues.length && (
                <p className="small-label" role="status">
                  {data.issues.join(' · ')}
                </p>
              )}
              <div className="segmented stock-view-tabs" role="group" aria-label="Stock data view">
                {(['overview', 'news', 'profile'] as const).map((t) => (
                  <button
                    type="button"
                    key={t}
                    aria-pressed={tab === t}
                    className={tab === t ? 'active' : ''}
                    onClick={() => setTab(t)}
                  >
                    {t === 'overview' ? 'Overview' : t === 'news' ? 'News' : 'Company'}
                  </button>
                ))}
              </div>
              {tab === 'overview' && (
                <>
                  <PriceChart data={data} />
                  <dl className="stock-fundamentals">
                    {[
                      ['Market cap', compact(data.marketCap)],
                      ['P/E · forward', `${value(data.trailingPE)} / ${value(data.forwardPE)}`],
                      ['52W range', `${value(data.yearLow)} – ${value(data.yearHigh)}`],
                      ['Volume', compact(data.volume)],
                      [
                        'Dividend yield',
                        percent(data.dividendYield === null ? null : data.dividendYield * 100),
                      ],
                      [
                        'Analyst target',
                        data.targetMean === null ? '—' : `${value(data.targetMean)} ${data.currency}`,
                      ],
                      [
                        'Consensus',
                        data.recommendation
                          ? `${data.recommendation.replaceAll('_', ' ')} · ${data.analystCount ?? '—'} analysts`
                          : '—',
                      ],
                      [
                        'Revenue growth',
                        percent(data.revenueGrowth === null ? null : data.revenueGrowth * 100),
                      ],
                    ].map(([label, v]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {tab === 'news' && (
                <div className="stock-headlines">
                  {data.news.length ? (
                    data.news.map((n) => (
                      <a key={n.url} href={n.url} target="_blank" rel="noopener noreferrer">
                        <span>{n.title}</span>
                        <small>{date(n.publishedAt)} ↗</small>
                      </a>
                    ))
                  ) : (
                    <p className="small-label">
                      {data.issues.includes('News unavailable')
                        ? 'News feed unavailable.'
                        : 'No recent headlines.'}
                    </p>
                  )}
                </div>
              )}
              {tab === 'profile' && (
                <div className="stock-profile">
                  <p className="small-label">
                    {[data.country, data.sector, data.industry].filter(Boolean).join(' · ')}
                  </p>
                  <p>{data.description || 'Company profile unavailable.'}</p>
                  {data.website && (
                    <a href={data.website} target="_blank" rel="noopener noreferrer">
                      Company website ↗
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Card>
  );
}
