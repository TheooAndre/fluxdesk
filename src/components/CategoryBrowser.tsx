import {
  CATEGORIES,
  CATEGORY_REVIEWED_AT,
  categoryLabel,
  marketCategories,
  matchesCategory,
  type CategoryFilter,
} from '../lib/categories.ts';
import { money, pct, price } from '../lib/format.ts';
import type { Market } from '../types.ts';
import { Card, BadgeVenue, HelpDetails } from './UiPrimitives.tsx';

export default function CategoryBrowser({
  assets,
  selected,
  venue,
  search,
  onCategory,
  onVenue,
  onSearch,
  onSelect,
}: {
  assets: Market[];
  selected: CategoryFilter;
  venue: 'all' | Market['venue'];
  search: string;
  onCategory: (category: CategoryFilter) => void;
  onVenue: (venue: 'all' | Market['venue']) => void;
  onSearch: (search: string) => void;
  onSelect: (id: string) => void;
}) {
  const universe = assets.filter((a) => venue === 'all' || a.venue === venue);
  const filters: { id: CategoryFilter; label: string }[] = [
    { id: 'all', label: 'All sectors' },
    ...CATEGORIES,
    { id: 'uncategorized', label: 'Uncategorized' },
  ];
  const results = universe.filter(
    (a) =>
      matchesCategory(a, selected) &&
      (a.base.toLowerCase().includes(search.toLowerCase()) ||
        a.symbol.toLowerCase().includes(search.toLowerCase())),
  );
  const description = CATEGORIES.find((c) => c.id === selected)?.description;
  return (
    <Card
      title="Market categories"
      aside={<span className="small-label">Curated · {CATEGORY_REVIEWED_AT}</span>}
    >
      <div className="category-chips" role="group" aria-label="Asset categories">
        {filters.map((c) => (
          <button
            key={c.id}
            aria-pressed={selected === c.id}
            className={selected === c.id ? 'category-chip active' : 'category-chip'}
            onClick={() => onCategory(c.id)}
          >
            {c.label}
            <span>{universe.filter((a) => matchesCategory(a, c.id)).length}</span>
          </button>
        ))}
      </div>
      {description && <p className="footnote">{description}</p>}
      <div className="controls">
        <input
          className="category-search"
          aria-label="Search category assets"
          placeholder="Search in this sector…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <select
          aria-label="Category exchange"
          value={venue}
          onChange={(event) => onVenue(event.target.value as 'all' | Market['venue'])}
        >
          <option value="all">Both venues</option>
          <option value="binance">Binance</option>
          <option value="hyperliquid">Hyperliquid</option>
        </select>
      </div>
      <div className="row-between mb-2">
        <strong>{categoryLabel(selected)}</strong>
        <span className="small-label">
          {results.length} available contract{results.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="category-results">
        {results.slice(0, 100).map((asset) => (
          <button
            className="category-asset"
            key={asset.id}
            onClick={() => onSelect(asset.id)}
            aria-label={`Chart ${asset.base} on ${asset.venue}`}
          >
            <BadgeVenue venue={asset.venue} />
            <span>
              <b>{asset.base}</b>
              <small>
                {asset.venue} · {marketCategories(asset).map(categoryLabel).join(' / ') || 'Uncategorized'}
              </small>
            </span>
            <span className="category-quote">
              <b>{price(asset.price)}</b>
              <small className={asset.return24h >= 0 ? 'positive' : 'negative'}>
                {pct(asset.return24h)} · {money(asset.volumeUsd24h)} vol
              </small>
            </span>
          </button>
        ))}
        {!results.length && <p className="empty">No current contracts match this category and search.</p>}
      </div>
      {results.length > 100 && (
        <p className="footnote">
          Showing 100 of {results.length} contracts. Narrow the search to inspect more.
        </p>
      )}
      <HelpDetails title="Category details">
        Counts are exchange contracts, not unique tokens. Tags can overlap and are curated research labels.
        New or uncertain mappings remain Uncategorized. No category index return or investment ranking is
        implied.{' '}
        <a href="https://www.coingecko.com/en/categories" target="_blank" rel="noopener noreferrer">
          Category definitions
        </a>
      </HelpDetails>
    </Card>
  );
}
