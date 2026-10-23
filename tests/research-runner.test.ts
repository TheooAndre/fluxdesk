import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveHistoricalDataset } from '../server/research/datasets.ts';
import { runStoredBacktest } from '../server/research/runner.ts';
import type { HistoricalDataset } from '../server/research/datasets.ts';

const hour = 3_600_000;
const start = Date.UTC(2025, 0, 1);
const data: HistoricalDataset = {
  schemaVersion: 1,
  assetId: 'binance:BTCUSDT',
  venue: 'binance',
  interval: '1h',
  capturedAt: start + 100 * hour,
  candles: Array.from({ length: 90 }, (_, i) => ({
    time: start + i * hour, closeTime: start + (i + 1) * hour - 1,
    open: 100, high: 101, low: 99, close: 100, volumeBase: 1, volumeUsd: 100,
  })),
};
const config = {
  model: 'range' as const,
  initialEquity: 10_000,
  riskFraction: 0.01,
  costs: { feeBpsPerSide: 4, slippageBpsPerSide: 5 },
  holdoutFraction: 0.25,
};
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it('links deterministic backtest output to the exact validated dataset', async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-run-'));
  const receipt = await saveHistoricalDataset(data, directory);
  const a = await runStoredBacktest(receipt.id, config, directory);
  const b = await runStoredBacktest(receipt.id, config, directory);
  expect(a).toEqual(b);
  expect(a.dataset).toEqual(receipt);
  expect(a.engineVersion).toBe('single-position-next-bar-v2');
  expect(a.result.config.maxGrossLeverage).toBe(1);
  expect(a.result.equityCurve).toHaveLength(91);
  expect(a.result.bars).toBe(90);
  expect(a.result.summary.count).toBe(0);
  expect(a.result.summary.expectancyR).toBeNull();
});

it('refuses oversized HTTP-style runs before expensive signal evaluation', async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-bounded-run-'));
  const bars = Array.from({ length: 3001 }, (_, i) => ({
    time: start + i * hour, closeTime: start + (i + 1) * hour - 1,
    open: 100, high: 101, low: 99, close: 100, volumeBase: 1, volumeUsd: 100,
  }));
  const receipt = await saveHistoricalDataset({
    ...data, capturedAt: start + 3002 * hour, candles: bars,
  }, directory);
  await expect(runStoredBacktest(receipt.id, config, directory, 3000))
    .rejects.toThrow('exceeds bounded backtest candle limit');
});
