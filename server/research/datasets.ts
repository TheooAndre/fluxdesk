import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Candle, Venue } from '../../src/types.ts';
import { assertInterval, nextCandleStart, type CandleInterval } from '../../src/engine/intervals.ts';
import { assetIdentity } from '../market.ts';

/**
 * An immutable, time-bounded research snapshot. Every bar was closed before
 * capturedAt. A digest protects against accidental data mutation between runs.
 * The digest does not prove that an exchange produced the underlying prices.
 */
export type HistoricalDataset = {
  schemaVersion: 1;
  assetId: string;
  venue: Venue;
  interval: CandleInterval;
  capturedAt: number;
  candles: Candle[];
};
export type DatasetReceipt = {
  id: string;
  assetId: string;
  venue: Venue;
  interval: CandleInterval;
  capturedAt: number;
  firstOpenTime: number;
  lastCloseTime: number;
  bars: number;
};

const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const nonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const DIGEST = /^[a-f0-9]{64}$/;
const root = () => resolve(process.env.DATA_DIR ?? 'data', 'research', 'datasets');

export function validateHistoricalDataset(dataset: HistoricalDataset): void {
  if (!dataset || dataset.schemaVersion !== 1) throw Error('Unsupported dataset schema');
  const identity = assetIdentity(dataset.assetId);
  if (identity.venue !== dataset.venue) throw Error('Dataset venue does not match asset ID');
  assertInterval(dataset.venue, dataset.interval);
  if (!integer(dataset.capturedAt) || dataset.capturedAt <= 0)
    throw Error('Invalid dataset capture time');
  if (!Array.isArray(dataset.candles) || dataset.candles.length < 80 || dataset.candles.length > 50_000)
    throw Error('Dataset requires 80 to 50000 completed candles');

  let previousClose: number | null = null;
  for (const bar of dataset.candles) {
    if (
      !integer(bar.time) || !integer(bar.closeTime) ||
      !positive(bar.open) || !positive(bar.high) || !positive(bar.low) ||
      !positive(bar.close) || !nonnegative(bar.volumeBase) || !nonnegative(bar.volumeUsd) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.high < bar.low ||
      bar.closeTime < bar.time
    ) throw Error('Invalid dataset candle');
    if (previousClose !== null && bar.time !== previousClose + 1)
      throw Error('Dataset contains a gap, overlap or duplicate candle');
    if (dataset.venue === 'hyperliquid' && dataset.interval === '1M') {
      const duration = bar.closeTime - bar.time + 1;
      if (duration < 28 * 86_400_000 || duration > 31 * 86_400_000)
        throw Error('Invalid exchange-defined monthly candle');
    } else {
      // These exchanges report inclusive millisecond closes for normal bars.
      if (bar.closeTime !== nextCandleStart(bar.time, dataset.interval) - 1)
        throw Error('Candle duration does not match interval');
      if (dataset.interval === '1M' && new Date(bar.time).toISOString().slice(8) !== '01T00:00:00.000Z')
        throw Error('Binance month must begin on UTC month boundary');
    }
    if (dataset.capturedAt <= bar.closeTime)
      throw Error('Dataset contains candle not closed at capture time');
    previousClose = bar.closeTime;
  }
}

export function datasetId(dataset: HistoricalDataset): string {
  validateHistoricalDataset(dataset);
  return createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
}
export function datasetReceipt(dataset: HistoricalDataset): DatasetReceipt {
  return {
    id: datasetId(dataset),
    assetId: dataset.assetId,
    venue: dataset.venue,
    interval: dataset.interval,
    capturedAt: dataset.capturedAt,
    firstOpenTime: dataset.candles[0]!.time,
    lastCloseTime: dataset.candles.at(-1)!.closeTime!,
    bars: dataset.candles.length,
  };
}

export async function saveHistoricalDataset(
  dataset: HistoricalDataset,
  directory = root(),
): Promise<DatasetReceipt> {
  const receipt = datasetReceipt(dataset);
  const dir = resolve(directory);
  const path = join(dir, receipt.id + '.json');
  await mkdir(dir, { recursive: true });
  // Atomic publication: an interrupted write never becomes a usable dataset.
  const temporary = join(dir, '.' + randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(dataset), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
  return receipt;
}

export async function loadHistoricalDataset(
  id: string,
  directory = root(),
): Promise<HistoricalDataset> {
  if (!DIGEST.test(id)) throw Error('Invalid dataset ID');
  const data: unknown = JSON.parse(await readFile(join(resolve(directory), id + '.json'), 'utf8'));
  const dataset = data as HistoricalDataset;
  if (datasetId(dataset) !== id) throw Error('Dataset checksum mismatch');
  return dataset;
}
