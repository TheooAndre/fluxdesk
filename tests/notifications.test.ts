import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn(), forget: vi.fn(), snapshot: vi.fn() }));
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.send } }));
vi.mock('../server/store.ts', () => ({ snapshot: mocks.snapshot, forgetSubscription: mocks.forget }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});
it('uses bounded concurrent push delivery and continues after expiration cleanup fails', async () => {
  vi.stubEnv('VAPID_PUBLIC_KEY', 'public');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private');
  const subscriptions = Array.from({ length: 8 }, (_, i) => ({
    endpoint: `https://push.example/${i}`,
    keys: { p256dh: 'key', auth: 'auth' },
  }));
  mocks.snapshot.mockReturnValue({ subscriptions });
  let active = 0,
    maximum = 0;
  mocks.send.mockImplementation(async (sub) => {
    active++;
    maximum = Math.max(maximum, active);
    await Promise.resolve();
    active--;
    if (sub.endpoint.endsWith('/0')) throw { statusCode: 410 };
    if (sub.endpoint.endsWith('/1')) throw Error('Timeout');
  });
  mocks.forget.mockRejectedValue(Error('Disk failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { deliver } = await import('../server/notifications.ts');
    await deliver({
      id: 'e',
      assetId: 'binance:BTCUSDT',
      kind: 'price',
      time: Date.now(),
      message: 'crossed',
    });
    expect(maximum).toBe(4);
    expect(mocks.send).toHaveBeenCalledTimes(8);
    expect(mocks.send.mock.calls.every((call) => call[2].timeout === 10_000 && call[2].TTL === 300)).toBe(
      true,
    );
    expect(mocks.forget).toHaveBeenCalledWith('https://push.example/0');
  } finally {
    log.mockRestore();
  }
});
