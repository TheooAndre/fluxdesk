import type {
  AlertEvent,
  AlertRule,
  AlertInput,
  Candle,
  EconomicEvent,
  EntrySignal,
  ScannedSignal,
  LiquidationEvent,
  Market,
  MarketSnapshot,
  PairCandidate,
  PairStats,
  PriceLevel,
  PerpetualQuote,
} from '../types.ts';
import type { ResearchConfig } from '../engine/backtest.ts';
import type { DatasetReceipt } from '../../server/research/datasets.ts';
import type { StoredResearchReport } from '../../server/research/runner.ts';
async function get<T>(url: string, signal?: AbortSignal, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
      throw Error(body.error ?? 'API error');
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
async function postResearch<T>(url: string, payload: unknown, timeoutMs = 90_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({ error: 'Research request failed' }))) as { error?: string };
      throw Error(data.error ?? 'Research request failed');
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
export const api = {
  researchDatasets: (signal?: AbortSignal) =>
    get<{ datasets: DatasetReceipt[]; rejected: number }>('/api/research/datasets', signal, 30_000),
  researchFetch: (payload: { assetId: string; interval: '15m' | '1h' | '4h' | '1d'; count: number }) =>
    postResearch<{ dataset: DatasetReceipt }>('/api/research/datasets', payload),
  researchMarketHistory: (datasetId: string) => postResearch<{ dataset: DatasetReceipt }>('/api/research/market-history', { datasetId }),
  researchBacktest: (datasetId: string, config: ResearchConfig) =>
    postResearch<StoredResearchReport>('/api/research/backtests', { datasetId, config }),
  watchlist: (signal?: AbortSignal) => get<{ assetIds: string[] }>('/api/watchlist', signal),
  changeWatchlist: async (id: string, add: boolean): Promise<{ assetIds: string[] }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(add ? '/api/watchlist' : '/api/watchlist?asset=' + encodeURIComponent(id), {
        method: add ? 'POST' : 'DELETE', signal: controller.signal, cache: 'no-store',
        ...(add ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: id }) } : {}),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Watchlist update failed' })) as { error?: string };
        throw Error(data.error ?? 'Watchlist update failed');
      }
      return await response.json() as { assetIds: string[] };
    } finally { clearTimeout(timer); }
  },
  markets: (signal?: AbortSignal) =>
    get<MarketSnapshot & { benchmarks: Record<string, Market | null> }>('/api/markets', signal),
  perpetual: (id: string, signal?: AbortSignal) =>
    get<PerpetualQuote>('/api/perpetual?asset=' + encodeURIComponent(id), signal),
  asset: (id: string, tf: string, major: string, signal?: AbortSignal) =>
    get<{
      id: string;
      tf: string;
      openInterestUsd: number | null;
      benchmarkOI: { id: string; usd: number | null; ratio: number | null; venueMatched: boolean } | null;
      liquidationPriceClusters: { price: number; notionalUsd: number; count: number }[];
      levels: PriceLevel[];
      signals: EntrySignal[];
      candles: Candle[];
      liquidations: {
        observedUsd: number | null;
        available: boolean;
        windowCovered: boolean;
        count: number;
        events: LiquidationEvent[];
        coverage: string;
      };
    }>(
      '/api/asset?asset=' +
        encodeURIComponent(id) +
        '&tf=' +
        encodeURIComponent(tf) +
        '&major=' +
        encodeURIComponent(major),
      signal,
    ),
  signals: (asset: string, signal?: AbortSignal) =>
    get<{
      asset: string;
      venue: string;
      checkedAt: number;
      inspected: { timeframe: string; bars: number }[];
      failed: { timeframe: string; reason: string }[];
      signals: ScannedSignal[];
    }>('/api/signals?asset=' + encodeURIComponent(asset), signal, 90_000),
  pair: (a: string, b: string, tf: string, signal?: AbortSignal) =>
    get<{ stats: PairStats | null }>(
      `/api/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}&tf=${tf}`,
      signal,
    ),
  correlations: (asset: string, tf: string, signal?: AbortSignal) =>
    get<{
      asset: string;
      threshold: number;
      screened: number;
      checked: number;
      checkedAt: number;
      failed: { asset: string; reason: string }[];
      candidates: PairCandidate[];
    }>(`/api/correlations?asset=${encodeURIComponent(asset)}&tf=${tf}&minimum=0.87`, signal, 90_000),
  alerts: () => get<{ alerts: AlertRule[]; events: AlertEvent[] }>('/api/alerts'),
  calendar: () => get<{ configured: boolean; events: EconomicEvent[]; message?: string }>('/api/calendar'),
  liquidations: (asset: string) =>
    get<{
      observedUsd: number | null;
      available: boolean;
      windowCovered: boolean;
      count: number;
      events: LiquidationEvent[];
      coverage: string;
    }>(`/api/liquidations?asset=${encodeURIComponent(asset)}&minutes=5`),
  createAlert: async (data: AlertInput) => {
    const res = await fetch('/api/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw Error(((await res.json()) as { error: string }).error);
    return res.json();
  },
  deleteAlert: async (id: string) => {
    const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw Error('Could not remove alert');
  },
  unsubscribe: async (endpoint: string) => {
    const res = await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) throw Error('Could not disable push notifications. Please retry.');
  },
  vapidKey: () => get<{ key: string }>('/api/push/key'),
  subscribe: async (data: PushSubscription) => {
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw Error('Push subscription failed');
  },
};
