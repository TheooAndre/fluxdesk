import type { ResearchConfig, ResearchResult } from '../../src/engine/backtest.ts';
import { backtest } from '../../src/engine/backtest.ts';
import {
  datasetReceipt, loadHistoricalDataset, type DatasetReceipt,
} from './datasets.ts';

export type StoredResearchReport = {
  schemaVersion: 1;
  engineVersion: 'single-position-next-bar-v1';
  dataset: DatasetReceipt;
  result: ResearchResult;
};

/** Replays an immutable, validated dataset. No network or exchange orders. */
export async function runStoredBacktest(
  datasetId: string,
  config: ResearchConfig,
  directory?: string,
): Promise<StoredResearchReport> {
  const dataset = await loadHistoricalDataset(datasetId, directory);
  return {
    schemaVersion: 1,
    engineVersion: 'single-position-next-bar-v1',
    dataset: datasetReceipt(dataset),
    result: backtest(dataset.candles, config),
  };
}
