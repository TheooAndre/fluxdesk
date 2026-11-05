import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import gateway from '../api/gateway.ts';

const HOST = 'fluxdesk-terminal.vercel.app';
const BACKEND_SECRET = 'local-gateway-test-secret-1234567890';
const SESSION_SECRET = 'local-session-test-secret-1234567890';
const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((done, fail) => server.close((e) => e ? fail(e) : done()))));
});

async function start() {
  const server = createServer((req, res) => { void gateway(req, res); });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

function call(port: number, path: string, options: {
  method?: string; cookie?: string; origin?: string; host?: string; userId?: string; body?: string;
} = {}) {
  return new Promise<{ status: number; body: string; location?: string; cookies: string[] }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: {
      host: options.host ?? HOST,
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.userId ? { 'x-fluxdesk-user-id': options.userId } : {}),
      ...(options.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(options.body) } : {}),
    } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString(), location: res.headers.location,
        cookies: res.headers['set-cookie'] ?? [] }));
    });
    req.on('error', fail);
    req.end(options.body);
  });
}

function configure() {
  vi.stubEnv('FLUXDESK_PUBLIC_MODE', 'true');
  vi.stubEnv('FLUXDESK_PUBLIC_HOST', HOST);
  vi.stubEnv('FLUXDESK_SESSION_SECRET', SESSION_SECRET);
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', BACKEND_SECRET);
  vi.stubEnv('FLUXDESK_BACKEND_URL', 'https://private-api.example.com/');
  vi.stubEnv('FLUXDESK_OWNER_SUB', 'discord:111');
  vi.stubEnv('FLUXDESK_DISCORD_CLIENT_ID', 'discord-client');
  vi.stubEnv('FLUXDESK_DISCORD_CLIENT_SECRET', 'discord-secret');
  vi.stubEnv('FLUXDESK_X_CLIENT_ID', 'x-client');
  vi.stubEnv('FLUXDESK_X_CLIENT_SECRET', 'x-secret');
}

function backendResponse(data: object, upgraded = true) {
  return Response.json(data, { headers: upgraded ? { 'x-fluxdesk-access-mode': 'social-v1' } : {} });
}

describe('public market and private account gateway', () => {
  it('allows only public GETs and rejects a backend that has not enabled social isolation', async () => {
    configure();
    const mock = vi.fn(async () => backendResponse({ ok: true }));
    vi.stubGlobal('fetch', mock);
    const port = await start();
    expect((await call(port, '/api/health')).status).toBe(200);
    expect((await call(port, '/api/calendar')).status).toBe(200);
    expect((await call(port, '/api/journal')).status).toBe(401);
    expect((await call(port, '/api/alerts')).status).toBe(401);
    expect((await call(port, '/api/watchlist')).status).toBe(401);
    expect((await call(port, '/api/research/datasets')).status).toBe(401);
    expect((await call(port, '/api/calendar', { method: 'POST', origin: `https://${HOST}` })).status).toBe(405);
    expect(mock).toHaveBeenCalledTimes(2);
    mock.mockImplementationOnce(async () => backendResponse({ journal: 'private' }, false));
    expect((await call(port, '/api/health')).status).toBe(503);
  });

  it.each(['discord', 'x'] as const)('validates %s OAuth state and keeps provider tokens at Vercel', async (provider) => {
    configure();
    const mock = vi.fn(async (url: URL | string) => {
      const path = String(url);
      if (path.includes('/oauth2/token')) return Response.json({ access_token: 'provider-only-token', token_type: 'Bearer' });
      if (path.includes('/users/@me')) return Response.json({ id: '111', username: 'owner' });
      if (path.includes('/users/me')) return Response.json({ data: { id: '111', username: 'owner' } });
      return backendResponse({ ok: true });
    });
    vi.stubGlobal('fetch', mock);
    const port = await start();
    const begin = await call(port, `/api/auth/${provider}`);
    expect(begin.status).toBe(302);
    const destination = new URL(begin.location!);
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256');
    expect(destination.searchParams.get('redirect_uri')).toBe(`https://${HOST}/api/auth/callback/${provider}`);
    expect(destination.searchParams.get('scope')).toBe(provider === 'discord' ? 'identify' : 'users.read');
    const attempt = begin.cookies.find((x) => x.startsWith('__Host-fd-oauth='))!.split(';')[0]!;
    const invalid = await call(port, `/api/auth/callback/${provider}?state=wrong&code=code&iss=https%3A%2F%2Fdiscord.com`, { cookie: attempt });
    expect(invalid.location).toBe('/?auth=failed');
    expect(mock).not.toHaveBeenCalled();
    const state = destination.searchParams.get('state')!;
    const valid = await call(port, `/api/auth/callback/${provider}?state=${state}&code=code${provider === 'discord' ? '&iss=https%3A%2F%2Fdiscord.com' : ''}`, { cookie: attempt });
    expect(valid.status).toBe(303);
    expect(valid.location).toBe('/');
    const sessionCookie = valid.cookies.find((x) => x.startsWith('__Host-fd-session='))!;
    expect(sessionCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    const session = sessionCookie.split(';')[0]!;
    const info = await call(port, '/api/auth/session', { cookie: session });
    expect(JSON.parse(info.body)).toMatchObject({ authenticated: true, provider, owner: provider === 'discord' });
    const journal = await call(port, '/api/journal', { cookie: session, userId: 'discord:999' });
    expect(journal.status).toBe(200);
    const [, forwarded] = mock.mock.calls.at(-1)! as unknown as [URL, RequestInit];
    expect(forwarded.headers).toMatchObject({ 'x-fluxdesk-user-id': `${provider}:111`,
      'x-fluxdesk-gateway-token': BACKEND_SECRET });
    expect(JSON.stringify(forwarded)).not.toContain('provider-only-token');
    expect(JSON.stringify(forwarded)).not.toContain(session);
    expect((await call(port, '/api/research/datasets', { cookie: session })).status)
      .toBe(provider === 'discord' ? 200 : 403);
    expect((await call(port, '/api/auth/logout', { method: 'POST', cookie: session,
      origin: 'https://other.example' })).status).toBe(403);
    const logout = await call(port, '/api/auth/logout', { method: 'POST', cookie: session,
      origin: `https://${HOST}` });
    expect(logout.status).toBe(200);
    expect(logout.cookies[0]).toContain('Max-Age=0');
    expect((await call(port, '/api/journal')).status).toBe(401);
    expect((await call(port, '/api/journal', { cookie: session, host: 'other.example' })).status).toBe(401);
  });

  it('serves session diagnostics without an upstream, but fails closed on private API requests', async () => {
    configure();
    vi.stubEnv('FLUXDESK_BACKEND_URL', '');
    const port = await start();
    expect((await call(port, '/api/auth/session')).status).toBe(200);
    expect((await call(port, '/api/journal')).status).toBe(503);
  });
});
