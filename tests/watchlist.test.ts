import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let directory = '';
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-watchlist-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.resetModules();
  return import('../server/watchlist.ts');
}
it('serializes concurrent changes, deduplicates IDs and persists across a module restart', async () => {
  const store = await fixture();
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => store.changeWatchlist('binance:COIN' + i + 'USDT', true)),
  );
  await store.changeWatchlist('binance:COIN1USDT', true);
  expect((await store.savedWatchlist()).assetIds).toHaveLength(20);
  await store.changeWatchlist('binance:COIN1USDT', false);
  await store.changeWatchlist('hyperliquid:BTC', true);
  const before = await store.savedWatchlist();
  const saved = JSON.parse(await readFile(join(directory, 'watchlist.json'), 'utf8'));
  expect(saved).toEqual({ schemaVersion: 1, ...before });
  expect(await readdir(directory)).toEqual(['watchlist.json']);
  vi.resetModules();
  expect(await (await import('../server/watchlist.ts')).savedWatchlist()).toEqual(before);
});
it('bounds the watchlist and returns defensive copies', async () => {
  const store = await fixture();
  for (let i = 0; i < 50; i++) await store.changeWatchlist('hyperliquid:COIN' + i, true);
  await expect(store.changeWatchlist('binance:BTCUSDT', true)).rejects.toThrow('50 markets');
  const snapshot = await store.savedWatchlist();
  snapshot.assetIds.pop();
  expect((await store.savedWatchlist()).assetIds).toHaveLength(50);
  await store.changeWatchlist('hyperliquid:COIN0', false);
  await store.changeWatchlist('binance:BTCUSDT', true);
  expect((await store.savedWatchlist()).assetIds).toHaveLength(50);
});
it('never publishes a failed disk write and recovers on the next change', async () => {
  const store = await fixture();
  await store.savedWatchlist();
  await rm(directory, { recursive: true });
  await writeFile(directory, 'not a directory');
  await expect(store.changeWatchlist('binance:BTCUSDT', true)).rejects.toThrow();
  expect(await store.savedWatchlist()).toEqual({ assetIds: [] });
  await rm(directory);
  await store.changeWatchlist('hyperliquid:BTC', true);
  expect(await store.savedWatchlist()).toEqual({ assetIds: ['hyperliquid:BTC'] });
});
it('rejects malformed saved content without overwriting it', async () => {
  const store = await fixture();
  const corrupted = '{"schemaVersion":1,"assetIds":["../state.json"]}';
  await writeFile(join(directory, 'watchlist.json'), corrupted);
  await expect(store.savedWatchlist()).rejects.toThrow();
  await expect(store.changeWatchlist('binance:BTCUSDT', true)).rejects.toThrow();
  expect(await readFile(join(directory, 'watchlist.json'), 'utf8')).toBe(corrupted);
});
it('rejects invalid identifiers before saving anything', async () => {
  const store = await fixture();
  for (const id of ['binance:BTCUSDT:extra', '../private', 'spot:BTCUSDT'])
    expect(() => store.changeWatchlist(id, true)).toThrow();
  expect(await readdir(directory)).toEqual([]);
});
