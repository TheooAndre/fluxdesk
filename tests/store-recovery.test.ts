import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AlertRule } from '../src/types.ts';
let directory = '';
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-store-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.resetModules();
  const store = await import('../server/store.ts');
  await store.load();
  return store;
}
const rule = (id: string): AlertRule => ({
  id,
  assetId: 'binance:BTCUSDT',
  kind: 'price',
  threshold: 100,
  direction: 'above',
  enabled: true,
  createdAt: 1,
});
it('does not publish failed writes or poison later alert and subscription updates', async () => {
  const store = await fixture();
  await mkdir(join(directory, 'state.json')); // Atomic rename cannot replace a directory.
  await expect(store.addAlert(rule('failed'))).rejects.toThrow();
  expect(store.snapshot().alerts).toEqual([]);
  expect(await readdir(directory)).toEqual(['state.json']);
  await rm(join(directory, 'state.json'), { recursive: true });
  await store.addAlert(rule('saved'));
  await store.subscribe({ endpoint: 'https://push.example/1', keys: { p256dh: 'old', auth: 'old' } });
  await store.subscribe({ endpoint: 'https://push.example/1', keys: { p256dh: 'renewed', auth: 'new' } });
  const before = store.snapshot();
  expect(before.alerts.map((x) => x.id)).toEqual(['saved']);
  expect(before.subscriptions).toHaveLength(1);
  expect(before.subscriptions[0]!.keys.p256dh).toBe('renewed');
  expect(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))).toEqual(before);
  vi.resetModules();
  const restarted = await import('../server/store.ts');
  await restarted.load();
  expect(restarted.snapshot()).toEqual(before);
});
it('serializes cooldown checks and does not consume cooldown after a failed event write', async () => {
  const store = await fixture();
  const alert = rule('one');
  await store.addAlert(alert);
  await rm(join(directory, 'state.json'));
  await mkdir(join(directory, 'state.json'));
  await expect(store.triggered(alert, 'crossed')).rejects.toThrow();
  expect(store.snapshot().events).toEqual([]);
  expect(store.snapshot().alerts[0]!.lastTriggeredAt).toBeUndefined();
  await rm(join(directory, 'state.json'), { recursive: true });
  const results = await Promise.all(Array.from({ length: 6 }, () => store.triggered(alert, 'crossed')));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(store.snapshot().events).toHaveLength(1);
  await store.deleteAlert(alert.id);
  expect(await store.triggered(alert, 'deleted')).toBeNull();
});
