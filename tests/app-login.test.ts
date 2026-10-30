import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import gateway from '../api/gateway.ts';
import { signedIn } from '../server/app-login.ts';
const PASSWORD = 'test-only-long-owner-password-12345';
const servers: Server[] = [];
beforeEach(() => {
  vi.stubEnv('VITE_FLUXDESK_APP_LOGIN', 'true');
  vi.stubEnv('FLUXDESK_APP_PASSWORD', PASSWORD);
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', 'backend-test-secret-12345678901234567890');
  vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private.example.com');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ok: true })),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});
async function setup() {
  const server = createServer((req, res) => {
    void gateway(req, res);
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;
  const call = (
    path: string,
    method = 'GET',
    body?: unknown,
    cookie?: string,
    origin = `https://127.0.0.1:${port}`,
  ) =>
    new Promise<{ status: number; body: string; cookie: string }>((done, fail) => {
      const data = body === undefined ? '' : JSON.stringify(body);
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            origin,
            ...(cookie ? { cookie } : {}),
            ...(data
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
              : {}),
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += String(chunk);
          });
          res.on('end', () =>
            done({ status: res.statusCode!, body: text, cookie: res.headers['set-cookie']?.[0] ?? '' }),
          );
        },
      );
      req.on('error', fail);
      req.end(data);
    });
  return { call, port };
}
it('protects private reads, mutations, health, and rewrite paths without forwarding upstream', async () => {
  const { call } = await setup();
  for (const path of ['/api/health', '/api/journal/trades', '/api/gateway?__fd_route=journal/trades']) {
    expect((await call(path)).status).toBe(401);
    expect((await call(path, 'POST', {})).status).toBe(401);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('issues host-only secure cookies and forwards only authenticated requests without owner credentials', async () => {
  const { call } = await setup();
  const login = await call('/api/auth/login', 'POST', { password: PASSWORD });
  expect(login.status).toBe(200);
  for (const attribute of ['__Host-fluxdesk-session=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'])
    expect(login.cookie).toContain(attribute);
  expect(login.cookie).not.toContain('Domain=');
  expect(login.cookie).not.toContain(PASSWORD);
  const cookie = login.cookie.split(';')[0]!;
  expect(JSON.parse((await call('/api/auth/session', 'GET', undefined, cookie)).body).authenticated).toBe(
    true,
  );
  expect((await call('/api/health', 'GET', undefined, cookie)).status).toBe(200);
  const headers = vi.mocked(fetch).mock.calls[0]?.[1]?.headers;
  expect(JSON.stringify(headers)).not.toContain(PASSWORD);
  expect(JSON.stringify(headers)).not.toContain(cookie);
});
it('rejects wrong passwords and cross-origin sign-in/logout without leaking secrets', async () => {
  const { call } = await setup();
  const wrong = await call('/api/auth/login', 'POST', { password: 'wrong' });
  expect(wrong.status).toBe(401);
  expect(wrong.body).not.toContain(PASSWORD);
  for (const path of ['/api/auth/login', '/api/auth/logout'])
    expect(
      (await call(path, 'POST', { password: PASSWORD }, undefined, 'https://attacker.example')).status,
    ).toBe(403);
  expect((await call('/api/auth/login')).status).toBe(405);
});
it('rejects modified, expired, future and cross-host sessions, duplicate cookies and password rotation', async () => {
  const { call, port } = await setup();
  const login = await call('/api/auth/login', 'POST', { password: PASSWORD });
  const cookie = login.cookie.split(';')[0]!;
  const req = { headers: { host: `127.0.0.1:${port}`, cookie } } as Parameters<typeof signedIn>[0];
  expect(signedIn(req)).toBe(true);
  expect(signedIn(req, Date.now() + 9 * 3600_000)).toBe(false);
  expect(signedIn(req, Date.now() - 3600_000)).toBe(false);
  expect(signedIn({ headers: { ...req.headers, host: 'other.example' } } as typeof req)).toBe(false);
  expect((await call('/api/health', 'GET', undefined, cookie + 'x')).status).toBe(401);
  expect((await call('/api/health', 'GET', undefined, `${cookie}; ${cookie}`)).status).toBe(401);
  vi.stubEnv('FLUXDESK_APP_PASSWORD', PASSWORD + 'rotated');
  expect(signedIn(req)).toBe(false);
});
it('fails closed with missing/short owner password, and logout clears the browser cookie', async () => {
  const { call } = await setup();
  const logout = await call('/api/auth/logout', 'POST');
  expect(logout.cookie).toContain('Max-Age=0');
  for (const password of ['', 'short']) {
    vi.stubEnv('FLUXDESK_APP_PASSWORD', password);
    expect((await call('/api/auth/session')).status).toBe(503);
    expect((await call('/api/health')).status).toBe(401);
    expect((await call('/api/auth/login', 'POST', { password: PASSWORD })).status).toBe(503);
  }
});
it('bounds malformed and oversized password input', async () => {
  const { call } = await setup();
  for (const body of [{}, { password: 123 }, { password: 'x'.repeat(300) }])
    expect((await call('/api/auth/login', 'POST', body)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it('rate-limits repeated login attempts before password derivation', async () => {
  const { call } = await setup();
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++)
    statuses.push((await call('/api/auth/login', 'POST', { password: 'bad' })).status);
  expect(statuses).toContain(429);
});
