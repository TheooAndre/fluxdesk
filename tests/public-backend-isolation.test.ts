import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { AlertRule } from '../src/types.ts';

const SECRET = 'local-backend-test-secret-1234567890';
const OWNER = 'discord:111';
const FRIEND = 'x:222';
let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fluxdesk-social-isolation-'));
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('FLUXDESK_PUBLIC_MODE', 'true');
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
  vi.stubEnv('FLUXDESK_OWNER_SUB', OWNER);
  await writeFile(join(dir, 'watchlist.json'), JSON.stringify({ schemaVersion: 1, assetIds: ['binance:BTCUSDT'] }));
  const { handler } = await import('../server/app.ts');
  server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done, fail) => server.close((e) => e ? fail(e) : done()));
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const headers = (user?: string) => ({
  'x-fluxdesk-gateway-token': SECRET,
  'x-fluxdesk-public-host': 'fluxdesk-terminal.vercel.app',
  ...(user ? { 'x-fluxdesk-user-id': user } : {}),
});

it('isolates legacy owner data, friend records, alerts, and events behind verified gateway identities', async () => {
  const store = await import('../server/store.ts');
  const legacy: AlertRule = { id: '11111111-1111-4111-8111-111111111111', assetId: 'binance:BTCUSDT',
    kind: 'volume', threshold: 150, enabled: true, createdAt: 1 };
  const friend: AlertRule = { ...legacy, id: '22222222-2222-4222-8222-222222222222', ownerId: FRIEND };
  await store.addAlert(legacy);
  await store.addAlert(friend);
  const unauthorized = await fetch(base + '/api/alerts');
  expect(unauthorized.status).toBe(401);
  const anonymous = await fetch(base + '/api/alerts', { headers: headers() });
  expect(anonymous.status).toBe(401);
  const owner = await fetch(base + '/api/alerts', { headers: headers(OWNER) });
  const ownerData = await owner.json() as { alerts: AlertRule[] };
  expect(ownerData.alerts.map((a) => a.id)).toEqual([legacy.id]);
  expect(owner.headers.get('x-fluxdesk-access-mode')).toBe('social-v1');
  const friendResponse = await fetch(base + '/api/alerts', { headers: headers(FRIEND) });
  expect((await friendResponse.json() as { alerts: AlertRule[] }).alerts.map((a) => a.id)).toEqual([friend.id]);
  const ownerWatchlist = await fetch(base + '/api/watchlist', { headers: headers(OWNER) })
    .then((r) => r.json()) as { assetIds: string[] };
  const friendWatchlist = await fetch(base + '/api/watchlist', { headers: headers(FRIEND) })
    .then((r) => r.json()) as { assetIds: string[] };
  expect(ownerWatchlist.assetIds).toEqual(['binance:BTCUSDT']);
  expect(friendWatchlist.assetIds).toEqual([]);
  expect((await fetch(base + '/api/research/datasets', { headers: headers(FRIEND) })).status).toBe(403);
  expect((await fetch(base + '/api/markets', { method: 'POST', headers: headers(FRIEND) })).status).toBe(403);
  expect((await fetch(base + '/api/health', { headers: headers() })).status).toBe(200);

  const event = await store.triggered(friend, 'Friend alert');
  expect(event?.ownerId).toBe(FRIEND);
  expect(store.snapshotFor(OWNER).events).toEqual([]);
  expect(store.snapshotFor(FRIEND).events).toHaveLength(1);
  expect((await store.setAlertEnabled(legacy.id, false, FRIEND))).toBeNull();
  await store.deleteAlert(legacy.id, FRIEND);
  expect(store.snapshotFor(OWNER).alerts[0]?.enabled).toBe(true);
  expect((await store.setAlertEnabled(friend.id, true, FRIEND))?.enabled).toBe(true);
  expect((await readFile(join(dir, 'watchlist.json'), 'utf8')).includes('BTCUSDT')).toBe(true);
});
