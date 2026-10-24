import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { handler } from '../server/app.ts';
import { newTrade } from '../src/journal/model.ts';
let server: Server, origin: string, dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fluxdesk-journal-http-'));
  vi.stubEnv('DATA_DIR', dir);
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(dir, { force: true, recursive: true });
  vi.unstubAllEnvs();
});
const post = (path: string, data: unknown, customOrigin = origin) =>
  fetch(origin + path, {
    method: 'POST',
    headers: { origin: customOrigin, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
it('protects journal mutations, persists and rejects stale edits and invalid entries', async () => {
  const t = newTrade('2026-10-24');
  t.title = 'Journal HTTP';
  expect((await post('/api/journal/trades', t, 'https://evil.test')).status).toBe(400);
  expect((await post('/api/journal/trades', { ...t, date: 'bad' })).status).toBe(400);
  const saved = await post('/api/journal/trades', t);
  expect(saved.status).toBe(201);
  const { trade } = await saved.json();
  expect((await (await fetch(origin + '/api/journal')).json()).trades[0]).toEqual(trade);
  expect((await post('/api/journal/trades', { ...trade, revision: 0 })).status).toBe(409);
  expect((await fetch(origin + '/api/journal', { method: 'DELETE', headers: { origin } })).status).toBe(405);
});
it('supports notes, atomic deduplicated imports and revision-aware delete', async () => {
  const note = {
    date: '2026-10-24',
    revision: 0,
    plan: 'My plan',
    review: '',
    mood: 'calm',
    lessons: '',
    updatedAt: 0,
  };
  expect((await post('/api/journal/day', note)).status).toBe(200);
  const t = newTrade('2026-10-24');
  t.title = 'Trade';
  const { trade } = await (await post('/api/journal/trades', t)).json();
  const data = await (await fetch(origin + '/api/journal')).json();
  expect(await (await post('/api/journal/import', data)).json()).toEqual({ imported: 0, skipped: 2 });
  expect(
    (
      await fetch(origin + `/api/journal/trades?id=${trade.id}&revision=0`, {
        method: 'DELETE',
        headers: { origin },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await fetch(origin + `/api/journal/trades?id=${trade.id}&revision=1`, {
        method: 'DELETE',
        headers: { origin },
      })
    ).status,
  ).toBe(200);
});
