import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/lib/api.ts';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it('bounds mutations, aborts stalled transport and warns that save completion is uncertain without retrying', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const result = expect(api.deleteJournalTrade('one', 2)).rejects.toThrow('server may have saved it');
  await vi.advanceTimersByTimeAsync(20_000);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].signal!.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it('keeps server errors and handles non-JSON auth failures and empty success responses', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ error: 'Trade changed on another device' }, { status: 409 }))
    .mockResolvedValueOnce(new Response('<html>Sign in</html>', { status: 401 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(api.deleteJournalTrade('id', 2)).rejects.toThrow('Trade changed on another device');
  await expect(api.cancelStatArb()).rejects.toThrow('HTTP 401');
  await expect(api.deleteAlert('id')).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('preserves external cancellation and clears the deadline on successful reads', async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options: RequestInit) => {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return Response.json({ assets: [] });
    }),
  );
  controller.abort();
  await expect(api.markets(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(vi.getTimerCount()).toBe(0);
  await api.markets();
  expect(vi.getTimerCount()).toBe(0);
});
