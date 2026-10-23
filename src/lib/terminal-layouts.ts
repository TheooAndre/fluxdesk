import { CATEGORIES, type CategoryFilter } from './categories.ts';
import { intervalsFor, type CandleInterval } from '../engine/intervals.ts';
export type TerminalLayout = {
  name: string;
  assetId: string;
  benchmark: string;
  tf: CandleInterval;
  category: CategoryFilter;
  venue: 'all' | 'binance' | 'hyperliquid';
  sort: 'volume' | 'relative' | 'oi';
  descending: boolean;
};
const contract = /^(binance|hyperliquid):[A-Za-z0-9_]{1,32}$/;
function valid(value: unknown): value is TerminalLayout {
  if (!value || typeof value !== 'object') return false;
  const x = value as Record<string, unknown>;
  return (
    typeof x.name === 'string' &&
    x.name === x.name.trim() &&
    x.name.length > 0 &&
    x.name.length <= 40 &&
    typeof x.assetId === 'string' &&
    contract.test(x.assetId) &&
    typeof x.benchmark === 'string' &&
    (x.benchmark === 'USD' || contract.test(x.benchmark)) &&
    intervalsFor(x.assetId.startsWith('hyperliquid:') ? 'hyperliquid' : 'binance').some(
      (tf) => tf === x.tf,
    ) &&
    ['all', 'uncategorized', ...CATEGORIES.map((category) => category.id)].includes(String(x.category)) &&
    ['all', 'binance', 'hyperliquid'].includes(String(x.venue)) &&
    ['volume', 'relative', 'oi'].includes(String(x.sort)) &&
    typeof x.descending === 'boolean'
  );
}
export function readLayouts(raw: string | null): TerminalLayout[] {
  if (!raw) return [];
  if (raw.length > 32_768) throw Error('Layout storage is oversized');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw Error('Invalid layouts');
  const { version, layouts } = parsed as { version?: unknown; layouts?: unknown };
  if (
    version !== 1 ||
    !Array.isArray(layouts) ||
    layouts.length > 10 ||
    !layouts.every(valid) ||
    new Set(layouts.map((layout) => layout.name.toLowerCase())).size !== layouts.length
  )
    throw Error('Invalid layouts');
  // Copy only supported fields; discard unrelated stored properties.
  return layouts.map(({ name, assetId, benchmark, tf, category, venue, sort, descending }) => ({
    name,
    assetId,
    benchmark,
    tf,
    category,
    venue,
    sort,
    descending,
  }));
}
export function writeLayouts(layouts: TerminalLayout[]): string {
  const raw = JSON.stringify({ version: 1, layouts });
  readLayouts(raw);
  return raw;
}
