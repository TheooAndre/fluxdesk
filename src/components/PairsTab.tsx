import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useUi } from '../lib/store.ts';
import type { Market } from '../types.ts';
import { short } from '../lib/format.ts';
const StatArbScanner = lazy(() => import('./StatArbScanner.tsx'));
import LineChart from './LineChart.tsx';
import { Pill, ErrorText, Loading, Card, BadgeVenue, Segmented } from './UiPrimitives.tsx';

function CorrelationScanner({ item, assets }: { item: Market | undefined; assets: Market[] }) {
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

function PairsTab(props: { item: Market | undefined; assets: Market[] }) {
  const [view, setView] = useState<'scanner' | 'statarb'>('scanner');
  return <div className="content-stack">
    <div role="group" aria-label="Correlation lab views">
      <Segmented items={[{ label: 'Correlation scanner', value: 'scanner' }, { label: 'Stat-arb scanner', value: 'statarb' }]} value={view} onChange={setView} />
    </div>
    {view === 'statarb' ? <Suspense fallback={<Loading label="Loading stat-arb scanner…"/>}><StatArbScanner /></Suspense> : <CorrelationScanner {...props} />}
  </div>;
}
export default PairsTab;
