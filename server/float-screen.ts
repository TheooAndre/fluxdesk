import type { Market, FloatEvidence } from '../src/types.ts';
import { LOW_FLOAT_HIGH_FDV_SNAPSHOT } from '../src/lib/categories.ts';
// Explicit identities only. Symbol collisions never attach another project's supply figures.
export const FLOAT_IDENTITIES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(LOW_FLOAT_HIGH_FDV_SNAPSHOT.map((e) => [e.symbol, e.coingeckoId])),
  ONDO: 'ondo-finance',
  ARB: 'arbitrum',
  OP: 'optimism',
  STRK: 'starknet',
  ENA: 'ethena',
  TIA: 'celestia',
  EIGEN: 'eigenlayer',
  ZK: 'zksync',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
};
const HOUR = 3600_000;
let entries = new Map<string, FloatEvidence>();
let lastAttempt = 0;
let failure = false;
let pending: Promise<void> | undefined;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function parseFloatScreen(raw: unknown, now = Date.now()): Map<string, FloatEvidence> {
  if (!Array.isArray(raw) || raw.length > 50) throw Error('Invalid supply response');
  const result = new Map<string, FloatEvidence>();
  for (const value of raw) {
    if (!value || typeof value !== 'object') throw Error('Invalid supply row');
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.symbol !== 'string') throw Error('Invalid supply identity');
    const symbol = Object.keys(FLOAT_IDENTITIES).find((key) => FLOAT_IDENTITIES[key] === row.id);
    if (!symbol || row.symbol.toUpperCase() !== symbol || result.has(symbol)) continue;
    const at = typeof row.last_updated === 'string' ? Date.parse(row.last_updated) : NaN;
    if (!finite(at) || at > now || now - at > 24 * HOUR) continue;
    const cap = row.market_cap,
      fdv = row.fully_diluted_valuation,
      max = row.max_supply;
    if (!finite(cap) || cap <= 0 || !finite(fdv) || fdv <= 0 || !finite(max) || max <= 0 || cap > fdv * 1.01)
      continue;
    result.set(symbol, {
      coingeckoId: row.id,
      marketCapToFdv: cap / fdv,
      fdvUsd: fdv,
      maxSupply: max,
      asOf: at,
    });
  }
  return result;
}
export async function refreshFloatScreen() {
  if (pending) return pending;
  if (lastAttempt && Date.now() - lastAttempt < HOUR) return;
  lastAttempt = Date.now();
  pending = (async () => {
    try {
      const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
      url.searchParams.set('vs_currency', 'usd');
      url.searchParams.set('ids', Object.values(FLOAT_IDENTITIES).join(','));
      url.searchParams.set('per_page', '50');
      const key = process.env.COINGECKO_DEMO_API_KEY?.trim();
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/json', ...(key ? { 'x-cg-demo-api-key': key } : {}) },
      });
      if (!response.ok) throw Error('Supply provider unavailable');
      const reader = response.body?.getReader();
      if (!reader) throw Error('Empty supply response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 500_000) throw Error('Supply response too large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const text = Buffer.concat(chunks).toString('utf8');
      const next = parseFloatScreen(JSON.parse(text));
      if (!next.size) throw Error('No valid supply observations');
      entries = next;
      failure = false;
    } catch {
      failure = true;
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
export function withFloatScreen(assets: Market[], now = Date.now()): Market[] {
  return assets.map((market) => {
    const match = /^(?:binance:([A-Z0-9]+)USDT|hyperliquid:([A-Z0-9]+))$/.exec(market.id);
    const symbol = match?.[1] ?? match?.[2];
    const evidence = symbol ? entries.get(symbol) : undefined;
    return {
      ...market,
      floatScreen: evidence
        ? {
            status: failure || now - evidence.asOf > 24 * HOUR ? ('stale' as const) : ('fresh' as const),
            evidence,
          }
        : { status: symbol && FLOAT_IDENTITIES[symbol] ? ('unavailable' as const) : ('unknown' as const) },
    };
  });
}

export function startFloatRefresh() {
  void refreshFloatScreen();
  const timer = setInterval(() => void refreshFloatScreen(), HOUR);
  timer.unref();
  return () => clearInterval(timer);
}
