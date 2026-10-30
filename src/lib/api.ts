import type { JournalData, JournalTrade, JournalDay } from '../journal/model.ts';
import type { ScanConfig, ScanJob } from '../../server/statarb-scanner.ts';
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
/** All requests have bounded lifetimes. Mutations are never automatically retried. */
async function request<T>(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal,
  timeoutMs = 20_000,
  errorPrefix = '',
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    if (res.status === 401 && import.meta.env.VITE_FLUXDESK_APP_LOGIN === 'true')
      window.dispatchEvent(new Event('fluxdesk-session-expired'));
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const detail = typeof body?.error === 'string' ? body.error : `Request failed (HTTP ${res.status})`;
      throw Error(errorPrefix ? `${errorPrefix} ${detail}` : detail);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (error) {
    if (timedOut)
      throw Error(
        options.method && options.method !== 'GET'
          ? 'Request timed out. The server may have saved it; refresh and check before trying again.'
          : 'Request timed out. Please try again.',
      );
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
const get = <T>(url: string, signal?: AbortSignal, timeoutMs = 20_000) =>
  request<T>(url, {}, signal, timeoutMs);
const postResearch = <T>(url: string, payload: unknown, timeoutMs = 90_000, errorPrefix = '') =>
  request<T>(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    undefined,
    timeoutMs,
    errorPrefix,
  );
export const api = {
  importJournal: (data: JournalData) =>
    postResearch<{ imported: number; skipped: number }>('/api/journal/import', data),
  journal: () => get<JournalData>('/api/journal'),
  saveJournalTrade: (trade: JournalTrade) =>
    postResearch<{ trade: JournalTrade }>('/api/journal/trades', trade),
  saveJournalDay: (day: JournalDay) => postResearch<{ day: JournalDay }>('/api/journal/day', day),
  deleteJournalTrade: (id: string, revision: number) =>
    request<{ ok: boolean }>(
      '/api/journal/trades?' + new URLSearchParams({ id, revision: String(revision) }),
      { method: 'DELETE' },
    ),
  statarbStatus: () => get<{ scan: ScanJob | null }>('/api/statarb/scan'),
  startStatArb: (config: ScanConfig) => postResearch<{ scan: ScanJob }>('/api/statarb/scan', config),
  cancelStatArb: () => request<{ ok: boolean }>('/api/statarb/scan', { method: 'DELETE' }),
  researchDatasets: (signal?: AbortSignal) =>
    get<{ datasets: DatasetReceipt[]; rejected: number }>('/api/research/datasets', signal, 30_000),
  researchFetch: (payload: { assetId: string; interval: '15m' | '1h' | '4h' | '1d'; count: number }) =>
    postResearch<{ dataset: DatasetReceipt }>('/api/research/datasets', payload),
  researchMarketHistory: (datasetId: string) =>
    postResearch<{ dataset: DatasetReceipt }>('/api/research/market-history', { datasetId }),
  researchBacktest: (datasetId: string, config: ResearchConfig) =>
    postResearch<StoredResearchReport>('/api/research/backtests', { datasetId, config }),
  watchlist: (signal?: AbortSignal) => get<{ assetIds: string[] }>('/api/watchlist', signal),
  changeWatchlist: (id: string, add: boolean) =>
    request<{ assetIds: string[] }>(
      add ? '/api/watchlist' : '/api/watchlist?asset=' + encodeURIComponent(id),
      {
        method: add ? 'POST' : 'DELETE',
        ...(add
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: id }) }
          : {}),
      },
    ),
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
  createAlert: (data: AlertInput) => postResearch<{ alert: AlertRule }>('/api/alerts', data, 20_000),
  deleteAlert: (id: string) => request<void>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  unsubscribe: (endpoint: string) =>
    request<void>(
      '/api/push/subscribe',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      },
      undefined,
      20_000,
      'Could not disable push notifications. Please retry.',
    ),
  vapidKey: () => get<{ key: string }>('/api/push/key'),
  subscribe: (data: PushSubscription) =>
    postResearch<void>('/api/push/subscribe', data, 20_000, 'Push subscription failed.'),
};
