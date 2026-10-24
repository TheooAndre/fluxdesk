import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchHistoricalMarketHistory, validateMarketHistory } from '../server/research/market-history.ts';
import {
  datasetId,
  loadHistoricalDataset,
  saveHistoricalDataset,
  type HistoricalDataset,
} from '../server/research/datasets.ts';
import { enrichResearchDataset } from '../server/research/api.ts';
import { createArchive, restoreArchive } from '../server/archive.ts';
const httpFetch = globalThis.fetch;
const hour = 3600000,
  start = Date.UTC(2026, 8, 1);
const roots: string[] = [];
const fixture = (count = 80): HistoricalDataset => ({
  schemaVersion: 1,
  assetId: 'binance:BTCUSDT',
  venue: 'binance',
  interval: '1h',
  capturedAt: start + (count + 1) * hour,
  candles: Array.from({ length: count }, (_, i) => ({
    time: start + i * hour,
    closeTime: start + (i + 1) * hour - 1,
    open: 100,
    high: 103,
    low: 99,
    close: 101,
    volumeBase: 2,
    volumeUsd: 202,
  })),
});
function exchange(count = 80, alter?: (rows: unknown[], path: string) => unknown[]) {
  const payments = Array.from({ length: count }, (_, i) => ({
    symbol: 'BTCUSDT',
    fundingTime: start + i * hour,
    fundingRate: i % 2 ? '-0.0001' : '0.0002',
    markPrice: '101.5',
    rateType: 'Regular',
  }));
  if (count === 1000) payments.splice(999, 0, { ...payments[998]!, rateType: 'Special' });
  const mock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input)),
      from = Number(url.searchParams.get('startTime')),
      to = Number(url.searchParams.get('endTime')),
      limit = Number(url.searchParams.get('limit'));
    const rows = url.pathname.endsWith('fundingRate')
      ? payments.filter((p) => p.fundingTime >= from && p.fundingTime <= to).slice(0, limit)
      : Array.from({ length: limit }, (_, i) => [
          from + i * hour,
          '101',
          '104',
          '100',
          '102',
          '0',
          from + (i + 1) * hour - 1,
          '0',
        ]);
    return Response.json(alter ? alter(rows, url.pathname) : rows);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('paginates exact mark windows and funding overlap without losing same-time payment types', async () => {
  const mock = exchange(1000),
    data = fixture(1000);
  const h = await fetchHistoricalMarketHistory(data);
  expect(h.marks).toHaveLength(1000);
  expect(h.funding).toHaveLength(1001);
  expect(h.funding.filter((p) => p.time === start + 998 * hour).map((p) => p.rateType)).toEqual([
    'Regular',
    'Special',
  ]);
  expect(h.funding[1]!.rate).toBe(-0.0001);
  expect(h.fundingCoverage).toBe('observed_unverified');
  expect(h.marks[0]!.close).toBe(102);
  expect(data.candles[0]!.close).toBe(101);
  expect(mock).toHaveBeenCalledTimes(4);
  expect(() => validateMarketHistory({ ...data, marketHistory: h })).not.toThrow();
});
it('rejects missing mark bars, mismatched timestamps and malformed or missing payment histories', async () => {
  exchange(80, (rows, path) => (path.endsWith('markPriceKlines') ? rows.slice(1) : rows));
  await expect(fetchHistoricalMarketHistory(fixture())).rejects.toThrow('Incomplete');
  for (const mutation of [
    () => [],
    (rows: unknown[]) => [rows[0], ...rows],
    (rows: unknown[]) => [{ ...(rows[0] as object), symbol: 'ETHUSDT' }, ...rows.slice(1)],
    (rows: unknown[]) => [{ ...(rows[0] as object), fundingRate: '' }, ...rows.slice(1)],
    (rows: unknown[]) => [{ ...(rows[0] as object), markPrice: 'NaN' }, ...rows.slice(1)],
    (rows: unknown[]) => [{ ...(rows[0] as object), rateType: 'unknown' }, ...rows.slice(1)],
  ]) {
    exchange(80, (rows, path) => (path.endsWith('fundingRate') ? mutation(rows) : rows));
    await expect(fetchHistoricalMarketHistory(fixture())).rejects.toThrow();
  }
  exchange(80, (rows, path) =>
    path.endsWith('markPriceKlines')
      ? rows.map((r) => {
          const row = [...(r as unknown[])];
          row[0] = Number(row[0]) + 1;
          return row;
        })
      : rows,
  );
  await expect(fetchHistoricalMarketHistory(fixture())).rejects.toThrow('do not match');
});
it('refuses unsupported venues and oversized windows before making requests', async () => {
  const mock = exchange();
  await expect(
    fetchHistoricalMarketHistory({ ...fixture(), assetId: 'hyperliquid:BTC', venue: 'hyperliquid' }),
  ).rejects.toThrow('Binance only');
  await expect(fetchHistoricalMarketHistory(fixture(1001))).rejects.toThrow('limited');
  expect(mock).not.toHaveBeenCalled();
});
it('enriches into a new immutable fingerprint and restores both snapshots from an encrypted backup', async () => {
  exchange();
  const root = await mkdtemp(join(tmpdir(), 'fluxdesk-history-'));
  roots.push(root);
  const source = join(root, 'source');
  await mkdir(source);
  vi.stubEnv('DATA_DIR', source);
  await writeFile(join(source, 'state.json'), JSON.stringify({ alerts: [], events: [], subscriptions: [] }));
  const original = fixture(),
    receipt = await saveHistoricalDataset(original);
  const path = join(source, 'research', 'datasets', receipt.id + '.json');
  const before = await readFile(path, 'utf8');
  const next = await enrichResearchDataset({ datasetId: receipt.id });
  expect(next.id).not.toBe(receipt.id);
  expect(next.marketHistory?.fundingEvents).toBe(80);
  expect(await readFile(path, 'utf8')).toBe(before);
  expect((await enrichResearchDataset({ datasetId: next.id })).id).toBe(next.id);
  const file = join(root, 'backup.fdbackup'),
    target = join(root, 'restored');
  await createArchive(source, file, 'history-test-password-only');
  await restoreArchive(file, target, 'history-test-password-only');
  expect(datasetId(await loadHistoricalDataset(next.id, join(target, 'research', 'datasets')))).toBe(next.id);
  expect(datasetId(await loadHistoricalDataset(receipt.id, join(target, 'research', 'datasets')))).toBe(
    receipt.id,
  );
});
it('validates enriched history again on fingerprinting, rather than trusting imported metadata', async () => {
  exchange();
  const data = fixture();
  data.marketHistory = await fetchHistoricalMarketHistory(data);
  const id = datasetId(data);
  data.marketHistory.funding[0]!.rate += 0.0001;
  expect(datasetId(data)).not.toBe(id);
  data.marketHistory.marks[0]!.closeTime += 1;
  expect(() => datasetId(data)).toThrow('do not match');
});

it('protects the enrichment HTTP route and returns a persisted receipt on success', async () => {
  exchange();
  const root = await mkdtemp(join(tmpdir(), 'fluxdesk-history-api-'));
  roots.push(root);
  vi.stubEnv('DATA_DIR', root);
  const original = await saveHistoricalDataset(fixture());
  const { handler } = await import('../server/app.ts');
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const path = origin + '/api/research/market-history';
  try {
    expect((await httpFetch(path)).status).toBe(405);
    expect(
      (
        await httpFetch(path, {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: JSON.stringify({ datasetId: original.id }),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await httpFetch(path, {
          method: 'POST',
          headers: { origin },
          body: JSON.stringify({ datasetId: '../state' }),
        })
      ).status,
    ).toBe(400);
    const response = await httpFetch(path, {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify({ datasetId: original.id }),
    });
    expect(response.status).toBe(201);
    const { dataset } = await response.json();
    expect(dataset.marketHistory.fundingEvents).toBe(80);
    expect((await loadHistoricalDataset(dataset.id)).marketHistory?.marks).toHaveLength(80);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
