import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseResearchFetch, parseResearchBacktest, listResearchDatasets,
} from '../server/research/api.ts';
import { saveHistoricalDataset, type HistoricalDataset } from '../server/research/datasets.ts';

const hour = 3_600_000;
const epoch = Date.UTC(2025, 0, 1);
const valid: HistoricalDataset = {
  schemaVersion: 1, venue: 'binance', assetId: 'binance:BTCUSDT',
  interval: '1h', capturedAt: epoch + 100 * hour,
  candles: Array.from({ length: 90 }, (_, i) => ({
    time: epoch + i * hour, closeTime: epoch + (i + 1) * hour - 1,
    open: 100, high: 102, low: 99, close: 101, volumeBase: 1, volumeUsd: 100,
  })),
};
let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('research API request constraints', () => {
  it('accepts exact exchange market IDs and bounded historical windows', () => {
    expect(parseResearchFetch({ assetId: 'hyperliquid:BTC', interval: '4h', count: 500 }))
      .toEqual({ assetId: 'hyperliquid:BTC', interval: '4h', count: 500 });
  });
  it.each([
    { assetId: 'binance:BTCUSDT:extra', interval: '1h', count: 500 },
    { assetId: 'binance:BTCUSDT', interval: '1M', count: 500 },
    { assetId: 'binance:BTCUSDT', interval: '1h', count: 4000 },
    { assetId: 'binance:BTCUSDT', interval: '1h', count: 20 },
    { assetId: 'binance:BTCUSDT', interval: '1h', count: 200.5 },
    { assetId: 'binance:BTCUSDT', interval: '1h', count: '500' },
  ])('rejects invalid research history request', (input) => {
    expect(() => parseResearchFetch(input)).toThrow();
  });
  const config = {
    model: 'sfp', initialEquity: 10_000, riskFraction: 0.01,
    holdoutFraction: 0.25,
    costs: { feeBpsPerSide: 4, slippageBpsPerSide: 5 },
  };
  it('accepts a valid fixed research configuration', () => {
    const output = parseResearchBacktest({ datasetId: 'a'.repeat(64), config });
    expect(output.config).toEqual(config);
  });
  it.each([
    { datasetId: '../state.json', config },
    { datasetId: 'a'.repeat(64), config: { ...config, riskFraction: 0.1 } },
    { datasetId: 'a'.repeat(64), config: { ...config, riskFraction: '0.01' } },
    { datasetId: 'a'.repeat(64), config: { ...config, model: 'magic' } },
    { datasetId: 'a'.repeat(64), config: { ...config, costs: { feeBpsPerSide: -1, slippageBpsPerSide: 0 } } },
  ])('rejects malformed backtest configuration', (input) => {
    expect(() => parseResearchBacktest(input)).toThrow();
  });
});

describe('local research archive catalog', () => {
  it('lists verified fingerprints and excludes tampered data', async () => {
    directory = await mkdtemp(join(tmpdir(), 'fluxdesk-research-catalog-'));
    const receipt = await saveHistoricalDataset(valid, directory);
    const original = await listResearchDatasets(directory);
    expect(original.datasets).toEqual([receipt]);
    expect(original.rejected).toBe(0);

    const invalidId = 'b'.repeat(64);
    await writeFile(join(directory, invalidId + '.json'), '{}');
    const checked = await listResearchDatasets(directory);
    expect(checked.datasets).toEqual([receipt]);
    expect(checked.rejected).toBe(1);
  });
});
