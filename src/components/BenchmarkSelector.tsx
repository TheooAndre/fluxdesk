import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { BenchmarkId, Market } from '../types.ts';

type Option = { id: BenchmarkId; label: string; search: string };

export default function BenchmarkSelector({ assets, value, onChange }: {
  assets: Market[];
  value: BenchmarkId;
  onChange: (value: BenchmarkId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const options = useMemo<Option[]>(() => [
    { id: 'USD', label: 'USD / USDT · cash baseline', search: 'usd usdt dollar cash baseline' },
    ...assets.map((asset) => ({
      id: asset.id,
      label: `${asset.base} · ${asset.venue}`,
      search: `${asset.base} ${asset.symbol} ${asset.venue} ${asset.id}`.toLowerCase(),
    })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [assets]);
  const selected = options.find((option) => option.id === value);
  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? options.filter((option) => terms.every((term) => option.search.includes(term))) : options;
  }, [options, query]);
  const visible = matches.slice(0, 100);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const choose = (id: BenchmarkId) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  return (
    <div className="benchmark-picker" ref={root}>
      <input
        ref={input}
        className="benchmark-search"
        role="combobox"
        aria-label="Search comparison benchmark"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
        placeholder={selected?.label ?? 'Search benchmarks…'}
        value={open ? query : (selected?.label ?? value)}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); setQuery(''); input.current?.blur(); }
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((index) => Math.min(index + 1, visible.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)); }
          if (event.key === 'Enter' && open && visible[active]) { event.preventDefault(); choose(visible[active].id); }
        }}
      />
      {open && (
        <div className="benchmark-options" id={listId} role="listbox" aria-label="Available comparison benchmarks">
          {visible.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.id === value}
              id={`${listId}-${index}`}
              key={option.id}
              className={'benchmark-option' + (active === index ? ' highlighted' : '')}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.id)}
            >
              {option.label}{option.id === value ? ' ✓' : ''}
            </button>
          ))}
          {!matches.length && <div className="benchmark-empty">No matching instruments</div>}
          {matches.length > visible.length && (
            <div className="benchmark-hint">Showing first {visible.length} of {matches.length}. Type more to narrow results.</div>
          )}
        </div>
      )}
    </div>
  );
}
