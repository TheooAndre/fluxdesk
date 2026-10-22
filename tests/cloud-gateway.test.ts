import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticateGateway, assertGatewaySecret, assertRemoteBindingAllowed } from '../server/gateway.ts';
import { handler } from '../server/app.ts';

const SECRET = 'this-is-a-local-test-secret-very-long-12345';
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((done, fail) => server.close((e) => e ? fail(e) : done()))));
});

describe('gateway credential and public binding security', () => {
  it('rejects weak secrets and forbids unprotected public binding', () => {
    expect(() => assertGatewaySecret('short')).toThrow('at least 32 bytes');
    expect(() => assertRemoteBindingAllowed('0.0.0.0', {})).toThrow('Remote access requires');
    expect(() => assertRemoteBindingAllowed('0.0.0.0', { FLUXDESK_GATEWAY_TOKEN: 'tiny' }))
      .toThrow('at least 32');
    expect(() => assertRemoteBindingAllowed('0.0.0.0', { FLUXDESK_GATEWAY_TOKEN: SECRET }))
      .not.toThrow();
    expect(() => assertRemoteBindingAllowed('127.0.0.1', {})).not.toThrow();
    expect(() => assertRemoteBindingAllowed('0.0.0.0', { REVERSE_PROXY_OIDC: 'true' })).not.toThrow();
  });
  it('never trusts the forwarded host without the exact secret', () => {
    const req = { headers: {
      host: 'private-api.example', 'x-fluxdesk-public-host': 'fluxdesk.vercel.app',
      'x-fluxdesk-gateway-token': 'incorrect',
    } };
    expect(() => authenticateGateway(req as never, SECRET)).toThrow('Gateway authentication required');
    req.headers['x-fluxdesk-gateway-token'] = SECRET;
    expect(authenticateGateway(req as never, SECRET)).toEqual({
      originHost: 'fluxdesk.vercel.app', gatewayProtected: true,
    });
    req.headers['x-fluxdesk-public-host'] = 'bad hostname/other';
    expect(() => authenticateGateway(req as never, SECRET)).toThrow('Invalid gateway host');
  });
  it('requires authentication for ALL API and static routes when gateway mode is configured', async () => {
    vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
    const server = createServer((req, res) => { void handler(req, res); });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    expect((await fetch(base + '/api/health')).status).toBe(401);
    expect((await fetch(base + '/')).status).toBe(401);
    const trustedHeaders = {
      'x-fluxdesk-gateway-token': SECRET,
      'x-fluxdesk-public-host': 'dashboard.vercel.app',
    };
    expect((await fetch(base + '/api/health', { headers: trustedHeaders })).status).toBe(200);

    const payload = JSON.stringify({
      assetId: 'binance:BTCUSDT', interval: '1h', count: 20,
    });
    const post = (origin?: string) => fetch(base + '/api/research/datasets', {
      method: 'POST', body: payload,
      headers: {
        ...trustedHeaders,
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
    });
    const same = await post('https://dashboard.vercel.app');
    expect(same.status).toBe(400);
    expect((await same.json() as {error: string}).error).toBe('Invalid candle count');
    const cross = await post('https://attacker.example');
    expect((await cross.json() as {error: string}).error).toBe('Cross-origin mutation blocked');
    const absent = await post();
    expect((await absent.json() as {error: string}).error).toBe('Cross-origin mutation blocked');
    const insecure = await post('http://dashboard.vercel.app');
    expect((await insecure.json() as {error: string}).error).toBe('Cross-origin mutation blocked');
  });
});
