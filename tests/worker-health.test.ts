import { expect, it } from 'vitest';
import { assessWorkerHealth } from '../src/lib/worker-health.ts';

const at = Date.parse('2026-11-04T18:00:00Z');
function healthy() {
  return {
    ok: true,
    at,
    liquidations: { connected: true },
    markets: {
      running: true,
      intervalMs: 10_000,
      completedCycles: 42,
      lastStartedAt: at - 5_000,
      lastCompletedAt: at - 4_000,
      feeds: [
        { venue: 'binance', status: 'live', lastSuccessAt: at - 5_000 },
        { venue: 'hyperliquid', status: 'live', lastSuccessAt: at - 5_000 },
      ],
    },
  };
}

it('reads passive worker progress independently of market snapshots', () => {
  expect(assessWorkerHealth(healthy(), at, at + 10_000)).toEqual({
    state: 'healthy', cycles: 42, completedAgeMs: 4_000,
  });
  expect(assessWorkerHealth({ ...healthy(), markets: { ...healthy().markets, completedCycles: 0 } }, at, at))
    .toMatchObject({ state: 'degraded' });
});

it('never marks missing, stale or future worker/feed timestamps as healthy', () => {
  const value = healthy();
  for (const timestamp of [undefined, NaN, at + 1, at - 120_001]) {
    expect(assessWorkerHealth({ ...value, markets: { ...value.markets, lastCompletedAt: timestamp } }, at, at))
      .toMatchObject({ state: 'degraded' });
    expect(assessWorkerHealth({ ...value, markets: { ...value.markets, feeds: [
      { ...value.markets.feeds[0], lastSuccessAt: timestamp }, value.markets.feeds[1],
    ] } }, at, at)).toMatchObject({ state: 'degraded' });
  }
  expect(assessWorkerHealth({ ...value, markets: { ...value.markets, lastStartedAt: null } }, at, at))
    .toMatchObject({ state: 'degraded' });
});

it('separates an unavailable monitor from a diagnosed worker problem', () => {
  const value = healthy();
  expect(assessWorkerHealth(value, at, at + 46_000)).toMatchObject({ state: 'unavailable' });
  expect(assessWorkerHealth({ ...value, liquidations: { connected: false } }, at, at))
    .toMatchObject({ state: 'degraded' });
  expect(assessWorkerHealth({ ...value, markets: { ...value.markets, feeds: [value.markets.feeds[0]] } }, at, at))
    .toMatchObject({ state: 'degraded' });
});
