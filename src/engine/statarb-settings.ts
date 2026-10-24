import { assertInterval, intervalDurationMs, type CandleInterval } from './intervals.ts';
import type { Venue } from '../types.ts';
export const SCANNER_TIMEFRAMES = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '2h',
  '4h',
  '6h',
  '8h',
  '12h',
  '1d',
] as const;
export type ScanConfig = {
  venue: Venue;
  timeframe: CandleInterval;
  formationBars: 180 | 300 | 500 | 1080;
  preset: 'crypto' | 'selective';
};
export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  venue: 'binance',
  timeframe: '4h',
  formationBars: 300,
  preset: 'crypto',
};
export function validateScanConfig(input: unknown): ScanConfig {
  const o = input as ScanConfig;
  if (
    !o ||
    !['binance', 'hyperliquid'].includes(o.venue) ||
    !['crypto', 'selective'].includes(o.preset) ||
    ![180, 300, 500, 1080].includes(o.formationBars)
  )
    throw Error('Invalid scanner settings');
  assertInterval(o.venue, o.timeframe);
  if (!(SCANNER_TIMEFRAMES as readonly string[]).includes(o.timeframe))
    throw Error('Choose a fixed intraday or daily scanner timeframe');
  return { venue: o.venue, preset: o.preset, formationBars: o.formationBars, timeframe: o.timeframe };
}
export type ScanPreferences = {
  version: 1;
  config: ScanConfig;
  onlySignals: boolean;
  sort: 'strength' | 'deviation' | 'halfLife';
  direction: 'all' | 'long_spread' | 'short_spread' | 'watch';
};
export const SCAN_PREFERENCES_KEY = 'fluxdesk.statarb.preferences.v1';
export function readScanPreferences(raw: string | null): ScanPreferences {
  const fallback: ScanPreferences = {
    version: 1,
    config: { ...DEFAULT_SCAN_CONFIG },
    onlySignals: true,
    sort: 'strength',
    direction: 'all',
  };
  try {
    const p = JSON.parse(raw ?? 'null') as ScanPreferences;
    if (
      !p ||
      p.version !== 1 ||
      typeof p.onlySignals !== 'boolean' ||
      !['strength', 'deviation', 'halfLife'].includes(p.sort) ||
      !['all', 'long_spread', 'short_spread', 'watch'].includes(p.direction)
    )
      return fallback;
    return {
      version: 1,
      config: validateScanConfig(p.config),
      onlySignals: p.onlySignals,
      sort: p.sort,
      direction: p.direction,
    };
  } catch {
    return fallback;
  }
}
/** Signal timestamps are bar opens. Age counts additional completed interval bars. */
export function scanCandleAge(signalTime: number, timeframe: CandleInterval, now: number) {
  const duration = intervalDurationMs(timeframe),
    closedAt = signalTime + duration;
  return { closedAt, barsBehind: Math.max(0, Math.floor((now - closedAt) / duration)) };
}
