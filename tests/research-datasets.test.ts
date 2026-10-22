import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  datasetId, datasetReceipt, loadHistoricalDataset,
  saveHistoricalDataset, validateHistoricalDataset,
  type HistoricalDataset,
} from '../server/research/datasets.ts';
import { nextCandleStart } from '../src/engine/intervals.ts';
import type { Candle } from '../src/types.ts';

const hour = 3_600_000;
const start = Date.UTC(2025, 5, 1);
const fixture = (): HistoricalDataset => ({
  schemaVersion: 1,
  assetId: 'binance:BTCUSDT',
  venue: 'binance',
  interval: '1h',
  capturedAt: start + 91 * hour,
  candles: Array.from({ length: 90 }, (_, i): Candle => ({
    time: start + i * hour,
    closeTime: start + (i + 1) * hour - 1,
    open: 100, high: 102, low: 98, close: 101,
    volumeBase: 4, volumeUsd: 400,
  })),
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('historical dataset ingestion', () => {
  it('creates a stable content digest and reports exact closed timestamps', () => {
    const data = fixture();
    expect(datasetId(data)).toBe(datasetId(structuredClone(data)));
    expect(datasetReceipt(data)).toMatchObject({
      assetId: 'binance:BTCUSDT',
      venue: 'binance', interval: '1h', bars: 90,
      firstOpenTime: data.candles[0]!.time,
      lastCloseTime: data.candles.at(-1)!.closeTime,
    });
  });

  it('rejects gaps, duplicated timestamps, unfinished bars, and invalid OHLC', () => {
    const scenarios: Array<(x: HistoricalDataset) => void> = [
      (x) => { x.candles.splice(30, 1); },
      (x) => { x.candles[31] = { ...x.candles[30]! }; },
      (x) => { x.capturedAt = x.candles.at(-1)!.closeTime!; },
      (x) => { x.candles[14]!.volumeUsd = -1; },
      (x) => { x.candles[14]!.low = 103; },
      (x) => { x.candles[14]!.closeTime! -= 1_000; },
    ];
    for (const mutate of scenarios) {
      const x = fixture();
      mutate(x);
      expect(() => validateHistoricalDataset(x)).toThrow();
    }
  });

  it('rejects venue mismatches and unsupported intervals', () => {
    const wrongVenue = fixture();
    wrongVenue.venue = 'hyperliquid';
    expect(() => datasetId(wrongVenue)).toThrow('venue');
    const wrongInterval = fixture();
    wrongInterval.interval = '6h';
    wrongInterval.venue = 'hyperliquid';
    wrongInterval.assetId = 'hyperliquid:BTC';
    expect(() => datasetId(wrongInterval)).toThrow('Unsupported');
  });

  it('supports UTC calendar months and rejects incorrectly anchored Binance months', () => {
    const dataset = fixture();
    dataset.interval = '1M';
    let timestamp = Date.UTC(2017, 0, 1);
    dataset.candles = Array.from({ length: 80 }, (): Candle => {
      const next = nextCandleStart(timestamp, '1M');
      const candle = {
        time: timestamp, closeTime: next - 1,
        open: 100, high: 101, low: 99, close: 100,
        volumeBase: 1, volumeUsd: 100,
      };
      timestamp = next;
      return candle;
    });
    dataset.capturedAt = timestamp + 60_000;
    expect(() => validateHistoricalDataset(dataset)).not.toThrow();
    dataset.candles[0]!.time += 60_000;
    expect(() => validateHistoricalDataset(dataset)).toThrow();
  });

  it('atomically saves snapshots and verifies checksums before loading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fluxdesk-research-'));
    directories.push(dir);
    const data = fixture();
    const receipt = await saveHistoricalDataset(data, dir);
    expect(await loadHistoricalDataset(receipt.id, dir)).toEqual(data);
    expect(await saveHistoricalDataset(data, dir)).toEqual(receipt);
    const file = join(dir, receipt.id + '.json');
    const edited = JSON.parse(await readFile(file, 'utf8')) as HistoricalDataset;
    edited.candles[0]!.close = 100.5;
    await writeFile(file, JSON.stringify(edited));
    await expect(loadHistoricalDataset(receipt.id, dir)).rejects.toThrow('checksum mismatch');
    await expect(loadHistoricalDataset('../state', dir)).rejects.toThrow('Invalid dataset ID');
  });
});
