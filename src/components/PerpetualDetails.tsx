import { HelpDetails } from './UiPrimitives.tsx';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { price } from '../lib/format.ts';
import { quoteAge } from '../lib/market-quality.ts';
import type { Market } from '../types.ts';
import { Card, Pill, Loading } from './UiPrimitives.tsx';

export default function PerpetualDetails({
  item,
  now,
  offline,
}: {
  item: Market;
  now: number;
  offline: boolean;
}) {
  const query = useQuery({
    queryKey: ['perpetual', item.id],
    queryFn: ({ signal }) => api.perpetual(item.id, signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    staleTime: 5_000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: false,
  });
  const data = query.data;
  const unavailable = !data || data.status === 'unavailable';
  const stale =
    !unavailable &&
    (offline || query.isError || data.status === 'stale' || data.asOf === null || now - data.asOf > 60_000);
  const status = unavailable ? 'Unavailable' : stale ? 'Stale · last reported' : 'Current snapshot';
  const funding = data?.fundingRate;
  const next = data?.nextFundingAt;
  const reference = data?.referenceKind === 'oracle' ? 'Oracle' : 'Index';
  return (
    <Card
      title="Perpetual pricing & funding"
      aside={<Pill tone={unavailable || stale ? 'red' : 'muted'}>{status}</Pill>}
    >
      {query.isPending ? (
        <Loading label="Fetching perpetual details…" />
      ) : (
        <>
          <div className="perpetual-grid">
            <div>
              <span className="tiny-label">Mark price</span>
              <strong>{data?.markPrice == null ? 'Unavailable' : price(data.markPrice)}</strong>
            </div>
            <div>
              <span className="tiny-label">{reference} price</span>
              <strong>{data?.referencePrice == null ? 'Unavailable' : price(data.referencePrice)}</strong>
            </div>
            <div>
              <span className="tiny-label">Mark / {reference.toLowerCase()} − 1</span>
              <strong>
                {data?.premiumPct == null
                  ? 'Unavailable'
                  : `${data.premiumPct > 0 ? '+' : ''}${data.premiumPct.toFixed(4)}%`}
              </strong>
              <small>Calculated price premium</small>
            </div>
            <div>
              <span className="tiny-label">
                Reported funding ·{' '}
                {data?.intervalHours == null ? 'interval unknown' : `per ${data.intervalHours}h`}
              </span>
              <strong>
                {funding == null ? 'Unavailable' : `${funding > 0 ? '+' : ''}${(funding * 100).toFixed(4)}%`}
              </strong>
              <small>
                {funding == null
                  ? 'Rate not supplied'
                  : funding > 0
                    ? 'Longs pay shorts'
                    : funding < 0
                      ? 'Shorts pay longs'
                      : 'Zero reported rate'}
              </small>
            </div>
            <div>
              <span className="tiny-label">Next funding · UTC</span>
              <strong>
                {next == null
                  ? 'Unavailable'
                  : next <= now
                    ? 'Awaiting fresh quote'
                    : new Date(next).toISOString().slice(11, 19)}
              </strong>
              <small>
                {next != null && next > now ? `${Math.ceil((next - now) / 60_000)}m remaining · ` : ''}
                {data?.nextFundingSource === 'hourly_schedule'
                  ? 'Hourly schedule estimate'
                  : data?.nextFundingSource === 'exchange'
                    ? 'Exchange schedule'
                    : 'Timing unknown'}
              </small>
            </div>
            <div>
              <span className="tiny-label">
                {data?.timestampBasis === 'exchange' ? 'Exchange time' : 'Received time'} · UTC
              </span>
              <strong>
                {data?.asOf == null ? 'Unavailable' : new Date(data.asOf).toISOString().slice(11, 19)}
              </strong>
              <small>{quoteAge(data?.asOf ?? null, now)}</small>
            </div>
          </div>
          <HelpDetails title="Price and funding details">
            {item.venue === 'hyperliquid'
              ? 'Hyperliquid supplies mark and oracle prices; received time is when this server obtained the response, not an exchange quote timestamp.'
              : 'Binance supplies mark and index prices separately from the last-trade table price. Funding intervals refresh every minute; unknown intervals remain unknown.'}{' '}
            Funding can change before payment. These live rates are not included in Strategy Lab historical
            backtests.
          </HelpDetails>
        </>
      )}
    </Card>
  );
}
