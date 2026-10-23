import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ResearchConfig } from '../../src/engine/backtest.ts';
import type { SignalModel } from '../../src/types.ts';
import { assetIdentity } from '../market.ts';
import { datasetReceipt, loadHistoricalDataset, saveHistoricalDataset, type DatasetReceipt } from './datasets.ts';
import { fetchHistoricalDataset } from './fetch.ts';
import { runStoredBacktest, type StoredResearchReport } from './runner.ts';

const root = () => resolve(process.env.DATA_DIR ?? 'data', 'research', 'datasets');
const hashPattern = /^[a-f0-9]{64}$/;
const allowedIntervals = ['15m', '1h', '4h', '1d'] as const;
const models: SignalModel[] = ['sfp', 'msb', 'pullback', 'range'];
let busy = false;

export class ResearchRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function object(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw new ResearchRequestError('Invalid research request body');
  return input as Record<string, unknown>;
}
function numeric(input: unknown, name: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max)
    throw new ResearchRequestError('Invalid ' + name);
  return input;
}
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new ResearchRequestError('Research job already running', 409);
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

export type ResearchFetchRequest = { assetId: string; interval: '15m' | '1h' | '4h' | '1d'; count: number };
export function parseResearchFetch(input: unknown): ResearchFetchRequest {
  const value = object(input);
  if (typeof value.assetId !== 'string') throw new ResearchRequestError('Invalid asset identifier');
  try { assetIdentity(value.assetId); }
  catch { throw new ResearchRequestError('Invalid asset identifier'); }
  if (!allowedIntervals.includes(value.interval as ResearchFetchRequest['interval']))
    throw new ResearchRequestError('Unsupported research interval');
  const count = numeric(value.count, 'candle count', 80, 1000);
  if (!Number.isSafeInteger(count)) throw new ResearchRequestError('Invalid candle count');
  return { assetId: value.assetId, interval: value.interval as ResearchFetchRequest['interval'], count };
}
export function parseResearchBacktest(input: unknown): { datasetId: string; config: ResearchConfig } {
  const value = object(input);
  if (typeof value.datasetId !== 'string' || !hashPattern.test(value.datasetId))
    throw new ResearchRequestError('Invalid dataset ID');
  const c = object(value.config);
  if (!models.includes(c.model as SignalModel))
    throw new ResearchRequestError('Unsupported research strategy');
  const costs = object(c.costs);
  return {
    datasetId: value.datasetId,
    config: {
      model: c.model as SignalModel,
      initialEquity: numeric(c.initialEquity, 'initial equity', 1, 10_000_000),
      riskFraction: numeric(c.riskFraction, 'risk fraction', 0.00001, 0.05),
      holdoutFraction: numeric(c.holdoutFraction, 'holdout fraction', 0.1, 0.5),
      maxGrossLeverage: c.maxGrossLeverage === undefined ? 1 : numeric(c.maxGrossLeverage, 'gross exposure cap', 0.1, 3),
      costs: {
        feeBpsPerSide: numeric(costs.feeBpsPerSide, 'fee rate', 0, 100),
        slippageBpsPerSide: numeric(costs.slippageBpsPerSide, 'slippage', 0, 100),
      },
    },
  };
}

/** The local personal research archive is capped and never scanned recursively. */
export async function listResearchDatasets(directory = root()): Promise<{ datasets: DatasetReceipt[]; rejected: number }> {
  let entries: string[];
  try { entries = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { datasets: [], rejected: 0 };
    throw error;
  }
  const ids = entries.filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  if (ids.length > 100) throw new ResearchRequestError('Research archive limit exceeded', 409);
  const datasets: DatasetReceipt[] = [];
  let rejected = 0;
  for (const name of ids) {
    try {
      const dataset = await loadHistoricalDataset(name.slice(0, -5), directory);
      datasets.push(datasetReceipt(dataset));
    } catch {
      rejected++;
    }
  }
  datasets.sort((a, b) => b.capturedAt - a.capturedAt);
  return { datasets, rejected };
}

export async function fetchAndSaveResearchDataset(input: unknown): Promise<DatasetReceipt> {
  const args = parseResearchFetch(input);
  return exclusive(async () => {
    const current = await listResearchDatasets();
    if (current.datasets.length + current.rejected >= 100)
      throw new ResearchRequestError('Research archive is full (100 datasets)', 409);
    // Bounded to 1000 bars and 2 network pages, without fallback to stale data.
    const dataset = await fetchHistoricalDataset(args.assetId, args.interval, args.count);
    return saveHistoricalDataset(dataset);
  });
}

export async function executeResearchBacktest(input: unknown): Promise<StoredResearchReport> {
  const args = parseResearchBacktest(input);
  // The CLI can replay deeper archives, but HTTP must never block the API
  // event loop with unbounded quadratic signal-history evaluation.
  return exclusive(async () => runStoredBacktest(args.datasetId, args.config, undefined, 3_000));
}
