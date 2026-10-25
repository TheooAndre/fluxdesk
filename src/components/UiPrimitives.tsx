import type { ReactNode } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import type { Market } from '../types.ts';

export function HelpDetails({ title = 'Details', children }: { title?: string; children: ReactNode }) {
  return (
    <details className="help-details">
      <summary>{title}</summary>
      <div className="footnote">{children}</div>
    </details>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'green' | 'red';
}) {
  return (
    <span className={'pill ' + (tone === 'green' ? 'pill-green' : tone === 'red' ? 'pill-red' : '')}>
      {children}
    </span>
  );
}
export function ErrorText({ error }: { error: unknown }) {
  return (
    <div className="notice warning">
      <WifiOff size={16} />
      <span>
        {(error as Error)?.message ?? 'Data source unavailable'}. The app never substitutes fabricated market
        data.
      </span>
    </div>
  );
}
export function Loading({ label = 'Loading live data…' }: { label?: string }) {
  return (
    <div className="loading">
      <RefreshCw className="animate-spin" size={19} />
      {label}
    </div>
  );
}
export function Card({
  children,
  title,
  aside,
  className = '',
}: {
  children: ReactNode;
  title?: string;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <section className={'card ' + className}>
      {title && (
        <div className="card-head">
          <h3>{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}
export function BadgeVenue({ venue }: { venue: Market['venue'] }) {
  return (
    <span className={'venue ' + (venue === 'binance' ? 'binance' : 'hyper')}>
      {venue === 'binance' ? 'BN' : 'HL'}
    </span>
  );
}
export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { label: string; value: T }[];
  value: T;
  onChange: (a: T) => void;
}) {
  return (
    <div className="segmented">
      {items.map((x) => (
        <button
          key={x.value}
          aria-pressed={x.value === value}
          className={x.value === value ? 'active' : ''}
          onClick={() => onChange(x.value)}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}
