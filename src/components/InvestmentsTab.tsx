import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { Card, Loading } from './UiPrimitives.tsx';
import {
  emptyStock,
  INVESTMENT_STATUSES,
  investmentCsv,
  parseInvestmentImport,
  validateInvestments,
  type InvestmentPortfolio,
  type Investments,
  type InvestmentStock,
} from '../investments/model.ts';
import StockLookup from './StockLookup.tsx';
import StockMarketPanel from './StockMarketPanel.tsx';
import './InvestmentsTab.css';

const QUERY_KEY = ['investments'] as const;
const message = (error: unknown) => (error instanceof Error ? error.message : 'Investment request failed');
const weight = (value: number) => `${Number(value.toFixed(2))}%`;
function download(name: string, raw: string, type: string) {
  const url = URL.createObjectURL(new Blob([raw], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StockEditor({
  stock,
  pending,
  onSave,
  onCancel,
}: {
  stock: InvestmentStock;
  pending: boolean;
  onSave: (stock: InvestmentStock) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(stock);
  const [sources, setSources] = useState(stock.sources.map((s) => `${s.label} | ${s.url}`).join('\n'));
  const [error, setError] = useState('');
  const set = <K extends keyof InvestmentStock>(key: K, value: InvestmentStock[K]) =>
    setDraft((old) => ({
      ...old,
      [key]: value,
      ...(['symbol', 'exchange', 'currency'].includes(key) ? { marketSymbol: '' } : {}),
    }));
  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const rows = sources
        .split('\n')
        .filter((row) => row.trim())
        .map((row) => {
          const split = row.indexOf('|');
          if (split < 1) throw Error('Use one source per line: label | https://…');
          return { label: row.slice(0, split).trim(), url: row.slice(split + 1).trim() };
        });
      if (!stock.name && !draft.marketSymbol) throw Error('Select a stock from search results first');
      onSave({ ...draft, sources: rows });
    } catch (cause) {
      setError(message(cause));
    }
  }
  return (
    <Card title={stock.name ? `Edit ${stock.name}` : 'Add stock'}>
      <form className="investment-form" onSubmit={submit}>
        <fieldset disabled={pending}>
          <StockLookup
            disabled={pending}
            onSelect={(listing) => {
              const exchange = (
                {
                  NasdaqGS: 'NASDAQ',
                  NasdaqGM: 'NASDAQ',
                  NasdaqCM: 'NASDAQ',
                  NYSE: 'NYSE',
                  'Hong Kong': 'HKEX',
                } as Record<string, string>
              )[listing.exchange];
              setDraft((old) => ({
                ...old,
                marketSymbol: listing.symbol,
                name: listing.name,
                symbol: listing.symbol,
                exchange: listing.exchange,
                currency: listing.currency,
                country: listing.country || 'Unknown',
                theme: old.theme || listing.sector || 'Other',
                referenceSymbol: exchange
                  ? `${exchange}:${listing.symbol.replace(/\.HK$/, '').replace(/-/g, '.')}`
                  : '',
              }));
            }}
          />
          {draft.marketSymbol && (
            <div className="stock-linked" role="status">
              <strong>{draft.marketSymbol}</strong>
              <span>
                {draft.name} · {draft.exchange} · {draft.currency}
              </span>
            </div>
          )}
          <details className="editor-details" open={!draft.marketSymbol && !!stock.name}>
            <summary>Listing details</summary>
            <div className="investment-fields">
              <label>
                Company name
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </label>
              <label>
                Stock ticker
                <input
                  required
                  maxLength={40}
                  placeholder="AAPL, 0700, BRK.B…"
                  value={draft.symbol}
                  onChange={(e) => set('symbol', e.target.value)}
                />
              </label>
              <label>
                Listing exchange
                <input
                  required
                  maxLength={60}
                  placeholder="NASDAQ, HKEX, XETRA…"
                  value={draft.exchange}
                  onChange={(e) => set('exchange', e.target.value)}
                />
              </label>
              <label>
                Company country
                <input
                  required
                  maxLength={60}
                  placeholder="Any country"
                  value={draft.country}
                  onChange={(e) => set('country', e.target.value)}
                />
              </label>
              <label>
                Listing currency
                <input
                  required
                  maxLength={8}
                  placeholder="USD, EUR, HKD…"
                  value={draft.currency}
                  onChange={(e) => set('currency', e.target.value.toUpperCase())}
                />
              </label>
            </div>
          </details>
          <div className="investment-fields">
            <label>
              Economic theme
              <input
                required
                maxLength={80}
                placeholder="Infrastructure, healthcare…"
                value={draft.theme}
                onChange={(e) => set('theme', e.target.value)}
              />
            </label>
            <label>
              Target weight (%)
              <input
                required
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={draft.targetWeight}
                onChange={(e) => set('targetWeight', e.target.valueAsNumber)}
              />
            </label>
            <label>
              Thesis status
              <select
                aria-label="Thesis status"
                value={draft.status}
                onChange={(e) => set('status', e.target.value as InvestmentStock['status'])}
              >
                {INVESTMENT_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <details className="editor-details">
            <summary>Chart, broker & review date</summary>
            <div className="investment-fields">
              <label>
                TradingView reference
                <input
                  maxLength={100}
                  placeholder="NASDAQ:AAPL"
                  value={draft.referenceSymbol}
                  onChange={(e) => set('referenceSymbol', e.target.value)}
                />
              </label>
              <label>
                Broker instrument URL
                <input
                  type="url"
                  maxLength={2048}
                  placeholder="https://…"
                  value={draft.brokerUrl}
                  onChange={(e) => set('brokerUrl', e.target.value)}
                />
              </label>
              <label>
                Last research review
                <input
                  type="date"
                  value={draft.reviewedAt}
                  onChange={(e) => set('reviewedAt', e.target.value)}
                />
              </label>
            </div>
          </details>
          {(
            [
              ['thesis', 'Investment thesis'],
              ['catalysts', 'Catalysts / evidence to watch'],
              ['invalidation', 'What would break the thesis'],
              ['risks', 'Key risks'],
              ['metrics', 'Valuation / operating metrics'],
              ['notes', 'Research notes / dated news'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={label}
                rows={3}
                maxLength={key === 'notes' ? 6000 : key === 'thesis' ? 4000 : 3000}
                value={draft[key]}
                onChange={(e) => set(key, e.target.value)}
              />
            </label>
          ))}
          <label>
            Research sources · label | HTTPS URL
            <textarea
              aria-label="Research sources"
              rows={3}
              value={sources}
              maxLength={22000}
              onChange={(e) => setSources(e.target.value)}
            />
          </label>
          {error && (
            <p className="notice warning" role="alert">
              {error}
            </p>
          )}
          <div className="investment-actions">
            <button type="submit" disabled={!stock.name && !draft.marketSymbol}>
              {pending ? 'Saving…' : 'Save stock'}
            </button>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel editing
            </button>
          </div>
        </fieldset>
      </form>
    </Card>
  );
}

function PortfolioEditor({
  portfolio,
  pending,
  onSave,
  onCancel,
}: {
  portfolio: InvestmentPortfolio;
  pending: boolean;
  onSave: (p: InvestmentPortfolio) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(portfolio);
  const set = (key: keyof Omit<InvestmentPortfolio, 'stocks'>, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <Card title={portfolio.name ? 'Edit investment thesis' : 'Create an investment thesis'}>
      <form
        className="investment-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <fieldset disabled={pending}>
          <label>
            Thesis name
            <input
              required
              maxLength={140}
              value={draft.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <div className="investment-fields">
            <label>
              Time horizon
              <input
                maxLength={80}
                placeholder="5 years / 2026–2031"
                value={draft.horizon}
                onChange={(e) => set('horizon', e.target.value)}
              />
            </label>
            <label>
              Research as of
              <input
                type="date"
                value={draft.researchAsOf}
                onChange={(e) => set('researchAsOf', e.target.value)}
              />
            </label>
          </div>
          <label>
            Thesis description
            <textarea
              aria-label="Thesis description"
              rows={4}
              maxLength={6000}
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </label>
          <label>
            Relationships / demand engines
            <textarea
              aria-label="Relationships / demand engines"
              rows={5}
              maxLength={8000}
              value={draft.relationships}
              onChange={(e) => set('relationships', e.target.value)}
            />
          </label>
          <div className="investment-actions">
            <button type="submit">Save thesis</button>
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel editing
            </button>
          </div>
        </fieldset>
      </form>
    </Card>
  );
}

function StockMedia({ stock }: { stock: InvestmentStock }) {
  const [loaded, setLoaded] = useState(false);
  if (!stock.referenceSymbol)
    return (
      <p className="footnote">
        Add an exchange-qualified TradingView reference to show charts and company news.
      </p>
    );
  const widgetUrl = (kind: 'chart' | 'news') => {
    const script = kind === 'chart' ? 'advanced-chart' : 'timeline';
    const settings =
      kind === 'chart'
        ? {
            symbol: stock.referenceSymbol,
            interval: 'D',
            timezone: 'Etc/UTC',
            theme: 'dark',
            style: '1',
            locale: 'en',
            autosize: true,
            allow_symbol_change: false,
            withdateranges: true,
          }
        : {
            symbol: stock.referenceSymbol,
            feedMode: 'symbol',
            displayMode: 'regular',
            colorTheme: 'dark',
            locale: 'en',
            width: '100%',
            height: '100%',
            isTransparent: false,
          };
    const url = new URL(`https://www.tradingview-widget.com/embed-widget/${script}/`);
    url.searchParams.set('locale', 'en');
    url.hash = encodeURIComponent(JSON.stringify(settings));
    return url.toString();
  };
  return (
    <>
      <p className="footnote">{stock.referenceSymbol} · reference listing; exchange delays apply.</p>
      <p className="investment-links">
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(stock.referenceSymbol)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in TradingView ↗
        </a>
      </p>
      {loaded ? (
        <div className="investment-media">
          <iframe
            title={`TradingView reference chart for ${stock.name}`}
            src={widgetUrl('chart')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
          <iframe
            title={`TradingView company news for ${stock.name}`}
            src={widgetUrl('news')}
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="investment-media-prompt">
          <p>Loads from TradingView using this symbol.</p>
          <button type="button" className="secondary" onClick={() => setLoaded(true)}>
            Load TradingView
          </button>
        </div>
      )}
    </>
  );
}

export default function InvestmentsTab({ offline }: { offline: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: api.investments, retry: false, gcTime: 0 });
  const [selectedPortfolio, setSelectedPortfolio] = useState('');
  const [selectedStock, setSelectedStock] = useState('');
  const [stockDraft, setStockDraft] = useState<InvestmentStock | null>(null);
  const [portfolioDraft, setPortfolioDraft] = useState<InvestmentPortfolio | null>(null);
  const [search, setSearch] = useState(''),
    [theme, setTheme] = useState('all'),
    [country, setCountry] = useState('all');
  const [archived, setArchived] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState('');
  const [imported, setImported] = useState<InvestmentPortfolio[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: api.saveInvestments,
    retry: false,
    onSuccess: (data) => {
      client.setQueryData(QUERY_KEY, data);
      setStockDraft(null);
      setPortfolioDraft(null);
      setImported(null);
      setReceipt('Saved.');
    },
    onError: (cause) => setError(message(cause)),
  });
  const data = query.data;
  const portfolio = data?.portfolios.find((p) => p.id === selectedPortfolio) ?? data?.portfolios[0];
  const stock =
    portfolio?.stocks.find((s) => s.id === selectedStock) ?? portfolio?.stocks.find((s) => !s.archived);
  const active = useMemo(() => portfolio?.stocks.filter((s) => !s.archived) ?? [], [portfolio]);
  const allocated = active.reduce((n, s) => n + s.targetWeight, 0);
  const exposure = [
    ...active.reduce(
      (map, s) => map.set(s.theme, (map.get(s.theme) ?? 0) + s.targetWeight),
      new Map<string, number>(),
    ),
  ].sort((a, b) => b[1] - a[1]);
  const visible = (portfolio?.stocks ?? []).filter(
    (s) =>
      s.archived === archived &&
      (theme === 'all' || s.theme === theme) &&
      (country === 'all' || s.country === country) &&
      `${s.name} ${s.symbol} ${s.theme} ${s.status} ${s.country}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const busy = offline || save.isPending || query.isFetching;
  useEffect(() => {
    if (!stockDraft && !portfolioDraft) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [stockDraft, portfolioDraft]);
  function submit(value: Investments) {
    setError('');
    setReceipt('');
    try {
      save.mutate(validateInvestments(value));
    } catch (cause) {
      setError(message(cause));
    }
  }
  function replacePortfolio(next: InvestmentPortfolio) {
    if (!data) return;
    submit({
      ...data,
      portfolios: data.portfolios.some((p) => p.id === next.id)
        ? data.portfolios.map((p) => (p.id === next.id ? next : p))
        : [...data.portfolios, next],
    });
    setSelectedPortfolio(next.id);
  }
  function saveStock(next: InvestmentStock) {
    if (!portfolio) return;
    replacePortfolio({
      ...portfolio,
      stocks: portfolio.stocks.some((s) => s.id === next.id)
        ? portfolio.stocks.map((s) => (s.id === next.id ? next : s))
        : [...portfolio.stocks, next],
    });
    setSelectedStock(next.id);
  }
  const leaveEditor = () =>
    (!stockDraft && !portfolioDraft) || window.confirm('Discard unsaved investment edits?');
  if (query.isPending) return <Loading label="Loading your investment theses…" />;
  if (!data)
    return (
      <Card title="Investments unavailable">
        <p role="alert">{message(query.error)}</p>
        <button type="button" disabled={offline || query.isFetching} onClick={() => void query.refetch()}>
          Retry investments
        </button>
      </Card>
    );
  return (
    <div className="investments-workspace content-stack">
      <div className="investment-actions">
        <label className="investment-select">
          Thesis
          <select
            aria-label="Select investment thesis"
            value={portfolio?.id ?? ''}
            disabled={busy}
            onChange={(e) => {
              if (leaveEditor()) {
                setSelectedPortfolio(e.target.value);
                setSelectedStock('');
                setStockDraft(null);
                setPortfolioDraft(null);
                setTheme('all');
                setCountry('all');
              }
            }}
          >
            {data.portfolios.length ? (
              data.portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))
            ) : (
              <option value="">No thesis yet</option>
            )}
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (leaveEditor()) {
              setStockDraft(null);
              setPortfolioDraft({
                id: crypto.randomUUID(),
                name: '',
                description: '',
                horizon: '',
                researchAsOf: '',
                relationships: '',
                stocks: [],
              });
            }
          }}
        >
          New thesis
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !!stockDraft || !!portfolioDraft}
          onClick={() => input.current?.click()}
        >
          Import
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError('');
            void query.refetch();
          }}
        >
          Reload
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!data.portfolios.length || busy}
          onClick={() =>
            download('fluxdesk-investments.json', JSON.stringify(data, null, 2), 'application/json')
          }
        >
          Export JSON
        </button>
        <input
          ref={input}
          className="investment-hidden-input"
          type="file"
          aria-label="Import investment file"
          accept=".json,.html,.htm"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (file.size > 1024 * 1024) {
              setError('Import exceeds 1 MiB');
              return;
            }
            void file
              .text()
              .then((raw) => {
                setImported(parseInvestmentImport(raw));
                setError('');
              })
              .catch((cause) => setError(message(cause)));
          }}
        />
      </div>
      {(error || query.isError) && (
        <div className="notice warning" role="alert">
          {error || message(query.error)} Your editor stays open. Reload to check the saved version before
          retrying a failed save.
        </div>
      )}
      {receipt && (
        <p className="investment-receipt" role="status">
          {receipt}
        </p>
      )}
      {imported && (
        <Card title="Review investment import">
          <p>
            {imported.length} thesis/theses · {imported.reduce((n, p) => n + p.stocks.length, 0)} stock
            entries. Existing theses will be retained. Matching IDs are rejected to protect existing edits.
          </p>
          <p>
            Imported research dates, notes and statuses remain historical. Broker availability and valuations
            need a fresh review.
          </p>
          <div className="investment-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (data.portfolios.some((p) => imported.some((n) => n.id === p.id))) {
                  setError('This thesis is already imported. Existing notes were not replaced.');
                  return;
                }
                submit({ ...data, portfolios: [...data.portfolios, ...imported] });
              }}
            >
              Import theses to owner account
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setImported(null)}>
              Cancel import
            </button>
          </div>
        </Card>
      )}
      {portfolioDraft ? (
        <PortfolioEditor
          key={portfolioDraft.id}
          portfolio={portfolioDraft}
          pending={busy}
          onSave={replacePortfolio}
          onCancel={() => setPortfolioDraft(null)}
        />
      ) : null}
      {portfolio && (
        <>
          <Card
            className="investment-summary"
            title={portfolio.name}
            aside={
              <button
                type="button"
                className="subtle"
                disabled={busy}
                onClick={() => {
                  if (leaveEditor()) {
                    setStockDraft(null);
                    setPortfolioDraft(portfolio);
                  }
                }}
              >
                Edit thesis
              </button>
            }
          >
            <details className="investment-context">
              <summary>
                Thesis{portfolio.horizon ? ` · ${portfolio.horizon}` : ''}{' '}
                <span className="small-label">· Owner only</span>
              </summary>
              <p className="investment-description">{portfolio.description || 'No thesis description.'}</p>
              {portfolio.researchAsOf && (
                <p className="small-label">Research as of {portfolio.researchAsOf}</p>
              )}
            </details>
          </Card>
          <div className="metric-grid investment-metrics">
            <div className="metric">
              <span>Stocks</span>
              <strong>{active.length}</strong>
              <small>{new Set(active.map((s) => s.country)).size} countries</small>
            </div>
            <div className="metric">
              <span>Target weight</span>
              <strong>{weight(allocated)}</strong>
            </div>
            <div className="metric">
              <span>Unallocated</span>
              <strong>{weight(Math.max(0, 100 - allocated))}</strong>
            </div>
            <div className="metric">
              <span>Positions ≥ 7%</span>
              <strong>
                {weight(active.filter((s) => s.targetWeight >= 7).reduce((n, s) => n + s.targetWeight, 0))}
              </strong>
            </div>
          </div>
          <div className="investment-grid">
            <div className="content-stack">
              <Card
                title="Stocks"
                aside={
                  <button
                    type="button"
                    disabled={busy || !!portfolioDraft}
                    onClick={() => {
                      if (leaveEditor()) {
                        setPortfolioDraft(null);
                        setStockDraft(emptyStock());
                      }
                    }}
                  >
                    Add stock
                  </button>
                }
              >
                <div className="controls">
                  <input
                    aria-label="Search investment stocks"
                    placeholder="Company, ticker, country, status…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <select
                    aria-label="Investment theme"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="all">All themes</option>
                    {[...new Set(portfolio.stocks.map((s) => s.theme))].sort().map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Investment country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option value="all">All countries</option>
                    {[...new Set(portfolio.stocks.map((s) => s.country))].sort().map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <label className="investment-archive-toggle">
                  <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
                  Show archived stocks
                </label>
                <div className="market-scroller">
                  <table className="market-table investment-table">
                    <thead>
                      <tr>
                        <th>Company / listing</th>
                        <th>Economic theme</th>
                        <th>Target</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((s) => (
                        <tr key={s.id} className={stock?.id === s.id ? 'selected' : ''}>
                          <td>
                            <button
                              type="button"
                              className="investment-company"
                              onClick={() => {
                                if (leaveEditor()) {
                                  setStockDraft(null);
                                  setSelectedStock(s.id);
                                }
                              }}
                            >
                              <strong>{s.name}</strong>
                              <small>
                                {s.exchange}:{s.symbol} · {s.currency} · {s.country}
                              </small>
                            </button>
                          </td>
                          <td>{s.theme}</td>
                          <td>{weight(s.targetWeight)}</td>
                          <td>
                            <span className="pill">{s.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!visible.length && <p className="footnote">No stocks match this view.</p>}
                <button
                  type="button"
                  className="subtle"
                  onClick={() =>
                    download(
                      'fluxdesk-investment-weights.csv',
                      investmentCsv(portfolio),
                      'text/csv;charset=utf-8',
                    )
                  }
                >
                  Export thesis CSV
                </button>
              </Card>
              <Card title="Theme weights">
                <div className="investment-exposure">
                  {exposure.map(([label, value]) => (
                    <div key={label}>
                      <div>
                        <span>{label}</span>
                        <strong>{weight(value)}</strong>
                      </div>
                      <meter min={0} max={100} value={value} aria-label={`${label} target weight`} />
                    </div>
                  ))}
                </div>
              </Card>
              {portfolio.relationships && (
                <Card title="Relationships">
                  <p className="investment-description">{portfolio.relationships}</p>
                </Card>
              )}
            </div>
            <div className="content-stack">
              {stockDraft ? (
                <StockEditor
                  key={stockDraft.id}
                  stock={stockDraft}
                  pending={busy}
                  onSave={saveStock}
                  onCancel={() => setStockDraft(null)}
                />
              ) : stock ? (
                <>
                  <StockMarketPanel
                    key={stock.id + (stock.marketSymbol ?? '')}
                    stock={stock}
                    offline={offline}
                    onLink={() => setStockDraft(stock)}
                  />
                  <Card
                    title={`${stock.name} · thesis`}
                    aside={
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => setStockDraft(stock)}
                      >
                        Edit stock
                      </button>
                    }
                  >
                    <div className="investment-actions">
                      <span className="pill">{stock.status}</span>
                      <span className="small-label">Reviewed: {stock.reviewedAt || 'not recorded'}</span>
                    </div>
                    {(
                      [
                        ['thesis', 'Thesis'],
                        ['catalysts', 'Catalysts'],
                        ['invalidation', 'Invalidation'],
                        ['risks', 'Risks'],
                        ['metrics', 'Valuation / metrics'],
                        ['notes', 'Dated research / news'],
                      ] as const
                    ).map(([key, label]) =>
                      stock[key] ? (
                        <div className="investment-memo" key={key}>
                          <h4>{label}</h4>
                          <p>{stock[key]}</p>
                        </div>
                      ) : null,
                    )}
                    <div className="investment-links">
                      {stock.brokerUrl && (
                        <a href={stock.brokerUrl} target="_blank" rel="noopener noreferrer">
                          Broker instrument ↗
                        </a>
                      )}
                      {stock.sources.map((s, i) => (
                        <a key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.label} ↗
                        </a>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="subtle"
                      disabled={busy}
                      onClick={() => saveStock({ ...stock, archived: !stock.archived })}
                    >
                      {stock.archived ? 'Restore stock' : 'Archive stock'}
                    </button>
                  </Card>
                  {stock.referenceSymbol && (
                    <details className="card editor-details">
                      <summary>TradingView chart</summary>
                      <StockMedia key={stock.id + stock.referenceSymbol} stock={stock} />
                    </details>
                  )}
                </>
              ) : (
                <Card title="Build your investment memo">
                  <p>Add a stock to track its thesis, catalysts, risks and evidence.</p>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
      {!portfolio && !portfolioDraft && (
        <Card title="Bring your China thesis into FluxDesk">
          <p>Import your MCGA / FluxDesk JSON, or create a thesis.</p>
        </Card>
      )}
      <details className="help-details">
        <summary>Research limits</summary>
        <p className="footnote">
          Weights are research allocations. Quotes use the linked listing currency. Review statuses are
          manual; no broker or FX-adjusted portfolio valuation is connected.
        </p>
      </details>
    </div>
  );
}
