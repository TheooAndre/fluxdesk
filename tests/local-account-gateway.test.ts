import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import gateway from '../api/gateway.ts';
import { ACCOUNT_COOKIE, verifyOwnerSetup } from '../server/account-policy.ts';

const HOST = 'fluxdesk-terminal.vercel.app';
const SETUP = 'fluxdesk-account-setup.vercel.app';
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});
async function start() {
  vi.stubEnv('FLUXDESK_ACCOUNT_AUTH', 'true');
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', 'test-only-account-gateway-key-123456789');
  vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://backend.example.com/');
  vi.stubEnv('FLUXDESK_PUBLIC_HOST', HOST);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_URL', SETUP);
  const server = createServer((req, res) => {
    void gateway(req, res);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}
function call(port: number, path: string, headers: Record<string, string> = {}, body?: object) {
  return new Promise<{ status: number; body: string; cookies: string[] }>((done, fail) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body ? 'POST' : 'GET',
        headers: {
          host: HOST,
          ...(body ? { origin: `https://${headers.host ?? HOST}`, 'content-type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          done({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            cookies: res.headers['set-cookie'] ?? [],
          }),
        );
      },
    );
    req.on('error', fail);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
function backend(body: object, upgraded = true) {
  return Response.json(body, { headers: upgraded ? { 'x-fluxdesk-access-mode': 'accounts-v1' } : {} });
}

it('allows only account-cookie identity, strips unrelated cookies and validates the backend access version', async () => {
  const port = await start();
  const fetcher = vi.fn<(url: unknown, options?: RequestInit) => Promise<Response>>(async () => backend({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  expect((await call(port, '/api/health?_vercel_share=test-only-access-token')).status).toBe(200);
  expect(String(fetcher.mock.calls[0]![0])).not.toContain('test-only-access-token');
  expect((await call(port, '/api/journal', { 'x-fluxdesk-user-id': 'account:forged' })).status).toBe(401);
  expect(
    (
      await call(port, '/api/journal', {
        cookie: `${ACCOUNT_COOKIE}=session; __vercel_share=private-token`,
        'x-fluxdesk-user-id': 'discord:111',
        'x-fluxdesk-owner-setup': 'forged',
      })
    ).status,
  ).toBe(200);
  const options = fetcher.mock.calls.at(-1)![1] as RequestInit;
  expect(options.headers).toMatchObject({ cookie: `${ACCOUNT_COOKIE}=session` });
  expect(options.headers).not.toHaveProperty('x-fluxdesk-user-id');
  expect(options.headers).not.toHaveProperty('x-fluxdesk-owner-setup');
  fetcher.mockImplementationOnce(async () => backend({ journal: 'must not leak' }, false));
  const mismatch = await call(port, '/api/auth/session');
  expect(mismatch.status).toBe(503);
  expect(mismatch.body).not.toContain('must not leak');
});

it('confines owner bootstrap to the protected generated production host and never trusts browser proof headers', async () => {
  const port = await start();
  const fetcher = vi.fn<(url: unknown, options?: RequestInit) => Promise<Response>>(async () => backend({ success: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await call(port, '/api/auth/register-owner', { 'x-fluxdesk-owner-setup': 'forged' }, { name: 'fake' }))
      .status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await call(port, '/api/auth/session', { host: SETUP })).status).toBe(200);
  const headers = fetcher.mock.calls[0]![1]!.headers as Record<string, string>;
  expect(verifyOwnerSetup(headers['x-fluxdesk-owner-setup'], SETUP, '/api/auth/session', 'GET')).toBe(true);
  expect(verifyOwnerSetup(headers['x-fluxdesk-owner-setup'], HOST, '/api/auth/register-owner', 'POST')).toBe(
    false,
  );
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect((await call(port, '/api/auth/session', { host: SETUP })).status).toBe(403);
});

it('forwards only secure host-only account cookies and blocks cross-origin account mutations', async () => {
  const port = await start();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const response = backend({ success: true });
      response.headers.append(
        'set-cookie',
        `${ACCOUNT_COOKIE}=valid; Path=/; Secure; HttpOnly; SameSite=Lax`,
      );
      response.headers.append('set-cookie', 'unrelated=private; Path=/; Secure; HttpOnly');
      return response;
    }),
  );
  const login = await call(
    port,
    '/api/auth/login',
    {},
    { email: 'test@example.test', password: 'fake-test-only-password' },
  );
  expect(login.status).toBe(200);
  expect(login.cookies).toHaveLength(1);
  expect(login.cookies[0]).toContain(ACCOUNT_COOKIE);
  expect(
    (await call(port, '/api/auth/login', { origin: 'https://other.example' }, { email: 'test@example.test' }))
      .status,
  ).toBe(403);
  expect((await call(port, '/api/auth/unknown')).status).toBe(404);
});
