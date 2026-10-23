import { afterEach, expect, it, vi } from 'vitest';
import { monitorPwaUpdates } from '../src/lib/pwa-updates.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(1800000000000);
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const nav = { onLine: true };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', nav);
  const update = vi.fn().mockResolvedValue(undefined),
    error = vi.fn();
  const monitor = monitorPwaUpdates({ update } as unknown as ServiceWorkerRegistration, error);
  return { win, doc, nav, update, error, monitor };
}
it('checks on return, limits duplicate focus events, checks periodically and cleans up', async () => {
  const { win, update, monitor } = setup();
  win.dispatchEvent(new Event('focus'));
  await Promise.resolve();
  expect(update).toHaveBeenCalledTimes(1);
  win.dispatchEvent(new Event('focus'));
  expect(update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(300000);
  expect(update).toHaveBeenCalledTimes(2);
  monitor.stop();
  await vi.advanceTimersByTimeAsync(300000);
  win.dispatchEvent(new Event('online'));
  expect(update).toHaveBeenCalledTimes(2);
});
it('skips background/offline checks, permits manual retry and reports failures', async () => {
  const { doc, nav, update, error, monitor } = setup();
  nav.onLine = false;
  await monitor.check(true);
  expect(update).not.toHaveBeenCalled();
  nav.onLine = true;
  doc.visibilityState = 'hidden';
  await monitor.check(true);
  expect(update).not.toHaveBeenCalled();
  doc.visibilityState = 'visible';
  update.mockRejectedValueOnce(Error('Offline'));
  await monitor.check(true);
  expect(error).toHaveBeenCalledTimes(1);
  await monitor.check(true);
  expect(update).toHaveBeenCalledTimes(2);
  monitor.stop();
});
it('coalesces an in-flight update and suppresses callbacks after disposal', async () => {
  const { update, error, monitor } = setup();
  let reject!: (error: Error) => void;
  update.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const checking = monitor.check(true);
  await monitor.check(true);
  expect(update).toHaveBeenCalledTimes(1);
  monitor.stop();
  reject(Error('Network'));
  await checking;
  expect(error).not.toHaveBeenCalled();
});
