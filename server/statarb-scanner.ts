import { randomUUID } from 'node:crypto';
import { setImmediate as yieldLoop, setTimeout as delay } from 'node:timers/promises';
import { freshMarkets } from './market.ts';
import { fetchHistoricalDataset } from './research/fetch.ts';
import { cointegrationFromLogs, type CointegrationResult } from '../src/engine/cointegration.ts';
import { validateScanConfig, type ScanConfig } from '../src/engine/statarb-settings.ts';
import type { Market } from '../src/types.ts';
export type { ScanConfig } from '../src/engine/statarb-settings.ts';
export type ScanPair = CointegrationResult & {
  y: string;
  x: string;
  observedAt: number;
  signalTime: number;
  direction: 'long_spread' | 'short_spread' | 'watch';
  longLeg: string;
  shortLeg: string;
  outsideStop: boolean;
  warnings: string[];
};
export type ScanJob = {
  method: 'log-ols-eg-adf1-mackinnon2010-unadjusted-v1';
  id: string;
  config: ScanConfig;
  status: 'fetching' | 'testing' | 'done' | 'cancelled' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  universe: number;
  loaded: number;
  failed: { asset: string; reason: string }[];
  tested: number;
  invalidPairs: number;
  totalPairs: number;
  passed: number;
  opportunities: number;
  results: ScanPair[];
  error?: string;
};
export class ScannerError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function parseScan(input: unknown): ScanConfig {
  try {
    return validateScanConfig(input);
  } catch (e) {
    throw new ScannerError(e instanceof Error ? e.message : 'Invalid scanner settings');
  }
}
type Deps = {
  markets: () => Promise<Market[]>;
  history: typeof fetchHistoricalDataset;
  pause: () => Promise<unknown>;
  pace?: (ms: number) => Promise<unknown>;
};
const defaults: Deps = {
  markets: freshMarkets,
  history: fetchHistoricalDataset,
  pause: () => yieldLoop(),
  pace: (ms) => delay(ms),
};
export function historyPaceMs(config: ScanConfig) {
  const count = config.formationBars + 1,
    pages = Math.ceil(count / 500);
  if (config.venue === 'hyperliquid') return Math.ceil((1000 * 2 * (pages * 20 + count / 60)) / 10);
  const full = Math.floor(count / 500),
    tail = count % 500;
  const weight = full * 5 + (tail ? (tail < 100 ? 1 : 2) : 0);
  return Math.ceil((1000 * 2 * weight) / 20);
}
let job: ScanJob | null = null;
/** Keep a bounded ranked result set without re-sorting 500 rows on every passing pair. */
export function retainScanPair(rows: ScanPair[], pair: ScanPair) {
  const compare = (a: ScanPair, b: ScanPair) =>
    Number(Math.abs(b.z) >= 2) - Number(Math.abs(a.z) >= 2) || a.adf - b.adf;
  let low = 0,
    high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compare(pair, rows[middle]!) < 0) high = middle;
    else low = middle + 1;
  }
  if (low < 500) rows.splice(low, 0, pair);
  if (rows.length > 500) rows.length = 500;
}
export function scanStatus() {
  return job ? structuredClone(job) : null;
}
export function cancelScan() {
  if (job && ['fetching', 'testing'].includes(job.status)) {
    job.status = 'cancelled';
    job.finishedAt = Date.now();
  }
  return scanStatus();
}
export function startScan(input: unknown, deps: Deps = defaults) {
  const config = parseScan(input);
  if (job && ['fetching', 'testing'].includes(job.status))
    throw new ScannerError('A venue scan is already running; cancel or wait.', 409);
  if (job && Date.now() - job.startedAt < 60_000)
    throw new ScannerError('Please allow one minute between venue scans.', 429);
  const current: ScanJob = {
    method: 'log-ols-eg-adf1-mackinnon2010-unadjusted-v1',
    id: randomUUID(),
    config,
    status: 'fetching',
    startedAt: Date.now(),
    finishedAt: null,
    universe: 0,
    loaded: 0,
    failed: [],
    tested: 0,
    invalidPairs: 0,
    totalPairs: 0,
    passed: 0,
    opportunities: 0,
    results: [],
  };
  job = current;
  void run(current, deps);
  return structuredClone(current);
}
export async function run(current: ScanJob, deps: Deps = defaults) {
  try {
    const assets = (await deps.markets())
      .filter((m) => m.venue === current.config.venue)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!assets.length) throw Error('No live markets for this venue');
    if (assets.length > 1200)
      throw Error('Venue exceeds the 1200-market runtime bound; no partial universe was scanned');
    current.universe = assets.length;
    const series: { id: string; logs: number[]; times: number[] }[] = [];
    // Two requests at once. Every available venue asset is attempted; no volume/OI gate.
    for (let i = 0; i < assets.length; i += 2) {
      if (current.status === 'cancelled') return;
      const batchStarted = Date.now();
      const outcomes = await Promise.allSettled(
        assets.slice(i, i + 2).map(async (a) => {
          const d = await deps.history(
            a.id,
            current.config.timeframe,
            current.config.formationBars + 1,
            current.startedAt,
          );
          return {
            id: a.id,
            logs: d.candles.map((b) => Math.log(b.close)),
            times: d.candles.map((b) => b.time),
          };
        }),
      );
      outcomes.forEach((r, k) => {
        if (r.status === 'fulfilled') {
          series.push(r.value);
          current.loaded++;
        } else
          current.failed.push({
            asset: assets[i + k]!.id,
            reason: r.reason instanceof Error ? r.reason.message : 'History unavailable',
          });
      });
      await deps.pause();
      if ((current.status as string) !== 'cancelled' && i + 2 < assets.length && deps.pace)
        await deps.pace(Math.max(0, historyPaceMs(current.config) - (Date.now() - batchStarted)));
    }
    if (current.status === 'cancelled') return;
    current.status = 'testing';
    current.totalPairs = (series.length * (series.length - 1)) / 2;
    for (let i = 0; i < series.length; i++)
      for (let j = i + 1; j < series.length; j++) {
        if ((current.status as string) === 'cancelled') return;
        const y = series[i]!,
          x = series[j]!;
        current.tested++;
        try {
          if (
            y.times.length !== current.config.formationBars + 1 ||
            x.times.length !== y.times.length ||
            y.times.some((t, k) => t !== x.times[k])
          )
            throw Error('Mismatched complete candle grid');
          const r = cointegrationFromLogs(y.logs, x.logs);
          const eligible =
            current.config.preset === 'crypto'
              ? r.level !== 'none'
              : ['1%', '5%'].includes(r.level) &&
                r.betaDrift < 0.35 &&
                r.halfLife !== null &&
                r.halfLife >= 2 &&
                r.halfLife <= 90;
          if (eligible) {
            current.passed++;
            if (Math.abs(r.z) >= 2) current.opportunities++;
            const short = r.z >= 0;
            const result: ScanPair = {
              ...r,
              y: y.id,
              x: x.id,
              observedAt: current.startedAt,
              signalTime: y.times.at(-1)!,
              direction: Math.abs(r.z) >= 2 ? (short ? 'short_spread' : 'long_spread') : 'watch',
              longLeg: short ? x.id : y.id,
              shortLeg: short ? y.id : x.id,
              outsideStop: Math.abs(r.z) >= 4,
              warnings: [
                ...(r.betaDrift >= 0.35
                  ? ['Hedge ratio changed by at least 35% between formation halves']
                  : []),
                ...(r.halfLife === null ? ['Positive finite mean-reversion half-life not demonstrated'] : []),
                ...(r.level === '10%' ? ['Weak 10% cointegration screen'] : []),
              ],
            };
            retainScanPair(current.results, result);
          }
        } catch {
          current.invalidPairs++;
        }
        if (current.tested % 40 === 0) await deps.pause();
      }
    if ((current.status as string) === 'cancelled') return;
    current.status = 'done';
    current.finishedAt = Date.now();
  } catch (e) {
    if (current.status !== 'cancelled') {
      current.status = 'failed';
      current.error = e instanceof Error ? e.message : 'Scan failed';
      current.finishedAt = Date.now();
    }
  }
}
