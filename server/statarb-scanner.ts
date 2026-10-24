import { randomUUID } from 'node:crypto';
import { setImmediate as yieldLoop, setTimeout as delay } from 'node:timers/promises';
import { freshMarkets } from './market.ts';
import { fetchHistoricalDataset } from './research/fetch.ts';
import { cointegration, type CointegrationResult } from '../src/engine/cointegration.ts';
import { assertInterval, type CandleInterval } from '../src/engine/intervals.ts';
import type { Market, Venue } from '../src/types.ts';
export type ScanConfig = {
  venue: Venue;
  timeframe: CandleInterval;
  formationBars: 180 | 300 | 500 | 1080;
  preset: 'crypto' | 'selective';
};
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
  const o = input as ScanConfig;
  if (
    !o ||
    !['binance', 'hyperliquid'].includes(o.venue) ||
    !['crypto', 'selective'].includes(o.preset) ||
    ![180, 300, 500, 1080].includes(o.formationBars)
  )
    throw new ScannerError('Invalid scanner settings');
  assertInterval(o.venue, o.timeframe);
  if (!['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'].includes(o.timeframe))
    throw new ScannerError('Choose a fixed intraday or daily scanner timeframe');
  return { venue: o.venue, preset: o.preset, formationBars: o.formationBars, timeframe: o.timeframe };
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
    const series: { id: string; closes: number[]; times: number[] }[] = [];
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
          return { id: a.id, closes: d.candles.map((b) => b.close), times: d.candles.map((b) => b.time) };
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
          const r = cointegration(y.closes, x.closes);
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
            current.results.push(result);
            current.results.sort(
              (a, b) => Number(Math.abs(b.z) >= 2) - Number(Math.abs(a.z) >= 2) || a.adf - b.adf,
            );
            if (current.results.length > 500) current.results.length = 500;
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
