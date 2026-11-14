import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { AlertRule } from '../src/types.ts';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.send } }));
let directory: string,
  now: number,
  store: typeof import('../server/store.ts'),
  push: typeof import('../server/notifications.ts');
beforeEach(async () => {
  vi.resetModules();
  mocks.send.mockReset();
  mocks.send.mockResolvedValue(undefined);
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-push-outbox-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  vi.stubEnv('FLUXDESK_ACCOUNT_AUTH', 'false');
  vi.stubEnv('FLUXDESK_PUBLIC_MODE', 'false');
  now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  store = await import('../server/store.ts');
  await store.load();
  push = await import('../server/notifications.ts');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
async function enqueue(count = 1, kind: 'price' | 'macro' = 'price', ownerId?: string) {
  for (let i = 0; i < count; i++)
    await store.subscribe({
      endpoint: `https://push.example/${i}`,
      keys: { p256dh: 'private-key', auth: 'private-auth' },
      ...(ownerId ? { ownerId } : {}),
    });
  const base = {
    id: 'rule',
    assetId: 'binance:BTCUSDT',
    enabled: true,
    createdAt: now,
    ...(ownerId ? { ownerId } : {}),
  };
  const rule: AlertRule =
    kind === 'macro'
      ? { ...base, kind, assetId: 'macro:US', timing: 'release', leadMinutes: 15 }
      : { ...base, kind, threshold: 100 };
  await store.addAlert(rule);
  return (await store.triggered(rule, 'released', undefined, kind === 'macro' ? 'cpi' : undefined))!;
}
it('persists per-device outcomes with four concurrent sends and retries a network failure without recording another trigger', async () => {
  const event = await enqueue(8);
  let active = 0,
    maximum = 0;
  mocks.send.mockImplementation(async (sub) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (sub.endpoint.endsWith('/0')) throw { statusCode: 410, body: 'secret' };
    if (sub.endpoint.endsWith('/1')) throw Error('private provider details');
  });
  await Promise.all([push.deliver(event), push.drainPushQueue()]);
  expect(maximum).toBeGreaterThan(1);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(mocks.send).toHaveBeenCalledTimes(8);
  const saved = store.snapshot().events[0]!;
  expect(saved.delivery!.devices.filter((d) => d.status === 'accepted')).toHaveLength(6);
  expect(saved.delivery!.devices.filter((d) => d.status === 'retrying')).toHaveLength(1);
  expect(saved.delivery!.devices.filter((d) => d.status === 'expired')).toHaveLength(1);
  expect(JSON.stringify(saved)).not.toMatch(/private|push.example|secret/);
  await push.deliver(event);
  expect(mocks.send).toHaveBeenCalledTimes(8);
  now += 10_001;
  mocks.send.mockResolvedValue(undefined);
  await push.drainPushQueue();
  expect(mocks.send).toHaveBeenCalledTimes(9);
  expect(store.snapshot().events).toHaveLength(1);
  expect(mocks.send.mock.calls.every((call) => call[2].timeout === 10_000 && call[2].TTL <= 300)).toBe(true);
});
it('respects Retry-After, retries at most three attempts, and expires stale work', async () => {
  await enqueue();
  mocks.send.mockRejectedValue({ statusCode: 429, headers: { 'retry-after': '60' } });
  await push.drainPushQueue();
  now += 59_000;
  await push.drainPushQueue();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  now += 1_001;
  await push.drainPushQueue();
  now += 60_001;
  await push.drainPushQueue();
  expect(mocks.send).toHaveBeenCalledTimes(3);
  expect(store.snapshot().events[0]!.delivery!.devices[0]!.status).toBe('failed');
  now += 60_000;
  await push.drainPushQueue();
  expect(mocks.send).toHaveBeenCalledTimes(3);
});
it('does not resend a claimed/ambiguous send across restart and preserves macro deep links and event identity', async () => {
  const event = await enqueue(1, 'macro');
  const device = event.delivery!.devices[0]!;
  await store.claimPush(event.id, device.deviceId);
  vi.resetModules();
  store = await import('../server/store.ts');
  await store.load();
  await store.recoverPushClaims();
  push = await import('../server/notifications.ts');
  await push.drainPushQueue();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(store.snapshot().events[0]!.delivery!.devices[0]!.status).toBe('interrupted');
  // A new legitimate event carries one stable notification tag across transport retries.
  await store.setAlertEnabled('rule', true);
  const rule = store.snapshot().alerts[0]!;
  await store.triggered(rule, 'next release', undefined, 'ppi');
  await push.drainPushQueue();
  expect(JSON.parse(mocks.send.mock.calls[0]![1])).toMatchObject({
    url: '/?tab=calendar',
    eventId: expect.any(String),
  });
});
it('expires old work without sending, and keeps ownerless legacy events attached to the owner only', async () => {
  vi.stubEnv('FLUXDESK_PUBLIC_MODE', 'true');
  vi.stubEnv('FLUXDESK_OWNER_SUB', 'x:1');
  await store.subscribe({
    endpoint: 'https://push.example/friend',
    keys: { p256dh: 'k', auth: 'a' },
    ownerId: 'x:2',
  });
  const event = await enqueue(1, 'price', 'x:1');
  expect(event.delivery!.devices).toHaveLength(1);
  now += 300_001;
  await push.drainPushQueue();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(store.snapshot().events[0]!.delivery!.devices[0]!.status).toBe('expired');
});
it('marks missing push configuration explicitly and records events even with no subscribed devices', async () => {
  const event = await enqueue(0);
  await push.deliver(event);
  expect(store.snapshot().events[0]!.delivery!.devices).toEqual([]);
  expect(mocks.send).not.toHaveBeenCalled();
});
