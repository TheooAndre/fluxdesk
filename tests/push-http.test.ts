import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
const saved = vi.hoisted(() => ({
  endpoints: ['https://push.example/device-one', 'https://push.example/device-two'],
}));
vi.mock('../server/store.ts', () => ({
  snapshot: () => ({ alerts: [], events: [], subscriptions: [] }),
  addAlert: vi.fn(),
  deleteAlert: vi.fn(),
  subscribe: vi.fn(),
  forgetSubscription: vi.fn(async (endpoint: string) => {
    if (endpoint === 'https://push.example/failure') throw Error('Disk write failed');
    saved.endpoints = saved.endpoints.filter((value) => value !== endpoint);
  }),
}));
import { handler } from '../server/app.ts';
let server: Server, origin: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const remove = (endpoint: unknown, otherOrigin = origin) =>
  fetch(origin + '/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin: otherOrigin },
    body: JSON.stringify({ endpoint }),
  });
it('removes only the requested device, is idempotent and does not require VAPID', async () => {
  expect((await remove('https://push.example/device-one')).status).toBe(200);
  expect(saved.endpoints).toEqual(['https://push.example/device-two']);
  expect((await remove('https://push.example/device-one')).status).toBe(200);
});
it('rejects cross-origin and malformed unsubscribe requests', async () => {
  expect((await remove('https://push.example/device-two', 'https://other.example')).status).toBe(400);
  expect((await remove('not-a-push-endpoint')).status).toBe(400);
  expect((await remove(null)).status).toBe(400);
  expect(saved.endpoints).toContain('https://push.example/device-two');
});
it('does not report disabled when persistence fails', async () => {
  expect((await remove('https://push.example/failure')).ok).toBe(false);
});
