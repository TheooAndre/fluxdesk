import type {
  AlertEvent,
  AlertRule,
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
} from '../types.ts';
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
export const api = {
  markets: (signal?: AbortSignal) =>
    get<MarketSnapshot & { benchmarks: Record<string, Market | null> }>('/api/markets', signal),
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
  createAlert: async (data: { assetId: string; kind: string; threshold: number; direction?: string }) => {
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
