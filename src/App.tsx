import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { registerSW } from 'virtual:pwa-register';
import { Activity, BarChart3, Bell, CalendarDays, ChevronRight, CircleHelp, Download, FlaskConical, GitCompareArrows, Menu, Radio, Search, ShieldAlert, WifiOff, Zap, ArrowDownUp } from 'lucide-react';
import { api } from './lib/api.ts';
import { useUi, type Tab } from './lib/store.ts';
import { money, pct, price, clock } from './lib/format.ts';
import { relativeReturn } from './engine/stats.ts';
import type { Market } from './types.ts';
import LineChart from './components/LineChart.tsx';
import { intervalsFor } from './engine/intervals.ts';
import FeedHealth from './components/FeedHealth.tsx';
import BenchmarkSelector from './components/BenchmarkSelector.tsx';
import { Card, Pill, Loading, ErrorText, BadgeVenue } from './components/UiPrimitives.tsx';
// Loaded only when research is opened, preserving overview startup performance.
const StrategyLab = lazy(() => import('./components/StrategyLab.tsx'));
const SignalsTab = lazy(() => import('./components/SignalsTab.tsx'));
const PairsTab = lazy(() => import('./components/PairsTab.tsx'));
const AlertsTab = lazy(() => import('./components/AlertsTab.tsx'));
const CalendarTab = lazy(() => import('./components/CalendarTab.tsx'));
const NAV: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Markets', icon: BarChart3 },
  { id: 'signals', label: 'Entry models', icon: Zap },
  { id: 'pairs', label: 'Correlation', icon: GitCompareArrows },
  { id: 'research', label: 'Strategy Lab', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'calendar', label: 'Macro calendar', icon: CalendarDays },
];
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
            <Suspense fallback={<Loading label="Loading entry models…"/>}>
              <SignalsTab
                key={ui.assetId}
                item={selected}
                detail={asset.isError ? undefined : asset.data}
                loading={asset.isLoading}
                error={asset.error}
              />
            </Suspense>
          )}
          {ui.tab === 'pairs' && (
            <Suspense fallback={<Loading label="Loading correlations…"/>}>
              <PairsTab key={ui.assetId} item={selected} assets={mk.data?.assets ?? []} />
            </Suspense>
          )}
          {ui.tab === 'alerts' && (
            <Suspense fallback={<Loading label="Loading alerts…"/>}><AlertsTab item={selected}/></Suspense>
          )}
          {ui.tab === 'calendar' && (
            <Suspense fallback={<Loading label="Loading macro calendar…"/>}><CalendarTab/></Suspense>
          )}
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
