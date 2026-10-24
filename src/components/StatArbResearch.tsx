import { useRef, useState } from 'react';
import { Card, Pill } from './UiPrimitives.tsx';
import './StatArbResearch.css';
import demo from '../research/statarb-demo.json';
import { MAX_STATARB_BYTES, parseStatArbReport, type StatArbEvaluation, type StatArbReport } from '../lib/statarb-report.ts';

const pct = (n: number) => (n * 100).toFixed(2) + '%';
const metric = (n: number | null) => n === null ? 'N/A' : n.toFixed(2);
function Evaluation({ title, result }: { title: string; result: StatArbEvaluation }) {
  return <Card title={title}>
    <div className="metric-grid pair-metrics">
      <div className="metric"><span>Net Sharpe · reported</span><strong>{metric(result.sharpe)}</strong></div>
      <div className="metric"><span>Max drawdown</span><strong>{pct(result.maxDrawdown)}</strong></div>
      <div className="metric"><span>Reported trades</span><strong>{result.trades}</strong></div>
      <div className="metric"><span>Pair hypotheses searched</span><strong>{result.trialsSearched}</strong></div>
      <div className="metric"><span>Cost fraction · equity</span><strong>{pct(result.costFraction)}</strong></div>
      <div className="metric"><span>Funding P&amp;L · equity</span><strong>{pct(result.fundingFraction)}</strong></div>
    </div>
    <p className="footnote">Imported figures are unverified. Synthetic metrics describe artificial processes only. Deflated Sharpe is not computed; pair searches are not the complete research-trial genealogy. No-trade folds remain in the table.</p>
    <div className="statarb-table-scroller" tabIndex={0} role="region" aria-label={`${title} folds`}>
      <table><caption>{title} · all nonoverlapping folds · UTC</caption><thead><tr><th>Period</th><th>Bars</th><th>Selected pairs</th><th>Trades</th><th>Net Sharpe</th><th>Drawdown</th></tr></thead>
        <tbody>{result.folds.map(f => <tr key={f.start}>
          <td>{f.start.slice(0, 10)} → {f.end.slice(0, 10)}</td><td>{f.bars}</td><td>{f.selectedPairs.join(', ') || 'None · abstained'}</td><td>{f.trades}</td><td>{metric(f.sharpe)}</td><td>{pct(f.maxDrawdown)}</td>
        </tr>)}</tbody></table>
    </div>
  </Card>;
}
export default function StatArbResearch() {
  const [report, setReport] = useState<StatArbReport | null>(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  async function load(file: File) {
    const version = ++request.current;
    setReading(true); setError('');
    try {
      if (file.size > MAX_STATARB_BYTES) throw Error('Stat-arb reports must be 1 MiB or smaller.');
      const parsed = parseStatArbReport(await file.text());
      if (version === request.current) setReport(parsed);
    } catch (e) {
      if (version === request.current) setError((e as Error).message);
    } finally { if (version === request.current) setReading(false); }
  }
  return <div className="content-stack statarb-research">
    <Card title="Crypto stat-arb research" aside={<Pill tone="red">Research only</Pill>}>
      <p><strong>No tradable edge established.</strong> The 19 October research package contains engineering tests and synthetic experiments, with no validated historical crypto dataset or market holdout result.</p>
      <details><summary>Hypothesis and economic rationale</summary><p>Some economically related, liquid linear perpetuals on the same venue may share a common stochastic trend. Temporary dealer inventory, liquidation and constrained-arbitrage flows may produce relative mispricing. A spread position takes the other side of that flow while bearing breakup, funding and execution risk. The null is no positive net edge after realistic costs and untouched out-of-sample evaluation.</p></details>
      <dl className="statarb-protocol">
        <div><dt>Model</dt><dd>Engle–Granger cointegration, BH FDR q ≤ 0.10; positive and stable OLS beta. Periodic OLS refits, no Kalman filter.</dd></div>
        <div><dt>Formation / validation</dt><dd>4h bars · 180-day formation · nonoverlapping 30-day development folds · chronological 70/30 split · final holdout opened once.</dd></div>
        <div><dt>Signal / execution</dt><dd>90-bar spread z window; beta refit every 42 bars. Entry |z| ≥ 2, exit ≤ 0.5, stop ≥ 4 or 90 bars. Decide at close, execute at next open on both legs.</dd></div>
        <div><dt>Direction</dt><dd>Spread = ln(Y) − alpha − beta × ln(X). Positive z implies a hypothetical short Y / long beta × X; negative z reverses the legs. This convention is not a trade recommendation or a signal from the correlation scanner.</dd></div>
        <div><dt>Risk / variants</dt><dd>10% annual volatility target, 20% pair / 30% asset / 100% portfolio gross caps, 10% drawdown stop. One original parameter variant; no optimization. Future experiments must disclose all variants.</dd></div>
      </dl>
      <p className="footnote">Original defaults above. Uploaded reports show their own full configuration below. Correlation and the scanner’s 80-bar hedge do not establish cointegration or implement this protocol.</p>
    </Card>
    <Card title="Market-data and validation gates">
      <ul className="statarb-gates">
        <li>Missing: 2+ years of same-venue 4h OHLCV, including delisted instruments and contract migrations.</li>
        <li>Missing: complete realized funding events for both signed legs; current funding rates cannot backfill historical payments.</li>
        <li>Missing: point-in-time membership, historical USD volume and open-interest snapshots.</li>
        <li>Unverified: account-tier fees, fill/slippage realism and independent provenance audit.</li>
        <li>Not established: stable market walk-forward results, untouched market holdout, valid multiple-testing evidence and 30 external paper sessions.</li>
      </ul>
      <p className="footnote">Status refers to the original research package. Importing a report cannot independently clear these gates. The current Strategy Lab candle archive alone does not meet this data contract. Paper and live readiness remain blocked.</p>
    </Card>
    <Card title="Walk-forward report viewer" aside={<Pill>Offline results</Pill>}>
      <p>Import a report exported from the original Python engine. Files are read on this device and stay in this view until you leave or reload; they are not uploaded or saved to the shared archive.</p>
      <div className="statarb-actions">
        <label>Import stat-arb JSON <input aria-label="Import stat-arb report" type="file" accept=".json,application/json" disabled={reading} onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); event.target.value = ''; }} /></label>
        <button type="button" disabled={reading} onClick={() => { request.current++; setError(''); setReport(parseStatArbReport(JSON.stringify(demo))); }}>Show original synthetic demo</button>
        {report && <button type="button" onClick={() => { request.current++; setReport(null); setError(''); setReading(false); }}>Clear report</button>}
      </div>
      {reading && <p role="status">Reading report…</p>}
      {error && <p role="alert">Import rejected: {error} {report ? 'The previous report is still displayed.' : ''}</p>}
      <details><summary>Run and export the original research</summary>
        <p>The offline engine, source documents and tests are included in the project under <code>research/statarb</code>. After running development research against a properly sourced dataset, export its report with:</p>
        <pre className="statarb-command">python research/statarb/export_terminal.py reports/real terminal-report.json</pre>
        <p>Exporting reads existing results only; it never opens the holdout. See the <a href="https://github.com/TheooAndre/fluxdesk/blob/feat/cloud-foundation-v0.4/docs/statarb-integration.md" target="_blank" rel="noopener noreferrer">research integration guide</a> for installation, input contracts and limitations.</p>
      </details>
    </Card>
    {report && <>
      <Card title={report.synthetic ? 'SYNTHETIC · mechanical demonstration only' : 'IMPORTED MARKET REPORT · unverified'} aside={<Pill tone="red">No trading authorization</Pill>}>
        <p>{report.synthetic ? 'Artificial prices, artificial funding and artificial universe. These results do not validate any crypto market edge.' : 'User-supplied result. Dataset identity, coverage assertions and metrics require independent verification.'}</p>
        <dl className="statarb-protocol">
          <div><dt>Venue</dt><dd>{report.venue}</dd></div>
          <div><dt>Experiment fingerprint</dt><dd className="statarb-hash">{report.fingerprint}</dd></div>
          <div><dt>Dataset hash</dt><dd className="statarb-hash">{report.datasetHash ?? 'Not supplied'}</dd></div>
          <div><dt>Funding / PIT claims</dt><dd>{report.fundingComplete ? 'Complete funding asserted' : 'Funding incomplete'} · {report.pointInTimeUniverse ? 'PIT universe asserted' : 'PIT universe missing'} · assertions are not external audits.</dd></div>
          <div><dt>Final holdout</dt><dd>{report.holdoutOpened ? 'Opened in this report; no retuning. A file does not prove one-time access across research attempts.' : 'Not opened; no holdout results supplied.'}</dd></div>
        </dl>
        <details><summary>Full reported configuration</summary><dl className="statarb-protocol">{Object.entries(report.config).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{String(value)}</dd></div>)}</dl></details>
      </Card>
      <Evaluation title="Development walk-forward" result={report.development} />
      {report.holdout && <Evaluation title="Final holdout" result={report.holdout} />}
    </>}
  </div>;
}
