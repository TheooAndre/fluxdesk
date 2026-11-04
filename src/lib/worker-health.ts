type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function age(timestamp: unknown, at: number): number | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0)
    return null;
  const elapsed = at - timestamp;
  return elapsed >= 0 && elapsed <= 120_000 ? elapsed : null;
}

export type WorkerAssessment =
  | { state: 'healthy'; cycles: number; completedAgeMs: number }
  | { state: 'degraded' | 'unavailable'; reason: string };

/** This response is passive: a market request cannot advance the worker cycle count. */
export function assessWorkerHealth(payload: unknown, sampledAt: number, now: number): WorkerAssessment {
  if (!Number.isFinite(sampledAt) || sampledAt <= 0 || now < sampledAt || now - sampledAt > 45_000)
    return { state: 'unavailable', reason: 'Background refresh status is delayed.' };
  const health = record(payload);
  if (!health || typeof health.at !== 'number' || !Number.isFinite(health.at) || health.at <= 0)
    return { state: 'degraded', reason: 'Background refresh status is incomplete.' };
  if (health.ok !== true) return { state: 'degraded', reason: 'The dashboard health check is not OK.' };
  const liquidations = record(health.liquidations);
  if (!liquidations || liquidations.connected !== true)
    return { state: 'degraded', reason: 'The liquidation stream is disconnected.' };
  const markets = record(health.markets);
  if (
    !markets ||
    markets.running !== true ||
    markets.intervalMs !== 10_000 ||
    typeof markets.completedCycles !== 'number' ||
    !Number.isSafeInteger(markets.completedCycles) ||
    markets.completedCycles <= 0
  )
    return { state: 'degraded', reason: 'The background market worker is not reporting normal progress.' };
  const completedAgeMs = age(markets.lastCompletedAt, health.at);
  if (completedAgeMs === null || age(markets.lastStartedAt, health.at) === null)
    return { state: 'degraded', reason: 'The background market worker has no recent valid cycle.' };
  if (!Array.isArray(markets.feeds))
    return { state: 'degraded', reason: 'Background feed status is incomplete.' };
  for (const venue of ['binance', 'hyperliquid']) {
    const matches = markets.feeds.filter((feed) => record(feed)?.venue === venue);
    if (matches.length !== 1 || record(matches[0])?.status !== 'live' ||
      age(record(matches[0])?.lastSuccessAt, health.at) === null)
      return { state: 'degraded', reason: `${venue === 'binance' ? 'Binance' : 'Hyperliquid'} background feed is not live and recent.` };
  }
  return { state: 'healthy', cycles: markets.completedCycles, completedAgeMs };
}
