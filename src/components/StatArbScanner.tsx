import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { useUi } from '../lib/store.ts';
import { downloadJson } from '../journal/files.ts';
import type { ScanConfig, ScanPair } from '../../server/statarb-scanner.ts';
import { Card } from './UiPrimitives.tsx';
import './Workspaces.css';
const Research = lazy(() => import('./StatArbResearch.tsx'));
export default function StatArbScanner() {
  const qc = useQueryClient();
  const [venue, setVenue] = useState<ScanConfig['venue']>('binance'),
    [timeframe, setTimeframe] = useState<ScanConfig['timeframe']>('4h'),
    [formationBars, setBars] = useState<ScanConfig['formationBars']>(300),
    [preset, setPreset] = useState<ScanConfig['preset']>('crypto'),
    [onlySignals, setOnly] = useState(true),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [notes, setNotes] = useState(false),
    [message, setMessage] = useState('');
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
  const rows = (scan?.results ?? []).filter(
    (r) =>
      (!onlySignals || Math.abs(r.z) >= 2) &&
      (!search || (r.y + ' ' + r.x).toLowerCase().includes(search.toLowerCase())),
  );
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
              {[
                '1m',
                '3m',
                '5m',
                '15m',
                '30m',
                '1h',
                '2h',
                '4h',
                ...(venue === 'binance' ? ['6h'] : []),
                '8h',
                '12h',
                '1d',
              ].map((tf) => (
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
        <p className="footnote">
          Every supported live venue asset is attempted: Binance USDT perpetuals or Hyperliquid’s native
          perpetual universe, matching the terminal feed. All unordered pairs with complete matching history
          are tested. No volume, OI or correlation cutoff. Requests are paced to reserve venue rate-limit
          capacity. History is pinned to the scan start; a venue-wide scan can take several minutes. One scan
          at a time; results stay in server memory until restart or the next scan.
        </p>
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
        <p className="footnote">
          Directions refer to y − βx in log prices. Notional weights, not equal coin quantities. Latest
          completed candle is the signal observation; quoted fills, funding, liquidity and future convergence
          are not assumed.
        </p>
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
