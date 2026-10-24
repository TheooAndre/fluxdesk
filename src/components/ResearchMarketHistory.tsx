import type { DatasetReceipt } from '../../server/research/datasets.ts';
import { price } from '../lib/format.ts';

export default function ResearchMarketHistory({
  dataset,
  busy,
  pending,
  onFetch,
}: {
  dataset: DatasetReceipt;
  busy: boolean;
  pending: boolean;
  onFetch: () => void;
}) {
  const history = dataset.marketHistory;
  const eligible =
    dataset.venue === 'binance' &&
    dataset.bars <= 1000 &&
    dataset.lastCloseTime - dataset.firstOpenTime < 90 * 86400000;
  return (
    <section aria-label="Archived funding and mark prices">
      <h3>Historical funding & mark prices</h3>
      {history ? (
        <>
          <p className="lab-footnote">
            {history.fundingEvents} observed funding payments · {history.markBars} matching mark-price
            candles.
            <br />
            Retrieved {new Date(history.retrievedAt).toLocaleString()}. First / last mark close:{' '}
            {price(history.firstMarkClose)} / {price(history.lastMarkClose)}.
          </p>
          <details>
            <summary>Latest archived payments · UTC</summary>
            <div className="lab-table-scroller">
              <table className="lab-table" aria-label="Archived funding payments">
                <thead>
                  <tr>
                    <th>Payment time</th>
                    <th>Rate</th>
                    <th>Mark price</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {history.recentFunding.map((payment) => (
                    <tr key={`${payment.time}:${payment.rateType}`}>
                      <td>{new Date(payment.time).toISOString().slice(0, 16).replace('T', ' ')}</td>
                      <td>{(payment.rate * 100).toFixed(6)}%</td>
                      <td>{price(payment.markPrice)}</td>
                      <td>{payment.rateType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="lab-footnote">
            Positive funding: longs pay shorts; negative: shorts pay longs. Source: Binance historical funding
            and mark-price endpoints. Payment schedule completeness remains unaudited. These data are archived
            for research; the optional exploratory v3 mode uses these observations; the default v2 mode excludes them.
          </p>
        </>
      ) : (
        <>
          <p className="lab-footnote">
            Archive Binance’s actual funding events and matching mark-price candles for this saved window.
            Creates a new fingerprint and keeps the original snapshot.
          </p>
          <button className="lab-action-secondary" disabled={busy || !eligible} onClick={onFetch}>
            {pending ? 'Archiving funding & mark prices…' : 'Archive funding & mark history'}
          </button>
          {!eligible && (
            <p className="lab-footnote">
              Requires a Binance snapshot with at most 1,000 candles spanning at most 90 days. Hyperliquid
              historical mark/oracle data is not connected.
            </p>
          )}
        </>
      )}
    </section>
  );
}
