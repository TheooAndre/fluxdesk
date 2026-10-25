import { lazy, Suspense, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { useUi } from '../lib/store.ts';
import { downloadJson } from '../journal/files.ts';
import type { ScanConfig, ScanPair } from '../../server/statarb-scanner.ts';
import {
  SCANNER_TIMEFRAMES,
  SCAN_PREFERENCES_KEY,
  readScanPreferences,
  scanCandleAge,
  type ScanPreferences,
} from '../engine/statarb-settings.ts';
import { Card, HelpDetails } from './UiPrimitives.tsx';
import './Workspaces.css';
const Research = lazy(() => import('./StatArbResearch.tsx'));
export default function StatArbScanner() {
  const qc = useQueryClient();
  const [saved] = useState(() => {
    try {
      return readScanPreferences(localStorage.getItem(SCAN_PREFERENCES_KEY));
    } catch {
      return readScanPreferences(null);
    }
  });
  const [venue, setVenue] = useState<ScanConfig['venue']>(saved.config.venue),
    [timeframe, setTimeframe] = useState<ScanConfig['timeframe']>(saved.config.timeframe),
    [formationBars, setBars] = useState<ScanConfig['formationBars']>(saved.config.formationBars),
    [preset, setPreset] = useState<ScanConfig['preset']>(saved.config.preset),
    [onlySignals, setOnly] = useState(saved.onlySignals),
    [sort, setSort] = useState<ScanPreferences['sort']>(saved.sort),
    [direction, setDirection] = useState<ScanPreferences['direction']>(saved.direction),
    [now, setNow] = useState(Date.now),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [notes, setNotes] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem(
        SCAN_PREFERENCES_KEY,
        JSON.stringify({
          version: 1,
          config: { venue, timeframe, formationBars, preset },
          onlySignals,
          sort,
          direction,
        }),
      );
    } catch {
      setMessage('Scanner settings could not be saved on this device.');
    }
  }, [venue, timeframe, formationBars, preset, onlySignals, sort, direction]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  const status = useQuery({
    queryKey: ['statarb-scan'],
    queryFn: api.statarbStatus,
    refetchInterval: (q) =>
      q.state.data?.scan && ['fetching', 'testing'].includes(q.state.data.scan.status) ? 2000 : false,
  });
  const start = useMutation({
    mutationFn: () => api.startStatArb({ venue, timeframe, formationBars, preset }),
    onSuccess: (v) => {
      qc.setQueryData(['statarb-scan'], v);
      setPage(0);
    },
    onError: (e) => setMessage(e.message),
  });
  const cancel = useMutation({
    mutationFn: api.cancelStatArb,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['statarb-scan'] }),
  });
  const scan = status.data?.scan,
    active = !!scan && ['fetching', 'testing'].includes(scan.status);
  const rows = (scan?.results ?? [])
    .filter(
      (r) =>
        (!onlySignals || Math.abs(r.z) >= 2) &&
        (direction === 'all' || r.direction === direction) &&
        (!search || (r.y + ' ' + r.x).toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) => {
      const ranked =
        sort === 'deviation'
          ? Math.abs(b.z) - Math.abs(a.z)
          : sort === 'halfLife'
            ? (a.halfLife ?? Infinity) - (b.halfLife ?? Infinity)
            : a.adf - b.adf;
      return ranked || a.y.localeCompare(b.y) || a.x.localeCompare(b.x);
    });
  const seed = (r: ScanPair) => {
    try {
      if (
        localStorage.getItem('fluxdesk.journal.draft.v1') &&
        !window.confirm('Replace your saved device trade draft with this pair?')
      )
        return;
      sessionStorage.setItem(
        'fluxdesk.journal.pair',
        JSON.stringify({ ...r, timeframe: scan!.config.timeframe }),
      );
      useUi.getState().setTab('journal');
    } catch {
      setMessage('Could not open journal draft on this device');
    }
  };
  return (
    <div className="content-stack workspace">
      <Card title="Venue-wide stat-arb scanner">
        <p>Log-price hedge · 90-bar z-score · entry ±2 · mean exit ±0.5 · stop reference ±4.</p>
        <div className="workspace-controls">
          <label>
            Scanner venue
            <select
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value as ScanConfig['venue']);
                if (timeframe === '6h') setTimeframe('4h');
              }}
            >
              <option value="binance">Binance</option>
              <option value="hyperliquid">Hyperliquid</option>
            </select>
          </label>
          <label>
            Scanner timeframe
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as ScanConfig['timeframe'])}
            >
              {SCANNER_TIMEFRAMES.filter((tf) => venue === 'binance' || tf !== '6h').map((tf) => (
                <option key={tf}>{tf}</option>
              ))}
            </select>
          </label>
          <label>
            Formation bars
            <select
              value={formationBars}
              onChange={(e) => setBars(Number(e.target.value) as ScanConfig['formationBars'])}
            >
              {[180, 300, 500, 1080].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 1080 ? ' · original formation length' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pair selection
            <select value={preset} onChange={(e) => setPreset(e.target.value as ScanConfig['preset'])}>
              <option value="crypto">Crypto · 10% (looser)</option>
              <option value="selective">Selective · 5% + stability</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={active || start.isPending || !navigator.onLine}
            onClick={() => {
              setMessage('');
              start.mutate();
            }}
          >
            Scan all venue assets
          </button>
          <button
            className="secondary"
            disabled={!active || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel scan
          </button>
        </div>
        <HelpDetails title="Scan coverage and limits">
          Every supported live venue asset is attempted: Binance USDT perpetuals or Hyperliquid’s native
          perpetual universe, matching the terminal feed. All unordered pairs with complete matching history
          are tested. No volume, OI or correlation cutoff. Requests are paced to reserve venue rate-limit
          capacity. History is pinned to the scan start; a venue-wide scan can take several minutes. One scan
          at a time; results stay in server memory until restart or the next scan.
        </HelpDetails>
        <details>
          <summary>Method and filter differences</summary>{' '}
          <p className="footnote">
            Engle–Granger residual ADF with one lag and MacKinnon critical values. The crypto preset relaxes
            the original research’s I(1), stability, half-life and multiple-testing gates. These are
            unadjusted discovery candidates; testing many pairs can produce false positives. It is not the
            original BIC-lag research validation or an execution signal.
          </p>
        </details>
        {(message || status.error || cancel.error) && (
          <p role="alert" className="notice warning">
            {message || status.error?.message || cancel.error?.message}
          </p>
        )}
        {scan && (
          <div role="status" className="notice">
            <div>
              <b>
                {scan.status.toUpperCase()} · {scan.config.venue} · {scan.config.timeframe}
              </b>
              <p>
                {scan.loaded}/{scan.universe} histories loaded · {scan.failed.length} failed · {scan.tested}/
                {scan.totalPairs} pairs tested · {scan.invalidPairs} invalid pairs · {scan.passed} pass screen
                · {scan.opportunities} at |z| ≥ 2.
              </p>
              <small>
                Scan started {new Date(scan.startedAt).toLocaleString()}. Showing up to 500 highest-ranked
                candidates; counts include all tested pairs.
              </small>
              {active && (
                <progress
                  aria-label={scan.status === 'fetching' ? 'Venue history progress' : 'Pair testing progress'}
                  max={(scan.status === 'fetching' ? scan.universe : scan.totalPairs) || 1}
                  value={scan.status === 'fetching' ? scan.loaded + scan.failed.length : scan.tested}
                />
              )}
              {scan.error && <p>{scan.error}</p>}
            </div>
          </div>
        )}
        {scan?.failed.length ? (
          <details>
            <summary>History failures ({scan.failed.length})</summary>
            <div className="workspace-scroll">
              {scan.failed.map((f) => (
                <p key={f.asset}>
                  {f.asset}: {f.reason}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </Card>
      <Card title="Cointegration candidates">
        <div className="workspace-controls">
          <label>
            <span>
              <input
                type="checkbox"
                checked={onlySignals}
                onChange={(e) => {
                  setOnly(e.target.checked);
                  setPage(0);
                }}
              />{' '}
              Only |z| ≥ 2
            </span>
          </label>
          <label>
            Search pairs
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label>
            Rank candidates
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as ScanPreferences['sort']);
                setPage(0);
              }}
            >
              <option value="strength">Cointegration strength</option>
              <option value="deviation">Largest |z-score|</option>
              <option value="halfLife">Shortest finite half-life</option>
            </select>
          </label>
          <label>
            Spread direction
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as ScanPreferences['direction']);
                setPage(0);
              }}
            >
              <option value="all">All directions</option>
              <option value="long_spread">Long spread</option>
              <option value="short_spread">Short spread</option>
              <option value="watch">Watch only</option>
            </select>
          </label>
          <button
            className="secondary"
            disabled={!scan}
            onClick={() => downloadJson('fluxdesk-statarb-scan.json', scan)}
          >
            Download scan JSON
          </button>
        </div>
        <div className="market-scroller">
          <table className="market-table">
            <thead>
              <tr>
                <th>Pair · y / x</th>
                <th>Z-score</th>
                <th>EG strength / ADF</th>
                <th>Hedge β</th>
                <th>Half-life</th>
                <th>Spread stance</th>
                <th>Review</th>
                <th>Journal</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * 25, page * 25 + 25).map((r) => (
                <tr key={r.y + r.x}>
                  <td>
                    {r.y.split(':')[1]} / {r.x.split(':')[1]}
                    <small className="small-label">
                      Signal candle closed{' '}
                      {new Date(
                        scanCandleAge(r.signalTime, scan!.config.timeframe, now).closedAt,
                      ).toLocaleString()}
                    </small>
                    <small className="small-label">
                      {scanCandleAge(r.signalTime, scan!.config.timeframe, now).barsBehind
                        ? `Snapshot ${scanCandleAge(r.signalTime, scan!.config.timeframe, now).barsBehind} candle(s) behind · rescan to refresh`
                        : 'Latest completed interval at scan time'}
                    </small>
                  </td>
                  <td className={r.z >= 2 ? 'negative' : r.z <= -2 ? 'positive' : ''}>
                    {r.z.toFixed(2)}
                    {r.outsideStop ? ' · beyond ±4' : ''}
                  </td>
                  <td>
                    {r.level} · {r.adf.toFixed(3)}
                  </td>
                  <td>{r.beta.toFixed(4)}</td>
                  <td>{r.halfLife?.toFixed(1) ?? 'Not shown'} bars</td>
                  <td>
                    {r.direction === 'watch'
                      ? 'Watch'
                      : `Long ${r.longLeg.split(':')[1]} / short ${r.shortLeg.split(':')[1]}`}
                    <small className="small-label">Notional weights y:x = 1:{r.beta.toFixed(3)}</small>
                  </td>
                  <td>
                    {r.warnings.join('; ') || 'No preset stability flag'}
                    <small className="small-label">β drift {(r.betaDrift * 100).toFixed(1)}%</small>
                  </td>
                  <td>
                    <button className="subtle" onClick={() => seed(r)}>
                      Journal pair
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="empty">
            {active
              ? 'Scanning… candidates appear as pairs are tested.'
              : 'No pairs match the selected view. Run a scan or show watchlist candidates.'}
          </p>
        )}
        <div className="workspace-controls">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous pairs
          </button>
          <span>
            {rows.length} candidates · page {page + 1}
          </span>
          <button disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage((p) => p + 1)}>
            Next pairs
          </button>
        </div>
        <HelpDetails title="Signal interpretation">
          Directions refer to y − βx in log prices. Notional weights, not equal coin quantities. Latest
          completed candle is the signal observation; quoted fills, funding, liquidity and future convergence
          are not assumed. Settings and view preferences save on this device; rankings apply to the retained
          candidates. Candle age updates as time passes; results remain a scan snapshot.
        </HelpDetails>
      </Card>
      <button className="secondary" onClick={() => setNotes(!notes)}>
        {notes ? 'Hide' : 'Show'} original research protocol
      </button>
      {notes && (
        <Suspense fallback={<p>Loading protocol…</p>}>
          <Research />
        </Suspense>
      )}
    </div>
  );
}
