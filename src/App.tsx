import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import {
  Activity,
  BarChart3,
  Bell,
  BellRing,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Download,
  FlaskConical,
  GitCompareArrows,
  Menu,
  Radio,
  Search,
  ShieldAlert,
  WifiOff,
  X,
  Zap,
  ArrowDownUp,
  RefreshCw,
} from 'lucide-react';
import { api } from './lib/api.ts';
import { useUi, type Tab } from './lib/store.ts';
import { money, pct, price, short, clock } from './lib/format.ts';
import { relativeReturn } from './engine/stats.ts';
import type { AlertKind, EntrySignal, Market, SignalModel } from './types.ts';
import LineChart from './components/LineChart.tsx';
import { intervalsFor } from './engine/intervals.ts';
import FeedHealth from './components/FeedHealth.tsx';
import BenchmarkSelector from './components/BenchmarkSelector.tsx';
// Loaded only when research is opened, preserving overview startup performance.
const StrategyLab = lazy(() => import('./components/StrategyLab.tsx'));
const NAV: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Markets', icon: BarChart3 },
  { id: 'signals', label: 'Entry models', icon: Zap },
  { id: 'pairs', label: 'Correlation', icon: GitCompareArrows },
  { id: 'research', label: 'Strategy Lab', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'calendar', label: 'Macro calendar', icon: CalendarDays },
];
const MODELS: { id: SignalModel; name: string; description: string }[] = [
  { id: 'sfp', name: 'Swing Failure Pattern', description: 'Liquidity sweep and reclaim' },
  { id: 'msb', name: 'Market Structure Break', description: 'Close beyond confirmed swing' },
  { id: 'pullback', name: 'Trend Continuation', description: 'EMA20 pullback in EMA50 trend' },
  { id: 'range', name: 'Consolidation / Chop', description: 'Range boundary rejection' },
];
function Pill({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'green' | 'red' }) {
  return (
    <span className={'pill ' + (tone === 'green' ? 'pill-green' : tone === 'red' ? 'pill-red' : '')}>
      {children}
    </span>
  );
}
function ErrorText({ error }: { error: unknown }) {
  return (
    <div className="notice warning">
      <WifiOff size={16} />
      <span>
        {(error as Error)?.message ?? 'Data source unavailable'}. The app never substitutes fabricated market
        data.
      </span>
    </div>
  );
}
function Loading({ label = 'Loading live data…' }: { label?: string }) {
  return (
    <div className="loading">
      <RefreshCw className="animate-spin" size={19} />
      {label}
    </div>
  );
}
function Card({
  children,
  title,
  aside,
  className = '',
}: {
  children: React.ReactNode;
  title?: string;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={'card ' + className}>
      {title && (
        <div className="card-head">
          <h3>{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
function BadgeVenue({ venue }: { venue: Market['venue'] }) {
  return (
    <span className={'venue ' + (venue === 'binance' ? 'binance' : 'hyper')}>
      {venue === 'binance' ? 'BN' : 'HL'}
    </span>
  );
}
function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { label: string; value: T }[];
  value: T;
  onChange: (a: T) => void;
}) {
  return (
    <div className="segmented">
      {items.map((x) => (
        <button key={x.value} className={x.value === value ? 'active' : ''} onClick={() => onChange(x.value)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}
function useDashboard() {
  const ui = useUi();
  const mk = useQuery({
    queryKey: ['markets'],
    queryFn: ({ signal }) => api.markets(signal),
    refetchInterval: 45_000,
    retry: 1,
  });
  const asset = useQuery({
    queryKey: ['asset', ui.assetId, ui.tf, ui.benchmark],
    queryFn: ({ signal }) => api.asset(ui.assetId, ui.tf, ui.benchmark, signal),
    enabled: !!ui.assetId,
    refetchInterval: 60_000,
  });
  return { ui, mk, asset, selected: mk.data?.assets.find((a) => a.id === ui.assetId) };
}
function MarketTable({
  assets,
  selectedId,
  benchmarkReturn,
}: {
  assets: Market[];
  selectedId: string;
  benchmarkReturn: number | null;
}) {
  const ui = useUi();
  const [visibleRows, setVisibleRows] = useState(50);
  useEffect(() => setVisibleRows(50), [ui.search, ui.venue]);
  const filtered = useMemo(
    () =>
      assets
        .filter(
          (x) =>
            (ui.venue === 'all' || x.venue === ui.venue) &&
            (x.base.toLowerCase().includes(ui.search.toLowerCase()) ||
              x.symbol.toLowerCase().includes(ui.search.toLowerCase())),
        )
        .sort((a, b) => {
          if (ui.sort === 'oi') {
            if (a.oiUsd === null && b.oiUsd !== null) return 1;
            if (b.oiUsd === null && a.oiUsd !== null) return -1;
          }
          const aval =
            ui.sort === 'volume'
              ? a.volumeUsd24h
              : ui.sort === 'oi'
                ? (a.oiUsd ?? -1)
                : benchmarkReturn === null
                  ? 0
                  : relativeReturn(a.return24h, benchmarkReturn);
          const bval =
            ui.sort === 'volume'
              ? b.volumeUsd24h
              : ui.sort === 'oi'
                ? (b.oiUsd ?? -1)
                : benchmarkReturn === null
                  ? 0
                  : relativeReturn(b.return24h, benchmarkReturn);
          return (aval - bval) * (ui.descending ? -1 : 1);
        }),
    [assets, ui.search, ui.sort, ui.venue, ui.descending, benchmarkReturn],
  );
  return (
    <Card
      title={`Perpetual markets · ${filtered.length}`}
      aside={
        <button className="subtle" onClick={() => ui.setDescending(!ui.descending)}>
          <ArrowDownUp size={14} /> {ui.descending ? 'High → Low' : 'Low → High'}
        </button>
      }
    >
      <div className="controls">
        <div className="searchbox">
          <Search size={16} />
          <input
            aria-label="Search assets"
            placeholder="Search assets…"
            value={ui.search}
            onChange={(e) => ui.setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Exchange"
          value={ui.venue}
          onChange={(e) => ui.setVenue(e.target.value as typeof ui.venue)}
        >
          <option value="all">Both venues</option>
          <option value="binance">Binance</option>
          <option value="hyperliquid">Hyperliquid</option>
        </select>
        <select
          aria-label="Sort by"
          value={ui.sort}
          onChange={(e) => ui.setSort(e.target.value as typeof ui.sort)}
        >
          <option value="volume">Sort: 24h volume</option>
          <option value="relative">Sort: relative %</option>
          <option value="oi">Sort: open interest</option>
        </select>
      </div>
      <div className="market-scroller">
        <table className="market-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th className="number">Price</th>
              <th className="number">24h</th>
              <th className="number">Vs benchmark</th>
              <th className="number">24h volume</th>
              <th className="number">OI (USD)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, visibleRows).map((x) => {
              const relative = benchmarkReturn !== null ? relativeReturn(x.return24h, benchmarkReturn) : null;
              return (
                <tr
                  key={x.id}
                  className={selectedId === x.id ? 'selected' : ''}
                  onClick={() => ui.setAsset(x.id)}
                >
                  <td>
                    <button
                      className="asset-name asset-button"
                      aria-label={`Inspect ${x.base} on ${x.venue}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        ui.setAsset(x.id);
                      }}
                    >
                      <BadgeVenue venue={x.venue} />
                      <span>
                        <b>{x.base}</b>
                        <small>{x.venue === 'binance' ? 'Binance perp' : 'Hyperliquid perp'}</small>
                      </span>
                    </button>
                  </td>
                  <td className="number font-medium">{price(x.price)}</td>
                  <td className={'number ' + (x.return24h >= 0 ? 'positive' : 'negative')}>
                    {pct(x.return24h)}
                  </td>
                  <td
                    className={
                      'number ' + (relative === null ? 'muted' : relative >= 0 ? 'positive' : 'negative')
                    }
                  >
                    {relative === null ? 'N/A' : pct(relative)}
                  </td>
                  <td className="number">{money(x.volumeUsd24h)}</td>
                  <td className="number">{x.oiUsd === null ? 'Select ↗' : money(x.oiUsd)}</td>
                  <td>
                    <ChevronRight size={16} className="text-muted" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row-between mt-3">
        <span className="small-label">
          Showing {Math.min(visibleRows, filtered.length)} of {filtered.length} matching markets
        </span>
        {visibleRows < filtered.length && (
          <button className="secondary" onClick={() => setVisibleRows((n) => n + 50)}>
            Show 50 more
          </button>
        )}
      </div>
      <p className="footnote">
        24h rolling performance. Relative return = (1 + alt return) / (1 + benchmark return) − 1. Same
        instrument may appear on both venues; prices are not pooled. Historical and volume data can have
        different exchange conventions.
      </p>
    </Card>
  );
}
function Snapshot({ assets, benchmark, isUsd }: { assets: Market[]; benchmark: Market | null; isUsd: boolean }) {
  const movers = [...assets].sort((a, b) => b.return24h - a.return24h);
  const total = assets.reduce((s, a) => s + a.volumeUsd24h, 0);
  return (
    <div className="metric-grid">
      <div className="metric">
        <span>Tracked markets</span>
        <strong>{assets.length}</strong>
        <small>Available venue contracts</small>
      </div>
      <div className="metric">
        <span>24h reported volume</span>
        <strong>{money(total)}</strong>
        <small>Available snapshots · may be partial</small>
      </div>
      <div className="metric">
        <span>Top 24h mover</span>
        <strong>{movers[0]?.base ?? '—'}</strong>
        <small className="positive">{movers[0] ? pct(movers[0].return24h) : '—'}</small>
      </div>
      <div className="metric">
        <span>Benchmark · 24h</span>
        <strong>{isUsd ? 'USD / USDT' : benchmark?.base ?? '—'}</strong>
        <small className={(benchmark?.return24h ?? 0) >= 0 ? 'positive' : 'negative'}>
          {isUsd ? '0.00%' : benchmark ? pct(benchmark.return24h) : 'Unavailable'}
        </small>
      </div>
    </div>
  );
}
function AssetChart({
  item,
  candles,
}: {
  item: Market | undefined;
  candles: Awaited<ReturnType<typeof api.asset>>['candles'] | undefined;
}) {
  return (
    <Card title="Selected market" aside={<span className="small-label">Completed candles only</span>}>
      {item ? (
        <>
          <div className="asset-chart-head">
            <div>
              <div className="selected-title">
                <BadgeVenue venue={item.venue} />
                <h2>{item.base}</h2>
                <Pill>{item.venue}</Pill>
              </div>
              <div className="big-price">{price(item.price)}</div>
              <div className={item.return24h >= 0 ? 'positive' : 'negative'}>
                {pct(item.return24h)} past 24h
              </div>
            </div>
            <Pill>
              <Radio size={12} /> Quote · {clock(item.asOf)}
            </Pill>
          </div>
          {candles?.length ? <LineChart data={candles} /> : <Loading label="Fetching historical bars…" />}
        </>
      ) : (
        <p className="empty">Select an asset to inspect</p>
      )}
    </Card>
  );
}
function Insights({
  item,
  detail,
}: {
  item: Market | undefined;
  detail: Awaited<ReturnType<typeof api.asset>> | undefined;
}) {
  const ui = useUi();
  if (!item) return null;
  return (
    <Card
      title="Price structure & positioning"
      aside={<span className="small-label">{ui.tf} timeframe</span>}
    >
      <div className="insight-grid">
        <div>
          <span className="tiny-label">Open interest · USD</span>
          <strong>
            {detail?.openInterestUsd === null || detail?.openInterestUsd === undefined
              ? 'Not loaded'
              : money(detail.openInterestUsd)}
          </strong>
        </div>
        <div>
          <span className="tiny-label">Liquidations · observed 5m</span>
          <strong className="negative">
            {detail?.liquidations.observedUsd == null
              ? 'Unavailable'
              : money(detail.liquidations.observedUsd)}
          </strong>
          <small className="muted">
            {item.venue === 'hyperliquid'
              ? 'Market-wide stream not implemented'
              : !detail?.liquidations.available
                ? 'Stream disconnected / not loaded'
                : detail.liquidations.windowCovered
                  ? 'Partial exchange snapshots'
                  : 'Collecting the 5-minute window'}
          </small>
        </div>
        <div>
          <span className="tiny-label">OI / {ui.benchmark} OI</span>
          <strong>
            {detail?.benchmarkOI?.ratio === null || detail?.benchmarkOI?.ratio === undefined
              ? 'Unavailable'
              : (detail.benchmarkOI.ratio * 100).toFixed(2) + '%'}
          </strong>
          <small className="muted">
            {ui.benchmark === 'USD' ? 'Cash baseline: no open interest' : detail?.benchmarkOI ? (detail.benchmarkOI.venueMatched ? 'Same exchange' : 'Cross-exchange / approximate') : 'Unavailable'}
          </small>
        </div>
        <div>
          <span className="tiny-label">{ui.benchmark} OI</span>
          <strong>{detail?.benchmarkOI?.usd ? money(detail.benchmarkOI.usd) : 'Unavailable'}</strong>
        </div>
      </div>
      <div className="levels">
        <h4>Calculated price levels</h4>
        {detail?.levels.length ? (
          detail.levels.map((x, i) => (
            <div className="level" key={i}>
              <span className={x.kind === 'support' ? 'positive' : 'negative'}>
                {x.kind === 'support' ? 'Support' : 'Resistance'}
              </span>
              <strong>{price(x.price)}</strong>
              <small>{x.note}</small>
            </div>
          ))
        ) : (
          <span className="muted">No completed bar history.</span>
        )}
      </div>
      {detail?.liquidationPriceClusters.length ? (
        <div className="levels">
          <h4>Observed liquidation execution price clusters · last 60m</h4>
          {detail.liquidationPriceClusters.map((l, i) => (
            <div className="level" key={i}>
              <span className="negative">{money(l.notionalUsd)}</span>
              <strong>{price(l.price)}</strong>
              <small>
                {l.count} forced-order snapshot(s) in 0.25% price bins. Not projected future liquidations.
              </small>
            </div>
          ))}
        </div>
      ) : null}
      <div className="notice small-notice">
        <CircleHelp size={16} /> Actual future liquidation clusters cannot be inferred from open interest
        alone. Reported liquidations are partial exchange snapshots; levels above are historical-price
        calculations, not verified exchange orders.
      </div>
    </Card>
  );
}
function ModelCard({
  model,
  signal,
}: {
  model: { id: SignalModel; name: string; description: string };
  signal?: EntrySignal;
}) {
  return (
    <div className={'model-card ' + (signal ? 'signal-active' : '')}>
      <div className="model-top">
        <span className="model-icon">
          <Activity size={17} />
        </span>
        <div>
          <b>{model.name}</b>
          <small>{model.description}</small>
        </div>
        <Pill tone={signal ? (signal.direction === 'long' ? 'green' : 'red') : 'muted'}>
          {signal ? signal.direction.toUpperCase() : 'NO SETUP'}
        </Pill>
      </div>
      {signal ? (
        <div className="model-signal">
          <p>{signal.detail}</p>
          <div className="signal-metrics">
            <div>
              <small>Trigger reference</small>
              <b>{price(signal.trigger)}</b>
            </div>
            <div>
              <small>Invalidation</small>
              <b>{price(signal.stop)}</b>
            </div>
            <div>
              <small>2R example target</small>
              <b>{price(signal.target)}</b>
            </div>
          </div>
          <div className="footnote">
            Candidate on candle {signal.barCloseTime ? 'close' : 'open'} at{' '}
            {clock(signal.barCloseTime ?? signal.barTime)}. Next-bar execution not guaranteed; unvalidated
            performance.
          </div>
        </div>
      ) : (
        <p className="small-label mt-3">Conditions not met on the latest completed candle.</p>
      )}
    </div>
  );
}
function SignalsTab({
  item,
  detail,
  loading,
  error,
}: {
  item: Market | undefined;
  detail: Awaited<ReturnType<typeof api.asset>> | undefined;
  loading: boolean;
  error: unknown;
}) {
  const ui = useUi();
  const scan = useQuery({
    queryKey: ['all-signals', ui.assetId],
    queryFn: ({ signal }) => api.signals(ui.assetId, signal),
    enabled: !!item,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });
  const [direction, setDirection] = useState<'all' | 'long' | 'short'>('all');
  const entries = (scan.data?.signals ?? []).filter(
    (x) => (direction === 'all' || x.direction === direction) && (ui.model === 'all' || x.model === ui.model),
  );
  const checked = scan.data?.inspected.length ?? 0;
  const count = intervalsFor(item?.venue ?? 'binance').length;
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>Four-model entry scanner</h2>
        <p>
          All {count} supported {item?.venue ?? ''} intervals · both LONG and SHORT · scan on completed
          candles only.
        </p>
      </div>
      <div className="notice">
        <ShieldAlert size={18} /> Entry and stop/target references are unvalidated research candidates, not
        executable orders. A missing signal does not predict price direction.
      </div>
      <Card
        title="Full timeframe scan"
        aside={
          <button
            className="secondary"
            disabled={!item || scan.isFetching}
            onClick={() => void scan.refetch()}
          >
            <RefreshCw size={15} /> Rescan all
          </button>
        }
      >
        <div className="row-between flex-wrap gap-3">
          <div>
            <strong>
              {entries.length} candidate{entries.length === 1 ? '' : 's'}
            </strong>
            <div className="small-label">
              {checked}/{count} intervals checked ·{' '}
              {scan.data ? new Date(scan.data.checkedAt).toLocaleTimeString() : 'Awaiting scan'}
            </div>
          </div>
          <Pill>LONG + SHORT</Pill>
        </div>
        <div className="controls mt-3">
          <select
            aria-label="Signal direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="all">Long + short</option>
            <option value="long">Long only</option>
            <option value="short">Short only</option>
          </select>
          <select
            aria-label="Signal model"
            value={ui.model}
            onChange={(e) => ui.setModel(e.target.value as typeof ui.model)}
          >
            <option value="all">All four models</option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
        {!item ? (
          <div className="empty">Select an available market to run the scanner.</div>
        ) : scan.isLoading ? (
          <Loading label="Scanning all exchange-supported timeframes. This may take a little while…" />
        ) : scan.error ? (
          <ErrorText error={scan.error} />
        ) : (
          <>
            {scan.data?.failed.length ? (
              <div className="notice warning mt-3">
                <div>
                  {scan.data.failed.length} timeframe(s) could not be evaluated. An incomplete scan is not a
                  no-signal result.
                  <details>
                    <summary>Show failed intervals</summary>
                    {scan.data.failed.map((x) => (
                      <div key={x.timeframe}>
                        <b>{x.timeframe}</b>: {x.reason}
                      </div>
                    ))}
                  </details>
                </div>
              </div>
            ) : null}
            {entries.length ? (
              <div className="scan-results">
                {entries.map((signal, i) => (
                  <button
                    className="scan-result"
                    key={`${signal.timeframe}-${signal.model}-${signal.direction}-${i}`}
                    onClick={() => ui.setTf(signal.timeframe)}
                    aria-label={`Inspect ${signal.direction} ${signal.label} on ${signal.timeframe}`}
                  >
                    <span className="scan-timeframe">{signal.timeframe}</span>
                    <span>
                      <strong>{signal.label}</strong>
                      <small>
                        {signal.model.toUpperCase()} · {signal.barCloseTime ? 'closed' : 'opened'} at{' '}
                        {clock(signal.barCloseTime ?? signal.barTime)}
                      </small>
                    </span>
                    <Pill tone={signal.direction === 'long' ? 'green' : 'red'}>
                      {signal.direction.toUpperCase()}
                    </Pill>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty">
                {checked === 0
                  ? 'No intervals could be evaluated. Review the feed errors above.'
                  : direction !== 'all' || ui.model !== 'all'
                    ? 'No candidates match these filters.'
                    : 'No model triggered on the latest completed candles of the successfully checked intervals.'}
              </div>
            )}
          </>
        )}
        <p className="footnote">
          Each scan queries one selected asset on all intervals supported by its venue. It does not silently
          scan or trade every token. Results are moment-in-time candidates, not verified hit rates.
        </p>
      </Card>
      <div className="row-between flex-wrap gap-3">
        <h3>
          {item?.base ?? 'Selected market'} · {ui.tf} · latest confirmed candle
        </h3>
        <label className="small-label">
          Inspect timeframe{' '}
          <select
            aria-label="Signal detail timeframe"
            value={ui.tf}
            onChange={(e) => ui.setTf(e.target.value as typeof ui.tf)}
          >
            {intervalsFor(item?.venue ?? 'binance').map((tf) => (
              <option value={tf} key={tf}>
                {tf}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorText error={error} />
      ) : !detail || detail.candles.length < 65 ? (
        <div className="empty">At least 65 valid completed candles are needed to evaluate these models.</div>
      ) : (
        <div className="model-grid">
          {MODELS.map((m) => (
            <ModelCard key={m.id} model={m} signal={detail?.signals.find((s) => s.model === m.id)} />
          ))}
        </div>
      )}
      <Card title="Latest price action">
        {detail?.candles.length ? (
          <LineChart data={detail.candles} height={240} />
        ) : (
          <div className="empty">Awaiting candles</div>
        )}
        <p className="footnote">
          SFP sweep/reclaim; confirmed structural breakout; trend pullback against EMA20/50; range rejection.
          Each uses only historical closed bars. No profitability has been established.
        </p>
      </Card>
    </div>
  );
}
function PairsTab({ item, assets }: { item: Market | undefined; assets: Market[] }) {
  const ui = useUi();
  const [other, setOther] = useState('');
  const scan = useQuery({
    queryKey: ['scan', ui.assetId, ui.tf],
    queryFn: ({ signal }) => api.correlations(ui.assetId, ui.tf, signal),
    enabled: !!item,
    staleTime: 5 * 60_000,
  });
  const candidates = scan.data?.candidates ?? [];
  const chosen = other || candidates[0]?.id || '';
  const pair = useQuery({
    queryKey: ['pair', ui.assetId, chosen, ui.tf],
    queryFn: ({ signal }) => api.pair(ui.assetId, chosen, ui.tf, signal),
    enabled: !!chosen && !!item,
  });
  const match = assets.find((x) => x.id === chosen);
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>Correlation laboratory</h2>
        <p>Screen aligned returns at Pearson r ≥ 0.87, then inspect a dynamically hedged log-price spread.</p>
      </div>
      <Card title="Pair scanner" aside={<Pill tone="green">r ≥ 0.87</Pill>}>
        <div className="row-between gap-3 flex-wrap">
          <div className="pair-head">
            <BadgeVenue venue={item?.venue ?? 'binance'} />
            <strong>{item?.base ?? '—'}</strong>
            <span className="muted">vs same-venue perps</span>
          </div>
          <Segmented
            items={[
              { label: '15m', value: '15m' },
              { label: '1h', value: '1h' },
              { label: '4h', value: '4h' },
            ]}
            value={ui.tf}
            onChange={ui.setTf}
          />
        </div>
        {scan.isLoading ? (
          <Loading label="Screening top-volume assets against historical bars…" />
        ) : scan.error ? (
          <ErrorText error={scan.error} />
        ) : (
          <>
            <div className="candidate-count">
              {candidates.length} matches · {scan.data?.checked ?? 0}/{scan.data?.screened ?? 0} assets
              evaluated
            </div>
            {scan.data?.failed.length ? (
              <div className="notice warning">
                <div>
                  {scan.data.failed.length} assets could not be evaluated.
                  <details>
                    <summary>Show scan failures</summary>
                    {scan.data.failed.map((x) => (
                      <div key={x.asset}>
                        {x.asset}: {x.reason}
                      </div>
                    ))}
                  </details>
                </div>
              </div>
            ) : null}
            <div className="candidate-list">
              {candidates.length ? (
                candidates.map((x) => (
                  <button
                    className={'candidate ' + (chosen === x.id ? 'chosen' : '')}
                    key={x.id}
                    onClick={() => setOther(x.id)}
                  >
                    <span>{x.id.split(':')[1]}</span>
                    <span className="positive">r {x.correlation.toFixed(3)}</span>
                    <span className="muted">z {x.zScore.toFixed(2)}</span>
                    <ChevronRight size={15} />
                  </button>
                ))
              ) : (
                <div className="empty">
                  {scan.data?.checked
                    ? 'No successfully evaluated assets passed 0.87. Failed assets are excluded from this conclusion.'
                    : 'No valid pair comparisons are available. Check feed status and history coverage.'}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
      {chosen && (
        <Card
          title={`Spread analysis · ${item?.base ?? '—'} / ${match?.base ?? chosen.split(':')[1]}`}
          aside={<Pill>{ui.tf}</Pill>}
        >
          {pair.isLoading ? (
            <Loading />
          ) : pair.error ? (
            <ErrorText error={pair.error} />
          ) : pair.data?.stats ? (
            <>
              <div className="metric-grid pair-metrics">
                <div className="metric">
                  <span>Return correlation</span>
                  <strong>{short(pair.data.stats.correlation)}</strong>
                </div>
                <div className="metric">
                  <span>Spread z-score</span>
                  <strong className={Math.abs(pair.data.stats.zScore) > 2 ? 'negative' : ''}>
                    {short(pair.data.stats.zScore)}
                  </strong>
                </div>
                <div className="metric">
                  <span>OLS hedge beta</span>
                  <strong>{short(pair.data.stats.beta)}</strong>
                </div>
                <div className="metric">
                  <span>Mean reversion half-life</span>
                  <strong>
                    {pair.data.stats.halfLifeBars
                      ? short(pair.data.stats.halfLifeBars) + ' bars'
                      : 'Not demonstrated'}
                  </strong>
                </div>
              </div>
              <LineChart
                color="#a5a7ff"
                data={pair.data.stats.spreadSeries.map((x) => ({ value: x.z }))}
                height={180}
              />
              <p className="footnote">
                Hedge ratio fitted using prior 80 bars for each z observation. A high correlation alone does
                NOT establish cointegration. Verify residual stationarity, rolling stability, costs and
                untouched out-of-sample performance before treating deviations as signals.
              </p>
            </>
          ) : (
            <div className="empty">Insufficient matching history to form a valid spread.</div>
          )}
        </Card>
      )}
    </div>
  );
}
function AlertsTab({ item }: { item: Market | undefined }) {
  const client = useQueryClient();
  const rules = useQuery({ queryKey: ['alerts'], queryFn: api.alerts, refetchInterval: 15_000 });
  const [kind, setKind] = useState<AlertKind>('volume'),
    [threshold, setThreshold] = useState('100'),
    [direction, setDirection] = useState<'above' | 'below'>('above'),
    [message, setMessage] = useState('');
  const create = useMutation({
    mutationFn: api.createAlert,
    onSuccess: () => {
      setMessage('Alert created. Monitoring runs on your dashboard server.');
      void client.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (e) => setMessage(e.message),
  });
  const remove = useMutation({
    mutationFn: api.deleteAlert,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['alerts'] }),
  });
  async function enablePush() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window))
        throw Error('Push unsupported in this browser');
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw Error('Notification permission was not granted');
      const { key } = await api.vapidKey();
      if (!key) throw Error('Configure VAPID keys on the server first');
      const registration = await navigator.serviceWorker.ready;
      const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes as BufferSource,
      });
      await api.subscribe(sub);
      setMessage('Push notifications enabled for this device.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>Market alerts</h2>
        <p>Price levels, 5-minute notional volume spikes, and exchange-observed liquidation events.</p>
      </div>
      <div className="cols-2">
        <Card title="Create alert">
          <label className="field">
            Asset
            <input value={item?.id ?? ''} disabled aria-label="Alert asset" />
          </label>
          <label className="field">
            Alert type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AlertKind);
                setThreshold(
                  e.target.value === 'liquidation'
                    ? '5000000'
                    : e.target.value === 'price'
                      ? String(item?.price ?? 0)
                      : '100',
                );
              }}
            >
              <option value="volume">5m volume spike (%)</option>
              <option value="price">Price level (USD)</option>
              <option value="liquidation" disabled={item?.venue !== 'binance'}>
                Liquidations in 5m (USD) · Binance
              </option>
            </select>
          </label>
          {kind === 'price' && (
            <label className="field">
              Trigger when
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'above' | 'below')}>
                <option value="above">Price ≥ level</option>
                <option value="below">Price ≤ level</option>
              </select>
            </label>
          )}
          <label className="field">
            {kind === 'volume'
              ? 'Volume above baseline (%)'
              : kind === 'price'
                ? 'Price level (USD)'
                : 'Observed liquidations (USD)'}
            <input
              type="number"
              min="0"
              step="any"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <p className="footnote">
            {kind === 'volume'
              ? 'Compares the latest fully closed 5m candle to the previous 20 closed 5m bars.'
              : kind === 'liquidation'
                ? 'Binance only. Stream captures at most one forced-liquidation snapshot per symbol per second. Amounts are lower-bound observations, not total liquidations.'
                : 'Checks latest available quote approximately once a minute.'}
          </p>
          <button
            className="primary full"
            disabled={
              !item ||
              create.isPending ||
              !navigator.onLine ||
              (kind === 'liquidation' && item.venue !== 'binance') ||
              !Number.isFinite(Number(threshold)) ||
              Number(threshold) <= 0
            }
            onClick={() =>
              item && create.mutate({ assetId: item.id, kind, threshold: Number(threshold), direction })
            }
          >
            <BellRing size={16} /> Create alert
          </button>
          <button className="secondary full mt-3" onClick={() => void enablePush()}>
            <Bell size={16} /> Enable iPhone push notifications
          </button>
          {message && (
            <div role="status" className="notice mt-3">
              {message}
            </div>
          )}
        </Card>
        <Card title="Active rules" aside={<Pill>{rules.data?.alerts.length ?? 0} rules</Pill>}>
          {rules.isLoading ? (
            <Loading />
          ) : rules.error ? (
            <ErrorText error={rules.error} />
          ) : rules.data?.alerts.length ? (
            rules.data.alerts.map((x) => (
              <div className="alert-rule" key={x.id}>
                <div>
                  <b>
                    {x.assetId.split(':')[1]} · {x.kind.toUpperCase()}
                  </b>
                  <small>
                    {x.kind === 'volume'
                      ? `≥ ${x.threshold}% spike`
                      : x.kind === 'price'
                        ? `${x.direction} ${price(x.threshold)}`
                        : `≥ ${money(x.threshold)} / 5m`}
                  </small>
                </div>
                <button aria-label="Delete alert" className="icon-btn" onClick={() => remove.mutate(x.id)}>
                  <X size={18} />
                </button>
              </div>
            ))
          ) : (
            <div className="empty">No active alerts. Choose a rule on the left.</div>
          )}
          {remove.error && <ErrorText error={remove.error} />}
          <h4 className="mt-6 mb-2">Recent triggers</h4>
          {rules.data?.events.length ? (
            rules.data.events.slice(0, 12).map((e) => (
              <div className="alert-event" key={e.id}>
                <span>{e.message}</span>
                <small>{clock(e.time)}</small>
              </div>
            ))
          ) : (
            <div className="small-label">Nothing triggered yet.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
function CalendarTab() {
  const feed = useQuery({
    queryKey: ['calendar'],
    queryFn: api.calendar,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  return (
    <div className="content-stack">
      <div className="section-intro">
        <h2>High-impact economic calendar</h2>
        <p>
          Major macro events only. Default scope: United States; scheduled releases shown in your local
          timezone.
        </p>
      </div>
      <Card title="Upcoming releases" aside={<Pill tone="red">HIGH IMPACT ONLY</Pill>}>
        {feed.isLoading ? (
          <Loading />
        ) : feed.error ? (
          <ErrorText error={feed.error} />
        ) : (
          <>
            {feed.data?.message && (
              <div className="notice">
                <CircleHelp size={17} />
                {feed.data.message}
              </div>
            )}
            {feed.data?.events.length ? (
              feed.data.events.map((e) => (
                <div className="event" key={e.id}>
                  <div className="event-date">
                    <strong>
                      {new Date(e.time).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                    </strong>
                    <small>
                      {new Date(e.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </small>
                  </div>
                  <div className="event-info">
                    <b>{e.title}</b>
                    <small>{e.country}</small>
                  </div>
                  <div className="event-data">
                    <small>Forecast</small>
                    <strong>{e.forecast || '—'}</strong>
                  </div>
                  <div className="event-data">
                    <small>Previous</small>
                    <strong>{e.previous || '—'}</strong>
                  </div>
                  <Pill tone="red">HIGH</Pill>
                </div>
              ))
            ) : (
              <div className="empty">
                No verified upcoming high-impact events from your configured source.
              </div>
            )}
          </>
        )}
        <p className="footnote">
          Calendar data requires a provider key, stored server-side. The application intentionally never
          inserts hard-coded upcoming releases. Source: Trading Economics API (Importance = 3).
        </p>
      </Card>
    </div>
  );
}
function Intro({ tab }: { tab: Tab }) {
  return (
    <div className="welcome">
      <div>
        <div className="eyebrow">
          <span className="live-dot" /> QUANT MARKET TERMINAL
        </div>
        <h1>{tab === 'overview' ? 'Market overview' : NAV.find((x) => x.id === tab)?.label}</h1>
        <p>Exchange snapshots, relative strength and structured research.</p>
      </div>
      <div className="date-box">
        <Radio size={16} /> Market feeds · 24/7
      </div>
    </div>
  );
}
function InstallControls() {
  const [install, setInstall] = useState<BeforeInstallPromptEvent | null>(null),
    [ios, setIos] = useState(false),
    [showUpdate, setShowUpdate] = useState(false),
    [update, setUpdate] = useState<((reloadPage?: boolean) => Promise<void>) | null>(null);
  useEffect(() => {
    const sw = registerSW({
      onNeedRefresh() {
        setShowUpdate(true);
      },
      onOfflineReady() {
        console.info('Offline shell ready');
      },
    });
    setUpdate(() => sw);
    const listener = (e: Event) => {
      e.preventDefault();
      setInstall(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', listener);
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
        !(
          'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
        ),
    );
    return () => window.removeEventListener('beforeinstallprompt', listener);
  }, []);
  return (
    <>
      {install && (
        <button
          className="install"
          onClick={() => {
            void install.prompt();
            setInstall(null);
          }}
        >
          <Download size={15} /> Install app
        </button>
      )}
      {ios && (
        <div className="ios-help">
          iOS: Safari → Share → <strong>Add to Home Screen</strong> to enable install and supported Web Push.
        </div>
      )}
      {showUpdate && (
        <div className="update-banner">
          <span>New version available</span>
          <button onClick={() => void update?.(true)}>Update now</button>
        </div>
      )}
    </>
  );
}
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}
function App() {
  const { ui, mk, asset, selected } = useDashboard();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const degraded =
    mk.isError ||
    !navigator.onLine ||
    !mk.data ||
    !mk.data.feeds ||
    mk.data.feeds.some(
      (f) => f.status !== 'live' || f.lastSuccessAt === null || now - f.lastSuccessAt > 60_000,
    );
  const benchmark = ui.benchmark === 'USD' ? null : mk.data?.benchmarks?.[ui.benchmark] ?? null;
  const [menu, setMenu] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <div className="layout">
      <aside className={'sidebar ' + (menu ? 'side-open' : '')}>
        <a className="logo" href="/">
          <span className="logo-icon">
            <Activity size={23} />
          </span>
          <span>
            FLUX<span className="logo-highlight">DESK</span>
            <small>MARKET INTELLIGENCE</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {NAV.map((x) => (
            <button
              key={x.id}
              className={'nav-link ' + (ui.tab === x.id ? 'current' : '')}
              onClick={() => {
                ui.setTab(x.id);
                setMenu(false);
              }}
            >
              <x.icon size={19} />
              {x.label}
              {ui.tab === x.id && <span className="nav-marker" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="notice tiny-notice">
            <ShieldAlert size={16} /> Research-only. No automatic trading or validated predictive edge.
          </div>
          <small>FLUXDESK / v0.3 RESEARCH PREVIEW</small>
        </div>
      </aside>
      <div className="body">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <div className="crumb">
            Workspace <ChevronRight size={14} /> <b>{NAV.find((x) => x.id === ui.tab)?.label}</b>
          </div>
          <div className="top-actions">
            <span className="top-status">
              <span className={'live-dot ' + (degraded ? 'error-dot' : '')} />
              {degraded ? 'Feeds need attention' : 'Feeds · ~45s'}
            </span>
            <InstallControls />
          </div>
        </header>
        <main>
          <Intro tab={ui.tab} />
          {ui.tab !== 'research' && <div className="selector-bar">
            <div className="selected-input">
              <span className="tiny-label">SELECTED ASSET</span>
              <select
                aria-label="Selected asset"
                value={ui.assetId}
                onChange={(e) => ui.setAsset(e.target.value)}
              >
                {!selected && <option value={ui.assetId}>{ui.assetId.split(':')[1]} · unavailable</option>}
                {(mk.data?.assets ?? []).map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.base} · {x.venue}
                  </option>
                ))}
              </select>
            </div>
            <div className="selected-input">
              <span className="tiny-label">COMPARE AGAINST</span>
              <BenchmarkSelector value={ui.benchmark} assets={mk.data?.assets ?? []} onChange={ui.setBenchmark} />
            </div>
            <div className="selected-input">
              <span className="tiny-label">TIMEFRAME</span>
              <select
                aria-label="Analysis timeframe"
                value={ui.tf}
                onChange={(e) => ui.setTf(e.target.value as typeof ui.tf)}
              >
                {intervalsFor(selected?.venue ?? 'binance').map((x) => (
                  <option value={x} key={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>}
          {offline && (
            <div className="notice warning">
              <WifiOff size={17} /> Offline: showing cached views when available. Live market and alerts
              require connectivity to the dashboard server.
            </div>
          )}
          {mk.isError && <ErrorText error={mk.error} />} {mk.isLoading && <Loading />}
          {mk.data && (
            <FeedHealth feeds={mk.data.feeds ?? []} now={now} disconnected={offline || mk.isError} />
          )}
          {!selected && mk.data?.assets.length ? (
            <div className="notice warning selection-warning">
              <span>The selected contract is unavailable in the current snapshot.</span>
              <button className="secondary" onClick={() => ui.setAsset(mk.data.assets[0]!.id)}>
                Inspect {mk.data.assets[0]!.base} on {mk.data.assets[0]!.venue}
              </button>
            </div>
          ) : null}
          {ui.tab === 'overview' && (
            <div className="content-stack">
              <Snapshot assets={mk.data?.assets ?? []} benchmark={benchmark} isUsd={ui.benchmark === 'USD'} />
              <div className="overview-grid">
                <AssetChart item={selected} candles={asset.isError ? undefined : asset.data?.candles} />
                <Insights item={selected} detail={asset.isError ? undefined : asset.data} />
              </div>
              {asset.error && <ErrorText error={asset.error} />}
              <MarketTable
                assets={mk.data?.assets ?? []}
                benchmarkReturn={ui.benchmark === 'USD' ? 0 : benchmark?.return24h ?? null}
                selectedId={ui.assetId}
              />
            </div>
          )}
          {ui.tab === 'signals' && (
            <SignalsTab
              key={ui.assetId}
              item={selected}
              detail={asset.isError ? undefined : asset.data}
              loading={asset.isLoading}
              error={asset.error}
            />
          )}
          {ui.tab === 'pairs' && <PairsTab key={ui.assetId} item={selected} assets={mk.data?.assets ?? []} />}
          {ui.tab === 'alerts' && <AlertsTab item={selected} />}
          {ui.tab === 'calendar' && <CalendarTab />}
          {ui.tab === 'research' && (
            <Suspense fallback={<Loading label="Loading Strategy Lab…"/>}>
              <StrategyLab initialAssetId={ui.assetId} offline={offline}/>
            </Suspense>
          )}
          <footer className="app-footer">
            Data: Binance USDⓈ-M & Hyperliquid perps · Market data may be delayed or unavailable · No
            execution connected
          </footer>
        </main>
      </div>
      <div className="bottom-nav" role="navigation" aria-label="Mobile navigation">
        {NAV.map((x) => (
          <button key={x.id} className={ui.tab === x.id ? 'active' : ''} onClick={() => ui.setTab(x.id)}>
            <x.icon size={20} />
            <span>
              {x.id === 'overview'
                ? 'Markets'
                : x.id === 'signals'
                  ? 'Signals'
                  : x.id === 'pairs'
                    ? 'Pairs'
                    : x.id === 'research'
                      ? 'Lab'
                      : x.id === 'alerts'
                      ? 'Alerts'
                      : 'Macro'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
export default App;
