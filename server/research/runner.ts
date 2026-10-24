import type { ResearchConfig, ResearchResult } from '../../src/engine/backtest.ts';
import { backtest } from '../../src/engine/backtest.ts';
import { datasetReceipt, loadHistoricalDataset, type DatasetReceipt } from './datasets.ts';

export type StoredResearchReport = {
  schemaVersion: 1;
  engineVersion: 'single-position-next-bar-v1' | 'single-position-next-bar-v2' | 'observed-funding-mark-v3';
  dataset: DatasetReceipt;
  result: ResearchResult;
};

/** Replays an immutable, validated dataset. No network or exchange orders. */
export async function runStoredBacktest(
  datasetId: string,
  config: ResearchConfig,
  directory?: string,
  maxBars = 50_000,
): Promise<StoredResearchReport> {
  const dataset = await loadHistoricalDataset(datasetId, directory);
  if (dataset.candles.length > maxBars) throw Error('Research dataset exceeds bounded backtest candle limit');
  return {
    schemaVersion: 1,
    engineVersion: config.historicalAccounting ? 'observed-funding-mark-v3' : 'single-position-next-bar-v2',
    dataset: datasetReceipt(dataset),
    result: backtest(dataset.candles, config, undefined, dataset.marketHistory),
  };
}
