import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
const request = () =>
  ({ headers: { 'x-vercel-forwarded-for': '203.0.113.5' } }) as unknown as IncomingMessage;
function response() {
  const result = { writeHead: vi.fn(), end: vi.fn() };
  return result as typeof result & ServerResponse;
}
afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('shares counters between gateway instances rather than resetting to a fresh per-instance allowance', async () => {
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-key');
  vi.stubEnv('FLUXDESK_RL_IP_MAX', '2');
  const counters = new Map<string, number>();
  const fetcher = vi.fn(async (_url, options) => {
    const ops = JSON.parse(options.body);
    const key = ops[0][1];
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    return Response.json([{ result: n }, { result: 1 }]);
  });
  vi.stubGlobal('fetch', fetcher);
  const first = await import('../api/rate-limit.ts');
  expect(await first.enforceAuthRateLimit(request(), response(), 'auth/login', '{}')).toBe(true);
  vi.resetModules();
  const second = await import('../api/rate-limit.ts');
  expect(await second.enforceAuthRateLimit(request(), response(), 'auth/login', '{}')).toBe(true);
  const denied = response();
  expect(await second.enforceAuthRateLimit(request(), denied, 'auth/login', '{}')).toBe(false);
  expect(denied.writeHead).toHaveBeenCalledWith(
    429,
    expect.objectContaining({ 'retry-after': expect.any(String) }),
  );
});
it('rejects authentication when fail-closed is selected and shared configuration is missing or its storage fails', async () => {
  vi.stubEnv('FLUXDESK_RL_FAIL_CLOSED', '1');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  const { enforceAuthRateLimit } = await import('../api/rate-limit.ts');
  expect(await enforceAuthRateLimit(request(), response(), 'auth/login', '{}')).toBe(false);
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-key');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('Storage offline')));
  expect(await enforceAuthRateLimit(request(), response(), 'auth/login', '{}')).toBe(false);
  expect(await enforceAuthRateLimit(request(), response(), 'health', undefined)).toBe(true);
});
