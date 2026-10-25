import { useEffect, useMemo, useState } from 'react';
import { openPosition, reviewGaps, journalQuoteContext } from '../journal/insights.ts';
import type { JournalTrade } from '../journal/model.ts';
import type { MarketSnapshot } from '../types.ts';
import { money, price } from '../lib/format.ts';
import { Card, HelpDetails } from './UiPrimitives.tsx';

export default function JournalInsights({
  trades,
  snapshot,
  mode,
  onEdit,
}: {
  trades: JournalTrade[];
  snapshot?: MarketSnapshot;
  mode: 'positions' | 'review';
  onEdit: (trade: JournalTrade) => void;
}) {
  const [clock, setClock] = useState(() => ({ now: Date.now(), online: navigator.onLine }));
  const [limit, setLimit] = useState(30);
  useEffect(() => {
    if (mode !== 'positions') return;
    const refresh = () => setClock({ now: Date.now(), online: navigator.onLine });
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [mode]);
  const quotes = useMemo(() => journalQuoteContext(snapshot), [snapshot]);
  const rows = useMemo(
    () =>
      trades
        .map((trade) => ({
          trade,
          position:
            mode === 'positions' ? openPosition(trade, snapshot, clock.now, clock.online, quotes) : null,
          gaps: mode === 'review' ? reviewGaps(trade) : [],
        }))
        .filter((r) => (mode === 'positions' ? r.position!.legs.length : r.gaps.length)),
    [trades, snapshot, quotes, clock, mode],
  );
  return (
    <Card title={mode === 'positions' ? `Open positions · ${rows.length}` : `Review queue · ${rows.length}`}>
      <p className="footnote">
        {mode === 'positions'
          ? 'Estimates from saved fills and fresh venue quotes; excludes unrecorded costs.'
          : 'Complete the missing fields listed below.'}
      </p>
      {rows.slice(0, limit).map(({ trade, position, gaps }) => (
        <article className="journal-trade" key={trade.id}>
          <h4>{trade.title}</h4>
          <p>
            {trade.date} · {trade.account}
          </p>
          {position ? (
            <>
              <div className="workspace-metrics">
                <div>
                  <small>Recorded realized cash</small>
                  <strong>{money(position.recordedCash, false)}</strong>
                </div>
                <div>
                  <small>Estimated unrealized P&L</small>
                  <strong>
                    {position.unrealized === null ? 'Unavailable' : money(position.unrealized, false)}
                  </strong>
                </div>
                <div>
                  <small>Recorded cash + unrealized</small>
                  <strong>
                    {position.unrealized === null
                      ? 'Unavailable'
                      : money(position.recordedCash + position.unrealized, false)}
                  </strong>
                </div>
                <div>
                  <small>Cost basis to recorded stops</small>
                  <strong>
                    {position.stopRisk === null ? 'Incomplete' : money(position.stopRisk, false)}
                  </strong>
                </div>
              </div>
              {position.legs.map(
                ({ index, leg, quantity, remainingAverage, quote, unrealized, stopRisk }) => (
                  <div key={index}>
                    <p>
                      <b>
                        {leg.assetId} · {leg.direction}
                      </b>{' '}
                      · {quantity.toLocaleString(undefined, { maximumSignificantDigits: 12 })} units remaining
                      · average {price(remainingAverage!)}
                    </p>
                    <p>
                      {quote
                        ? `${quote.priceBasis === 'mark' ? 'Mark' : 'Last trade'} ${price(quote.price)} · ${quote.timestampBasis === 'exchange' ? 'exchange time' : quote.timestampBasis === 'received' ? 'server receipt time' : 'timestamp basis unknown'} ${new Date(quote.asOf).toLocaleTimeString()} · unrealized ${money(unrealized!, false)}`
                        : 'Current quote unavailable for this leg'}
                    </p>
                    <p>
                      Recorded stop: {leg.stop === null ? 'Missing' : price(leg.stop)} · cost-basis risk:{' '}
                      {stopRisk === null ? 'Unknown' : money(stopRisk, false)}
                    </p>
                  </div>
                ),
              )}
              {(position.missingQuotes > 0 || position.missingStops > 0) && (
                <p className="notice warning">
                  {position.missingQuotes} leg(s) without a usable quote; {position.missingStops} without a
                  recorded stop. Incomplete totals are not shown.
                </p>
              )}
            </>
          ) : (
            <ul>
              {gaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          )}
          <button className="secondary" onClick={() => onEdit(trade)}>
            {mode === 'review' ? 'Complete trade review' : 'Edit position fills / stops'}
          </button>
        </article>
      ))}
      {!rows.length && (
        <p className="empty">
          {mode === 'review'
            ? 'No incomplete records match these filters.'
            : 'No open positions match these filters.'}
        </p>
      )}
      {rows.length > limit && (
        <button onClick={() => setLimit((n) => n + 30)}>
          Show more {mode === 'review' ? 'reviews' : 'positions'}
        </button>
      )}
      {mode === 'positions' && (
        <HelpDetails title="Position estimates and stop risk">
          Stop risk is the remaining quantity multiplied by the adverse distance from its average cost to the
          recorded stop, floored at zero per leg. It excludes gaps, slippage, costs and liquidation; it is not
          current-market risk or a guarantee. A recorded stop does not place an exchange order. Leverage is
          not a P&L multiplier.
        </HelpDetails>
      )}
    </Card>
  );
}
