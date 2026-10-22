import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronRight, ShieldAlert, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useUi } from '../lib/store.ts';
import type { Market, EntrySignal, SignalModel } from '../types.ts';
import { price, short, clock } from '../lib/format.ts';
import LineChart from './LineChart.tsx';
import { intervalsFor } from '../engine/intervals.ts';
import { Pill, ErrorText, Loading, Card } from './UiPrimitives.tsx';

const MODELS: { id: SignalModel; name: string; description: string }[] = [
  { id: 'sfp', name: 'Swing Failure Pattern', description: 'Liquidity sweep and reclaim' },
  { id: 'msb', name: 'Market Structure Break', description: 'Close beyond confirmed swing' },
  { id: 'pullback', name: 'Trend Continuation', description: 'EMA20 pullback in EMA50 trend' },
  { id: 'range', name: 'Consolidation / Chop', description: 'Range boundary rejection' },
];
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

export default SignalsTab;
