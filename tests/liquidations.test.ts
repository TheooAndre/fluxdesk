import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../server/store.ts', () => ({ snapshot: () => ({ alerts: [] }) }));
vi.mock('../server/notifications.ts', () => ({ deliver: vi.fn() }));
class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  close = vi.fn();
  constructor() {
    super();
    FakeSocket.instances.push(this);
  }
  sendOrder(patch: Record<string, unknown> = {}) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          e: 'forceOrder',
          E: Date.now(),
          o: { s: 'BTCUSDT', S: 'SELL', ap: '100', p: '100', z: '2', l: '2', T: Date.now(), ...patch },
        }),
      }),
    );
  }
}
let stream: typeof import('../server/liquidations.ts');
let stop: (() => void) | undefined;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  stream = await import('../server/liquidations.ts');
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('ignores a retired socket error, close, open and message after its replacement connects', async () => {
  stop = stream.startLiquidations();
  expect(stream.startLiquidations()).toBe(stop);
  const first = FakeSocket.instances[0]!;
  first.dispatchEvent(new Event('open'));
  first.sendOrder();
  expect(stream.liqSummary('binance:BTCUSDT').observedUsd).toBe(200);
  first.dispatchEvent(new Event('error'));
  expect(stream.liquidityStatus().connected).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  const second = FakeSocket.instances[1]!;
  second.dispatchEvent(new Event('open'));
  const since = stream.liquidityStatus().connectedSince;
  first.dispatchEvent(new Event('close'));
  first.dispatchEvent(new Event('open'));
  first.sendOrder();
  await vi.advanceTimersByTimeAsync(5000);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(stream.liquidityStatus()).toMatchObject({ connected: true, connectedSince: since });
  expect(stream.liqEvents()).toHaveLength(1);
  second.sendOrder();
  expect(stream.liqEvents()).toHaveLength(2);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.instances).toHaveLength(2);
  expect(stream.liquidityStatus().connected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('retries a handshake that never opens and rejects malformed financial observations', async () => {
  stop = stream.startLiquidations();
  const first = FakeSocket.instances[0]!;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(first.close).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5000);
  const second = FakeSocket.instances[1]!;
  second.dispatchEvent(new Event('open'));
  for (const patch of [{ ap: '-1' }, { z: '-3' }, { S: 'UNKNOWN' }, { ap: 'Infinity' }, { s: '../invalid' }])
    second.sendOrder(patch);
  expect(stream.liqEvents()).toEqual([]);
  second.sendOrder({ S: 'BUY' });
  expect(stream.liqSummary('binance:BTCUSDT').side.shorts).toBe(200);
  expect(stream.liqSummary('hyperliquid:BTC').observedUsd).toBeNull();
});
