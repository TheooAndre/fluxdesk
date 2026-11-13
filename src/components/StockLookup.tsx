import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { StockData } from '../investments/market-data.ts';

export default function StockLookup({
  onSelect,
  disabled = false,
}: {
  onSelect: (stock: StockData) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 350);
    return () => clearTimeout(timer);
  }, [text]);
  const search = useQuery({
    queryKey: ['investments', 'search', query],
    queryFn: ({ signal }) => api.searchStocks(query, signal),
    enabled: !!query && !disabled,
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
  });
  const select = useMutation({
    mutationFn: (symbol: string) => api.stockData(symbol),
    onSuccess: (stock) => {
      onSelect(stock);
      setText('');
      setQuery('');
    },
  });
  return (
    <div className="stock-lookup">
      <label htmlFor="stock-lookup">Find a stock or ETF</label>
      <div className="searchbox">
        <Search size={16} aria-hidden="true" />
        <input
          id="stock-lookup"
          maxLength={100}
          placeholder="Apple, AAPL, 0700.HK…"
          autoComplete="off"
          value={text}
          disabled={disabled || select.isPending}
          onChange={(e) => {
            setText(e.target.value);
            select.reset();
          }}
        />
      </div>
      {search.isFetching && (
        <p className="small-label" role="status">
          Searching…
        </p>
      )}
      {search.isError && (
        <p className="notice warning" role="alert">
          {search.error.message}{' '}
          <button type="button" className="subtle" onClick={() => void search.refetch()}>
            Retry
          </button>
        </p>
      )}
      {query === text.trim() && search.data && (
        <div className="stock-search-results" aria-label="Stock search results">
          {search.data.matches.map((match) => (
            <button
              type="button"
              className="stock-search-result"
              key={match.symbol}
              disabled={disabled || select.isPending}
              onClick={() => select.mutate(match.symbol)}
            >
              <span>
                <strong>{match.symbol}</strong>
                <small>
                  {match.exchange} · {match.type === 'ETF' ? 'ETF' : 'Stock'}
                </small>
              </span>
              <span>{match.name}</span>
            </button>
          ))}
          {!search.data.matches.length && <p className="small-label">No matching listings.</p>}
        </div>
      )}
      {select.isPending && (
        <p role="status" className="small-label">
          Verifying listing…
        </p>
      )}
      {select.isError && (
        <p role="alert" className="notice warning">
          {select.error.message}
        </p>
      )}
    </div>
  );
}
