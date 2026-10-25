import type { FeedStatus } from '../types.ts';

export function ageLabel(timestamp: number | null, now: number): string {
  if (timestamp === null) return 'No successful snapshot';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}
export default function FeedHealth({
  feeds,
  now,
  disconnected,
}: {
  feeds: FeedStatus[];
  now: number;
  disconnected: boolean;
}) {
  return (
    <section className="feed-health" aria-label="Exchange feed health">
      {feeds.map((feed) => {
        const stale = feed.lastSuccessAt !== null && now - feed.lastSuccessAt > 60_000;
        const status = disconnected || stale ? (feed.markets ? 'stale' : 'unavailable') : feed.status;
        return (
          <div key={feed.venue} className={`feed-card feed-${status}`}>
            <div className="row-between">
              <strong>{feed.venue === 'binance' ? 'Binance' : 'Hyperliquid'}</strong>
              <span className="pill">{status === 'live' ? 'RECENT SNAPSHOT' : status.toUpperCase()}</span>
            </div>
            <div className="feed-meta">
              <span>{feed.markets} markets</span>
              <span>{ageLabel(feed.lastSuccessAt, now)}</span>
            </div>
            {(feed.message || disconnected || stale || feed.status !== 'live') && <p>
              {feed.message ?? (disconnected ? 'Connection lost; displayed values may be old.' : stale ? 'Waiting for a fresh snapshot.' : 'Feed unavailable.')}
            </p>}
          </div>
        );
      })}
    </section>
  );
}
