import type { LiquidationEvent } from '../src/types.ts';
import { randomUUID } from 'node:crypto';
import { snapshot, triggered } from './store.ts';
import { deliver } from './notifications.ts';
let socket: WebSocket | null = null;
let reconnect: NodeJS.Timeout | null = null;
let stopStream: (() => void) | null = null;
let online = false;
let connectedSince: number | null = null;
const events: LiquidationEvent[] = [];
export function liquidityStatus() {
  return {
    source: 'Binance forced-order snapshots (not exhaustive exchange liquidations)',
    connected: online,
    connectedSince,
    events: events.length,
  };
}
export function liqEvents(assetId?: string, minutes = 5) {
  const now = Date.now(),
    ms = Math.min(Math.max(minutes, 1), 60) * 60_000;
  return events.filter((x) => x.time >= now - ms && (!assetId || x.assetId === assetId));
}
export function liqSummary(assetId: string, minutes = 5) {
  const rows = liqEvents(assetId, minutes),
    available = assetId.startsWith('binance:') && online;
  return {
    assetId,
    minutes,
    observedUsd: available ? rows.reduce((s, x) => s + x.notionalUsd, 0) : null,
    available,
    connected: online,
    windowCovered: connectedSince !== null && Date.now() - connectedSince >= minutes * 60_000,
    count: rows.length,
    side: {
      longs: rows.filter((x) => x.side === 'longs').reduce((s, x) => s + x.notionalUsd, 0),
      shorts: rows.filter((x) => x.side === 'shorts').reduce((s, x) => s + x.notionalUsd, 0),
    },
    coverage: assetId.startsWith('binance:') ? 'partial_snapshots' : 'unavailable',
    events: rows.slice(-100),
  };
}
export function startLiquidations(): () => void {
  if (stopStream) return stopStream;
  let stopped = false;
  let handshake: NodeJS.Timeout | null = null;
  const schedule = (delay: number) => {
    if (stopped || reconnect) return;
    reconnect = setTimeout(() => {
      reconnect = null;
      connect();
    }, delay);
    reconnect.unref();
  };
  function connect() {
    if (stopped) return;
    try {
      const current = new WebSocket('wss://fstream.binance.com/market/ws/!forceOrder@arr');
      socket = current;
      const disconnect = () => {
        // Late events from a retired socket cannot clear its replacement's state.
        if (socket !== current) return;
        socket = null;
        online = false;
        connectedSince = null;
        if (handshake) clearTimeout(handshake);
        handshake = null;
        try {
          current.close();
        } catch {
          /* Already closed or handshake failed. */
        }
        schedule(5000);
      };
      handshake = setTimeout(disconnect, 15_000);
      handshake.unref();
      current.addEventListener('open', () => {
        if (socket !== current || stopped) return;
        if (handshake) clearTimeout(handshake);
        handshake = null;
        online = true;
        connectedSince = Date.now();
      });
      current.addEventListener('message', (event) => {
        if (socket !== current || !online || stopped) return;
        try {
          const payload = JSON.parse(String(event.data)) as {
            e?: string;
            E?: number;
            o?: { s: string; S: string; ap: string; p: string; z: string; l: string; T: number };
          };
          if (payload.e !== 'forceOrder' || !payload.o) return;
          const p = payload.o,
            price = Number(p.ap) || Number(p.p),
            qty = Number(p.z) || Number(p.l);
          const time = payload.E ?? p.T;
          if (
            !Number.isFinite(price) ||
            price <= 0 ||
            !Number.isFinite(qty) ||
            qty <= 0 ||
            !Number.isFinite(price * qty) ||
            !/^[A-Z0-9]{2,30}$/.test(p.s) ||
            !['SELL', 'BUY'].includes(p.S) ||
            !Number.isFinite(time) ||
            time < Date.now() - 3600_000 ||
            time > Date.now() + 5000
          )
            return;
          const record: LiquidationEvent = {
            id: randomUUID(),
            assetId: `binance:${p.s}`,
            time,
            price,
            notionalUsd: price * qty,
            side: p.S === 'SELL' ? 'longs' : 'shorts',
            source: 'binance_snapshot',
          };
          events.push(record);
          const cut = Date.now() - 3600_000;
          while (events.length && ((events[0]?.time ?? 0) < cut || events.length > 20_000)) events.shift();
          for (const rule of snapshot().alerts.filter(
            (x) => x.enabled && x.kind === 'liquidation' && x.assetId === record.assetId,
          )) {
            if (rule.kind !== 'liquidation') continue;
            const amount = liqSummary(rule.assetId).observedUsd;
            if (amount !== null && amount >= rule.threshold)
              void triggered(
                rule,
                `${rule.assetId}: ≥ $${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })} observed liquidation snapshots in 5m`,
              )
                .then((e) => (e ? deliver(e) : undefined))
                .catch((error: unknown) =>
                  console.error(
                    'Liquidation alert failed',
                    error instanceof Error ? error.message : 'Unknown failure',
                  ),
                );
          }
        } catch {
          /* Ignore malformed exchange messages. */
        }
      });
      current.addEventListener('error', disconnect);
      current.addEventListener('close', disconnect);
    } catch {
      schedule(10_000);
    }
  }
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (reconnect) clearTimeout(reconnect);
    if (handshake) clearTimeout(handshake);
    reconnect = null;
    handshake = null;
    const current = socket;
    socket = null;
    online = false;
    connectedSince = null;
    stopStream = null;
    try {
      current?.close();
    } catch {
      /* Already closed. */
    }
  };
  stopStream = stop;
  connect();
  return stop;
}
