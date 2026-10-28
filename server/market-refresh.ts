import { cachedMarketSnapshot, marketSnapshot } from './market.ts';

export const MARKET_REFRESH_INTERVAL_MS = 10_000;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight = false;
let lastStartedAt: number | null = null;
let lastCompletedAt: number | null = null;
let completedCycles = 0;

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  lastStartedAt = Date.now();
  try {
    // Shares venue coalescing, freshness and failure backoff with API/alert reads.
    await marketSnapshot();
  } catch (error) {
    console.error('Background market refresh failed', error);
  } finally {
    lastCompletedAt = Date.now();
    completedCycles++;
    inFlight = false;
  }
}

export function stopMarketRefresh() {
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** Start once in the persistent Node API, never in the Vercel gateway/browser. */
export function startMarketRefresh() {
  if (!timer) {
    timer = setInterval(() => void refresh(), MARKET_REFRESH_INTERVAL_MS);
    timer.unref();
    void refresh();
  }
  return stopMarketRefresh;
}

export function marketRefreshStatus() {
  return {
    running: timer !== undefined,
    intervalMs: MARKET_REFRESH_INTERVAL_MS,
    inFlight,
    lastStartedAt,
    lastCompletedAt,
    completedCycles,
    // A completed cycle is not proof of fresh data; expose actual venue health.
    feeds: cachedMarketSnapshot().feeds,
  };
}
