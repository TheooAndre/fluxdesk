import { Star, X } from 'lucide-react';
import type { Market } from '../types.ts';
import { price } from '../lib/format.ts';
import { priceBasisLabel, quoteAge } from '../lib/market-quality.ts';
import { Card, BadgeVenue } from './UiPrimitives.tsx';

export default function Watchlist({
  assets,
  ids,
  now,
  loading,
  error,
  disabled,
  onSelect,
  onRemove,
}: {
  assets: Market[];
  ids: string[];
  now: number;
  loading: boolean;
  error: unknown;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return (
    <Card
      title="Saved markets"
      aside={<span className="small-label">{ids.length} / 50 · shared across devices</span>}
    >
      {error ? (
        <p className="notice warning" role="alert">
          {error instanceof Error ? error.message : 'Could not load saved markets'}
        </p>
      ) : null}
      {loading ? (
        <p className="muted">Loading watchlist…</p>
      ) : ids.length ? (
        <div className="watchlist-grid">
          {ids.map((id) => {
            const asset = byId.get(id);
            return (
              <div className="watchlist-market" key={id}>
                <button
                  className="watchlist-inspect"
                  onClick={() => onSelect(id)}
                  aria-label={`Inspect saved ${id}`}
                >
                  <BadgeVenue venue={id.startsWith('binance:') ? 'binance' : 'hyperliquid'} />
                  <span>
                    <b>{asset?.base ?? id.split(':')[1]}</b>
                    <small>
                      {asset
                        ? `${price(asset.price)} · ${priceBasisLabel(asset)} · ${quoteAge(asset.asOf, now)}`
                        : 'Unavailable in current feed'}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${id} from watchlist`}
                  disabled={disabled}
                  onClick={() => onRemove(id)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="watchlist-empty">
          <Star size={16} aria-hidden="true" /> Star a market in the table to save it here.
        </p>
      )}
    </Card>
  );
}
