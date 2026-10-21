import type { Candle, Market, PairCandidate, ScannedSignal } from '../src/types.ts';
import { intervalsFor } from '../src/engine/intervals.ts';
import { detectSignals } from '../src/engine/signals.ts';
import { pairStats } from '../src/engine/stats.ts';
import { assetIdentity, candles, freshMarkets } from './market.ts';
import { RequestCache } from './cache.ts';
const cache = new RequestCache(100);
type Dependencies = {
  candles: (asset: string, tf: string, limit: number) => Promise<Candle[]>;
  markets: () => Promise<Market[]>;
};
const defaults: Dependencies = { candles, markets: freshMarkets };
const message = (e: unknown) => (e instanceof Error ? e.message : 'Feed unavailable');

export async function scanSignals(asset: string, deps = defaults) {
  const { venue } = assetIdentity(asset);
  const timeframes = intervalsFor(venue);
  const matches: ScannedSignal[] = [];
  const failed: { timeframe: string; reason: string }[] = [];
  const inspected: { timeframe: string; bars: number; lastCloseTime: number }[] = [];
  for (let i = 0; i < timeframes.length; i += 4) {
    const batch = timeframes.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(async (timeframe) => {
        const series = await deps.candles(asset, timeframe, 180);
        if (series.length < 65) throw Error(`Insufficient history: ${series.length}/65 completed bars`);
        return {
          timeframe,
          signals: detectSignals(series),
          bars: series.length,
          lastCloseTime: series.at(-1)!.closeTime ?? series.at(-1)!.time,
        };
      }),
    );
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') {
        const { signals, ...summary } = result.value;
        inspected.push(summary);
        for (const signal of signals) matches.push({ ...signal, timeframe: result.value.timeframe });
      } else failed.push({ timeframe: batch[j]!, reason: message(result.reason) });
    });
  }
  return {
    asset,
    venue,
    directions: ['long', 'short'],
    models: ['sfp', 'msb', 'pullback', 'range'],
    checkedAt: Date.now(),
    inspected,
    failed,
    signals: matches,
  };
}
export async function scanCorrelations(asset: string, tf: string, minimum: number, deps = defaults) {
  const { venue } = assetIdentity(asset);
  const universe = (await deps.markets())
    .filter((x) => x.venue === venue && x.id !== asset && x.volumeUsd24h >= 1_000_000)
    .sort((a, b) => b.volumeUsd24h - a.volumeUsd24h)
    .slice(0, 28);
  const reference = await deps.candles(asset, tf, 150);
  const candidates: PairCandidate[] = [];
  const failed: { asset: string; reason: string }[] = [];
  let checked = 0;
  for (let i = 0; i < universe.length; i += 4) {
    const batch = universe.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map(async (x) => {
        const stats = pairStats(asset, x.id, reference, await deps.candles(x.id, tf, 150), 80);
        if (!stats) throw Error('Insufficient aligned history or undefined return/spread variance');
        return stats;
      }),
    );
    results.forEach((r, j) => {
      const id = batch[j]!.id;
      if (r.status === 'fulfilled') {
        checked++;
        if (r.value.correlation >= minimum)
          candidates.push({
            id,
            correlation: r.value.correlation,
            zScore: r.value.zScore,
            beta: r.value.beta,
            points: r.value.points,
          });
      } else failed.push({ asset: id, reason: message(r.reason) });
    });
  }
  return {
    asset,
    threshold: minimum,
    screened: universe.length,
    checked,
    failed,
    checkedAt: Date.now(),
    candidates: candidates.sort((a, b) => b.correlation - a.correlation),
  };
}
export const cachedSignalScan = (asset: string) =>
  cache.get(`signals:${asset}`, 15_000, () => scanSignals(asset));
export const cachedCorrelationScan = (asset: string, tf: string, minimum: number) =>
  cache.get(`correlations:${asset}:${tf}:${minimum}`, 30_000, () => scanCorrelations(asset, tf, minimum));
