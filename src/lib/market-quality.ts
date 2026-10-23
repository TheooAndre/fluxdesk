import type { Market } from '../types.ts';
import { relativeReturn } from '../engine/stats.ts';

export function priceBasisLabel(item: Market): string {
  return item.priceBasis === 'last' ? 'Last trade' : item.priceBasis === 'mark' ? 'Mark' : 'Basis unknown';
}
export function relativeToBenchmark(asset: Market, benchmark: Market | null, isUsd: boolean): number | null {
  if (isUsd) return relativeReturn(asset.return24h, 0);
  if (!benchmark || !asset.priceBasis || asset.priceBasis !== benchmark.priceBasis) return null;
  return relativeReturn(asset.return24h, benchmark.return24h);
}
export function quoteAge(asOf: number | null, now: number): string {
  if (asOf === null) return 'Age unknown';
  const seconds = Math.max(0, Math.floor((now - asOf) / 1000));
  return seconds < 60 ? `${seconds}s old` : `${Math.floor(seconds / 60)}m ${seconds % 60}s old`;
}
