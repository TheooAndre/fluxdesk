import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, FlaskConical, Play, RefreshCw, ShieldAlert } from 'lucide-react';
import type { ResearchConfig } from '../engine/backtest.ts';
import type { StoredResearchReport } from '../../server/research/runner.ts';
import { api } from '../lib/api.ts';
import LineChart from './LineChart.tsx';

type Interval = '15m' | '1h' | '4h' | '1d';
type Model = ResearchConfig['model'];
const modelOptions: { value: Model; label: string }[] = [
  { value: 'sfp', label: 'Swing failure pattern' },
  { value: 'msb', label: 'Market structure break' },
  { value: 'pullback', label: 'EMA trend pullback' },
  { value: 'range', label: 'Range rejection' },
];
const formatUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
const formatResult = (n: number | null, digits = 2) =>
  n === null || !Number.isFinite(n) ? 'N/A' : n.toFixed(digits);
const timestamp = (n: number) => new Date(n).toLocaleString();
const errorText = (e: unknown) => e instanceof Error ? e.message : 'The research request failed';

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="lab-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function ResearchReport({ report }: { report: StoredResearchReport }) {
  const { result, dataset } = report;
  const [maxTrades, setMaxTrades] = useState(25);
  const equity = useMemo(() => {
    let total = result.config.initialEquity;
    return [
      { value: total },
      ...result.trades.map((trade) => {
        total += trade.netPnl;
        return { value: total };
      }),
    ];
  }, [result]);
  return (
    <section className="lab-report" aria-label="Strategy Lab backtest report">
      <div className="lab-report-title">
        <div>
          <div className="lab-overline">RESEARCH REPORT · NO LIVE EXECUTION</div>
          <h2>Backtest results</h2>
          <p>{dataset.assetId} · {dataset.interval} · {dataset.bars.toLocaleString()} completed candles</p>
        </div>
        <span className="pill">ENGINE: {report.engineVersion}</span>
      </div>
      <p className="lab-hypothesis">{result.hypothesis}</p>
      <div className="lab-metrics">
        <Metric label="Completed trades" value={String(result.summary.count)}/>
        <Metric label="Net P&L, after costs" value={formatUsd(result.summary.netPnl)}/>
        <Metric label="Expectancy" value={result.summary.expectancyR === null ? 'N/A' : formatResult(result.summary.expectancyR) + ' R'}/>
        <Metric label="Win rate" value={result.summary.winRate === null ? 'N/A' : formatResult(result.summary.winRate * 100, 1) + '%'}/>
        <Metric label="Closed-trade max drawdown" value={formatResult(result.summary.maxDrawdownPct) + '%'}/>
      </div>
      <div className="lab-samples">
        <article className="lab-sample">
          <h3>Development sample</h3>
          <p>{result.development.count} trades</p>
          <strong>{formatUsd(result.development.netPnl)}</strong>
          <small>Expectancy: {formatResult(result.development.expectancyR)} R</small>
        </article>
        <article className="lab-sample">
          <h3>Chronological holdout sample</h3>
          <p>{result.holdout.count} trades</p>
          <strong>{formatUsd(result.holdout.netPnl)}</strong>
          <small>Expectancy: {formatResult(result.holdout.expectancyR)} R</small>
        </article>
      </div>
      <section className="lab-panel">
        <h3>Closed-trade equity curve</h3>
        {result.trades.length ? <LineChart data={equity} height={180}/> :
          <p className="lab-empty">No trades qualified. The equity curve has no realized observations.</p>}
        <p className="lab-footnote">Equity changes when a trade is closed; interim adverse excursions and mark-to-market risk are not shown.</p>
      </section>
      <section className="lab-panel">
        <h3>Trade log</h3>
        {result.trades.length ? (
          <>
            <div className="lab-table-scroller">
              <table className="lab-table" aria-label="Backtest trade log">
                <thead><tr><th scope="col">Entry</th><th scope="col">Side</th><th scope="col">Exit reason</th><th scope="col">Sample</th><th scope="col">Net P&L</th><th scope="col">R</th></tr></thead>
                <tbody>
                  {result.trades.slice(0, maxTrades).map((trade, index) => (
                    <tr key={trade.entryTime + '-' + index}>
                      <td>{timestamp(trade.entryTime)}</td>
                      <td>{trade.direction.toUpperCase()}</td>
                      <td>{trade.exitReason.replaceAll('_', ' ')}</td>
                      <td>{trade.sample}</td>
                      <td>{formatUsd(trade.netPnl)}</td>
                      <td>{formatResult(trade.rMultiple)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.trades.length > maxTrades &&
              <button className="lab-action-secondary" onClick={() => setMaxTrades((n) => n + 25)}>
                Show more trades
              </button>}
          </>
        ) : <p className="lab-empty">No qualifying entries were found for this configuration and historical sample.</p>}
      </section>
      <section className="lab-warnings" aria-label="Research limitations">
        <h3><ShieldAlert size={17} aria-hidden="true"/> Limitations and risk disclosures</h3>
        <ul>
          {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
        <p className="lab-footnote">Dataset SHA-256: <code>{dataset.id}</code></p>
      </section>
    </section>
  );
}

export default function StrategyLab({ initialAssetId, offline }: { initialAssetId: string; offline: boolean }) {
  const qc = useQueryClient();
  const [assetId, setAssetId] = useState(initialAssetId);
  const [interval, setIntervalValue] = useState<Interval>('1h');
  const [count, setCount] = useState(1000);
  const [selectedId, setSelectedId] = useState('');
  const [model, setModel] = useState<Model>('sfp');
  const [initialEquity, setInitialEquity] = useState(10_000);
  const [riskPct, setRiskPct] = useState(1);
  const [fee, setFee] = useState(4);
  const [slippage, setSlippage] = useState(5);
  const [holdoutPct, setHoldoutPct] = useState(25);
  const [report, setReport] = useState<StoredResearchReport | null>(null);

  const datasetQuery = useQuery({
    queryKey: ['research', 'datasets'],
    queryFn: ({ signal }) => api.researchDatasets(signal),
    retry: 0,
    refetchOnWindowFocus: false,
  });
  const datasets = datasetQuery.data?.datasets ?? [];
  const effectiveId = selectedId && datasets.some((d) => d.id === selectedId)
    ? selectedId : (datasets[0]?.id ?? '');
  const selected = datasets.find((d) => d.id === effectiveId);

  const fetchMutation = useMutation({
    mutationFn: () => api.researchFetch({ assetId: assetId.trim(), interval, count }),
    onSuccess: ({ dataset }) => {
      setSelectedId(dataset.id);
      setReport(null);
      runMutation.reset();
      void qc.invalidateQueries({ queryKey: ['research', 'datasets'] });
    },
  });
  const runMutation = useMutation({
    mutationFn: () => {
      if (!effectiveId) throw Error('Select a historical dataset');
      return api.researchBacktest(effectiveId, {
        model, initialEquity,
        riskFraction: riskPct / 100,
        costs: { feeBpsPerSide: fee, slippageBpsPerSide: slippage },
        holdoutFraction: holdoutPct / 100,
      });
    },
    onSuccess: (value) => setReport(value),
  });
  const busy = fetchMutation.isPending || runMutation.isPending;
  const unavailable = offline || busy;

  return (
    <div className="lab-layout">
      <div className="lab-intro">
        <FlaskConical size={20} aria-hidden="true"/>
        <div>
          <h2>Strategy Lab · v0.3</h2>
          <p>Reproducible candle-based research. This workstation does not send exchange orders.</p>
        </div>
      </div>
      <div className="lab-columns">
        <section className="lab-panel" aria-label="Historical datasets">
          <h3><Database size={17} aria-hidden="true"/> Historical datasets</h3>
          <p className="lab-footnote">Fetch 80–1,000 completed candles from the selected perpetual exchange. Missing or corrupted data is rejected. Requires internet access.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (!unavailable) fetchMutation.mutate(); }} className="lab-fields">
            <label>Contract ID
              <input value={assetId} onChange={(e) => { setAssetId(e.target.value); setReport(null); }}
                placeholder="binance:BTCUSDT" autoComplete="off" aria-label="Research asset ID"/>
            </label>
            <div className="lab-input-row">
              <label>Timeframe
                <select aria-label="Research timeframe" value={interval}
                  onChange={(e) => { setIntervalValue(e.target.value as Interval); setReport(null); }}>
                  {(['15m', '1h', '4h', '1d'] as const).map((tf) => <option key={tf} value={tf}>{tf}</option>)}
                </select>
              </label>
              <label>Candles
                <input aria-label="Historical candle count" type="number" min={80} max={1000} step={1}
                  value={count} onChange={(e) => { setCount(Number(e.target.value)); setReport(null); }}/>
              </label>
            </div>
            <button className="lab-action" type="submit" disabled={unavailable}>
              <RefreshCw size={16} aria-hidden="true"/> {fetchMutation.isPending ? 'Fetching history…' : 'Fetch & archive history'}
            </button>
          </form>
          {fetchMutation.isError && <p className="lab-error" role="alert">{errorText(fetchMutation.error)}</p>}
          <div className="lab-archive">
            <h3>Saved research snapshots</h3>
            {datasetQuery.isPending ? <p>Loading saved datasets…</p> :
              datasetQuery.isError ? <p className="lab-error" role="alert">{errorText(datasetQuery.error)}</p> :
              datasets.length ? (
                <>
                  <select aria-label="Historical dataset" value={effectiveId} disabled={busy}
                    onChange={(e) => { setSelectedId(e.target.value); setReport(null); runMutation.reset(); }}>
                    {datasets.map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.assetId} · {d.interval} · {d.bars} bars · {d.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  {selected && <p className="lab-footnote">
                    Captured: {timestamp(selected.capturedAt)} · Last completed candle: {timestamp(selected.lastCloseTime)}.
                    <br/>Dataset fingerprint: <code>{selected.id.slice(0, 20)}…</code>
                  </p>}
                </>
              ) : <p className="lab-empty">No datasets stored. Fetch historical candles to begin.</p>}
            {!!datasetQuery.data?.rejected &&
              <p className="lab-error" role="alert">{datasetQuery.data.rejected} corrupted archive file(s) were excluded.</p>}
          </div>
        </section>

        <section className="lab-panel" aria-label="Backtest settings">
          <h3><Play size={17} aria-hidden="true"/> Research configuration</h3>
          <p className="lab-footnote">No parameter search is performed. Treat the holdout as a one-time evaluation: repeatedly changing rules after seeing it can invalidate that evidence.</p>
          <form className="lab-fields" onSubmit={(e) => {
            e.preventDefault();
            if (!unavailable && effectiveId) { setReport(null); runMutation.mutate(); }
          }}>
            <label>Rule-based strategy
              <select aria-label="Research strategy" value={model} disabled={busy}
                onChange={(e) => { setModel(e.target.value as Model); setReport(null); }}>
                {modelOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <div className="lab-input-row">
              <label>Initial equity ($)
                <input aria-label="Initial research equity" type="number" min={1} max={10000000} step={1}
                  value={initialEquity} onChange={(e) => { setInitialEquity(Number(e.target.value)); setReport(null); }}/>
              </label>
              <label>Risk per trade (%)
                <input aria-label="Research risk percentage" type="number" min={0.001} max={5} step={0.001}
                  value={riskPct} onChange={(e) => { setRiskPct(Number(e.target.value)); setReport(null); }}/>
              </label>
            </div>
            <div className="lab-input-row">
              <label>Fee per side (bps)
                <input aria-label="Research fee bps" type="number" min={0} max={100} step={1}
                  value={fee} onChange={(e) => { setFee(Number(e.target.value)); setReport(null); }}/>
              </label>
              <label>Slippage per side (bps)
                <input aria-label="Research slippage bps" type="number" min={0} max={100} step={1}
                  value={slippage} onChange={(e) => { setSlippage(Number(e.target.value)); setReport(null); }}/>
              </label>
            </div>
            <label>Chronological holdout (% of candles)
              <input aria-label="Holdout percent" type="number" min={10} max={50} step={5}
                value={holdoutPct} onChange={(e) => { setHoldoutPct(Number(e.target.value)); setReport(null); }}/>
            </label>
            <button className="lab-action" type="submit" disabled={unavailable || !effectiveId}>
              <Play size={16} aria-hidden="true"/> {runMutation.isPending ? 'Running backtest…' : 'Run research backtest'}
            </button>
          </form>
          {runMutation.isError && <p className="lab-error" role="alert">{errorText(runMutation.error)}</p>}
          <p className="lab-footnote">Costs are user assumptions, not verified exchange fee quotes. Historical simulations are not predictive guarantees.</p>
        </section>
      </div>
      {report ? <ResearchReport key={report.dataset.id + report.result.config.model + report.result.trades.length} report={report}/> :
        <div className="lab-empty lab-empty-state" aria-live="polite">
          {runMutation.isPending ? 'Calculating strategy performance against immutable historical candles…' :
            'No research report yet. Select a saved dataset, configure the strategy, and run a backtest.'}
        </div>}
    </div>
  );
}
