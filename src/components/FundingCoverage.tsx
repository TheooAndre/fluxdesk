import type { FundingDiagnostics } from '../research/funding-diagnostics.ts';
const hours = (value: number) => value.toFixed(2) + 'h';
const utc = (time: number | null) =>
  time === null ? 'None' : new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export default function FundingCoverage({ data }: { data: FundingDiagnostics }) {
  return (
    <details aria-label="Funding coverage diagnostics">
      <summary>Funding coverage · review required</summary>
      <p className="lab-footnote">
        Observed spacing does not prove the historical payment schedule. Gaps over 8h are review flags, not a
        count of missing payments.
      </p>
      <dl>
        <dt>First / last ordinary observation</dt>
        <dd>
          {utc(data.firstPaymentAt)} / {utc(data.lastPaymentAt)}
        </dd>
        <dt>Window before first / after last observation</dt>
        <dd>
          {hours(data.leadingGapHours)} / {hours(data.trailingGapHours)}
        </dd>
        <dt>Observed gaps over 8h</dt>
        <dd>{data.gapCountOver8h}</dd>
        <dt>Regular or unspecified / special / unspecified type</dt>
        <dd>
          {data.regularOrUnspecifiedPayments} / {data.specialPayments} / {data.unspecifiedTypes}
        </dd>
        <dt>Positive / negative / zero rates</dt>
        <dd>
          {data.positiveRates} / {data.negativeRates} / {data.zeroRates}
        </dd>
        <dt>Largest absolute mark/trade close difference</dt>
        <dd>
          {data.largestMarkTradeCloseDifferencePct === null
            ? 'N/A'
            : data.largestMarkTradeCloseDifferencePct.toFixed(4) + '%'}
        </dd>
      </dl>
      <p className="lab-footnote">
        Observed payment spacing:{' '}
        {data.spacingHours.length
          ? data.spacingHours.map((bin) => `${hours(bin.hours)} × ${bin.count}`).join(' · ')
          : 'Not enough ordinary observations.'}
        {data.spacingVariantCount > 16 ? ' · First 16 spacing values shown.' : ''} Special payments are
        excluded from spacing calculations.
      </p>
      {!!data.gapsOver8h.length && (
        <div className="lab-table-scroller">
          <table className="lab-table" aria-label="Funding gaps for review">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Observed gap</th>
              </tr>
            </thead>
            <tbody>
              {data.gapsOver8h.map((gap) => (
                <tr key={gap.from}>
                  <td>{utc(gap.from)}</td>
                  <td>{utc(gap.to)}</td>
                  <td>{hours(gap.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lab-footnote">
            Up to eight gaps shown. Verify exchange schedules and contract history before interpreting
            performance.
          </p>
        </div>
      )}
    </details>
  );
}
