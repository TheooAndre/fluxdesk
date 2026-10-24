import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

vi.mock('../server/research/fetch.ts', () => ({
  fetchHistoricalDataset: async (assetId: string, interval: string, count: number) => {
    if (assetId !== 'binance:BTCUSDT' || interval !== '1h') throw Error('Unexpected research fixture');
    const start = Date.UTC(2025, 0, 1);
    const hour = 3_600_000;
    return {
      schemaVersion: 1,
      assetId,
      venue: 'binance',
      interval,
      capturedAt: start + (count + 5) * hour,
      candles: Array.from({ length: count }, (_, i) => ({
        time: start + i * hour,
        closeTime: start + (i + 1) * hour - 1,
        open: 100, high: 101, low: 99, close: 100,
        volumeBase: 1, volumeUsd: 100,
      })),
    };
  },
}));

import { handler } from '../server/app.ts';
let server: Server;
let origin: string;
let directory: string;
let oldDir: string | undefined;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-research-http-'));
  oldDir = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()));
  if (oldDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = oldDir;
  await rm(directory, { recursive: true, force: true });
});

it('fetches, archives and executes a versioned research report through the HTTP API', async () => {
  const fetchResponse = await fetch(origin + '/api/research/datasets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetId: 'binance:BTCUSDT', interval: '1h', count: 90 }),
  });
  expect(fetchResponse.status).toBe(201);
  const created = (await fetchResponse.json()) as { dataset: { id: string; bars: number } };
  expect(created.dataset.id).toMatch(/^[a-f0-9]{64}$/);
  expect(created.dataset.bars).toBe(90);

  const listResponse = await fetch(origin + '/api/research/datasets');
  expect(listResponse.status).toBe(200);
  const archived = (await listResponse.json()) as { datasets: Array<{ id: string }>; rejected: number };
  expect(archived.datasets.map((entry) => entry.id)).toEqual([created.dataset.id]);
  expect(archived.rejected).toBe(0);

  const runResponse = await fetch(origin + '/api/research/backtests', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      datasetId: created.dataset.id,
      config: {
        model: 'sfp', initialEquity: 10_000, riskFraction: 0.01,
        holdoutFraction: 0.25,
        costs: { feeBpsPerSide: 4, slippageBpsPerSide: 5 },
      },
    }),
  });
  expect(runResponse.status).toBe(200);
  const report = (await runResponse.json()) as {
    schemaVersion: number; engineVersion: string; dataset: { id: string };
    result: { bars: number; trades: unknown[]; summary: { expectancyR: number | null } };
  };
  expect(report.engineVersion).toBe('single-position-next-bar-v2');
  expect(report.dataset.id).toBe(created.dataset.id);
  expect(report.result.bars).toBe(90);
  expect(report.result.trades).toEqual([]);
  expect(report.result.summary.expectancyR).toBeNull();
  expect(runResponse.headers.get('cache-control')).toBe('no-store');
});
