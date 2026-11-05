import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ownerSetupProof, ACCOUNT_COOKIE } from '../server/account-policy.ts';
import { accountDatabase, closeAccountDatabase } from '../server/account-db.ts';
import { investmentFixture } from './fixtures/investments.ts';

const SECRET = 'test-only-accounts-gateway-123456789012345';
const HOST = 'fluxdesk-terminal.vercel.app';
const SETUP = 'fluxdesk-test-owner.vercel.app';
const PASSWORD = 'Test-only account passphrase 2026!';
let server: Server, base: string, directory: string;
let ownerCookie = '',
  friendCookie = '',
  recoveryCode = '';

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-accounts-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('FLUXDESK_GATEWAY_TOKEN', SECRET);
  vi.stubEnv('FLUXDESK_ACCOUNT_AUTH', 'true');
  await writeFile(
    join(directory, 'watchlist.json'),
    JSON.stringify({ schemaVersion: 1, assetIds: ['binance:BTCUSDT'] }),
  );
  const { handler } = await import('../server/app.ts');
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  closeAccountDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function call(
  path: string,
  data?: object,
  cookie = '',
  setup = false,
  extra: Record<string, string> = {},
) {
  const method = data ? 'POST' : 'GET',
    host = setup ? SETUP : HOST;
  const response = await fetch(base + '/api/' + path, {
    method,
    headers: {
      'x-fluxdesk-gateway-token': SECRET,
      'x-fluxdesk-public-host': host,
      'x-fluxdesk-client-ip': '192.0.2.1',
      'content-type': 'application/json',
      ...(data ? { origin: `https://${host}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(setup ? { 'x-fluxdesk-owner-setup': ownerSetupProof(host, '/api/' + path, method) } : {}),
      ...extra,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  return {
    response,
    body: (await response.json()) as Record<string, unknown>,
    cookie:
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith(ACCOUNT_COOKIE + '='))
        ?.split(';')[0] ?? '',
  };
}

it('requires protected owner setup; ordinary registration or identity spoofing cannot claim legacy data', async () => {
  const status = await call('auth/session');
  expect(status.body).toMatchObject({
    authenticated: false,
    ownerSetupAllowed: false,
    registrationOpen: false,
  });
  expect((await call('auth/session', undefined, '', true)).body.ownerSetupAllowed).toBe(true);
  expect(
    (
      await call('auth/register-owner', {
        name: 'Attacker',
        email: 'attacker@example.test',
        password: PASSWORD,
      })
    ).response.status,
  ).toBe(403);
  expect(
    (
      await call('auth/register', {
        name: 'Friend',
        email: 'friend@example.test',
        password: PASSWORD,
        owner: true,
      })
    ).response.status,
  ).toBe(503);
  expect(
    (await call('watchlist', undefined, '', false, { 'x-fluxdesk-user-id': 'discord:111' })).response.status,
  ).toBe(401);
});

it('registers the reserved owner with hashed credentials and maps only that account to existing records', async () => {
  const result = await call(
    'auth/register-owner',
    { name: 'Owner', email: 'owner@example.test', password: PASSWORD },
    '',
    true,
  );
  expect(result.response.status).toBe(200);
  ownerCookie = result.cookie;
  recoveryCode = result.body.recoveryCode as string;
  expect(ownerCookie).toContain(ACCOUNT_COOKIE + '=');
  expect(result.response.headers.get('set-cookie')).toContain('HttpOnly');
  expect(result.response.headers.get('set-cookie')).toContain('Secure');
  expect(result.body).not.toHaveProperty('token');
  expect(recoveryCode).toHaveLength(32);
  const session = await call('auth/session', undefined, ownerCookie);
  expect(session.body).toMatchObject({ authenticated: true, owner: true, registrationOpen: true });
  expect((await call('watchlist', undefined, ownerCookie)).body.assetIds).toEqual(['binance:BTCUSDT']);
  expect(
    (
      await call(
        'auth/register-owner',
        { name: 'Other', email: 'other@example.test', password: PASSWORD },
        '',
        true,
      )
    ).response.status,
  ).toBe(403);
  const password = accountDatabase()
    .db.prepare("SELECT password FROM account WHERE providerId='credential'")
    .get() as { password: string };
  expect(password.password).not.toBe(PASSWORD);
  expect(password.password.length).toBeGreaterThan(64);
  const raw = await readFile(join(directory, 'accounts.sqlite'));
  expect(raw.includes(Buffer.from(PASSWORD))).toBe(false);
  expect(raw.includes(Buffer.from(recoveryCode))).toBe(false);
});

it('isolates a friend account, protects owner-only tools and revokes sessions on logout', async () => {
  const registered = await call('auth/register', {
    name: 'Owner',
    email: 'friend@example.test',
    password: PASSWORD,
    owner: true,
  });
  expect(registered.response.status).toBe(200);
  friendCookie = registered.cookie;
  expect((await call('auth/session', undefined, friendCookie)).body).toMatchObject({
    authenticated: true,
    owner: false,
  });
  expect((await call('watchlist', undefined, friendCookie)).body.assetIds).toEqual([]);
  expect((await call('research/datasets', undefined, friendCookie)).response.status).toBe(403);
  expect((await call('investments')).response.status).toBe(401);
  expect((await call('investments', undefined, friendCookie)).response.status).toBe(403);
  expect((await call('investments', investmentFixture(), friendCookie)).response.status).toBe(403);
  expect((await call('investments', undefined, '', false, { 'x-fluxdesk-user-id': `account:${accountDatabase().owner}` })).response.status).toBe(401);
  const investments = await call('investments', investmentFixture(), ownerCookie);
  expect(investments.response.status).toBe(200);
  expect(investments.body.revision).toBe(1);
  expect((await call('investments', undefined, ownerCookie)).body).toMatchObject({ portfolios: [{ name: 'Synthetic infrastructure thesis' }] });
  expect((await call('investments', investmentFixture(), ownerCookie)).response.status).toBe(409);
  expect((await call('watchlist', { assetId: 'binance:ETHUSDT' }, friendCookie)).response.status).toBe(200);
  expect((await call('watchlist', undefined, ownerCookie)).body.assetIds).toEqual(['binance:BTCUSDT']);
  expect(
    (await call('auth/login', { email: 'friend@example.test', password: 'incorrect-password' })).response
      .status,
  ).toBe(401);
  expect((await call('auth/logout', {}, friendCookie)).response.status).toBe(200);
  expect((await call('watchlist', undefined, friendCookie)).response.status).toBe(401);
  const login = await call('auth/login', { email: 'friend@example.test', password: PASSWORD });
  expect(login.response.status).toBe(200);
  expect((await call('watchlist', undefined, login.cookie)).body.assetIds).toEqual(['binance:ETHUSDT']);
});

it('recovers only with the saved code, rotates it once and revokes all earlier sessions', async () => {
  const changedPassword = 'Replacement test passphrase 2026!';
  const invalid = await call('auth/recover', {
    email: 'owner@example.test',
    recoveryCode: 'a'.repeat(32),
    newPassword: changedPassword,
  });
  expect(invalid.response.status).toBe(400);
  const changed = await call('auth/recover', {
    email: 'owner@example.test',
    recoveryCode,
    newPassword: changedPassword,
  });
  expect(changed.response.status).toBe(200);
  expect(changed.body.recoveryCode).toHaveLength(32);
  expect(changed.body.recoveryCode).not.toBe(recoveryCode);
  expect((await call('watchlist', undefined, ownerCookie)).response.status).toBe(401);
  expect(
    (await call('auth/recover', { email: 'owner@example.test', recoveryCode, newPassword: PASSWORD }))
      .response.status,
  ).toBe(400);
  const login = await call('auth/login', { email: 'owner@example.test', password: changedPassword });
  expect(login.response.status).toBe(200);
  expect((await call('auth/session', undefined, login.cookie)).body.owner).toBe(true);
});

it('rejects cross-origin mutations and limits repeated credential attempts', async () => {
  expect(
    (
      await call('auth/login', { email: 'friend@example.test', password: PASSWORD }, '', false, {
        origin: 'https://other.example',
      })
    ).response.status,
  ).toBe(400);
  const statuses = [];
  for (let i = 0; i < 10; i++)
    statuses.push(
      (
        await call('auth/login', { email: 'absent@example.test', password: PASSWORD }, '', false, {
          'x-fluxdesk-client-ip': '192.0.2.2',
        })
      ).response.status,
    );
  expect(statuses).toContain(429);
});

it('backs up and restores account credentials and ownership without restoring old sessions', async () => {
  const { createArchive, verifyArchive, restoreArchive } = await import('../server/archive.ts');
  const { initializeAccounts } = await import('../server/accounts.ts');
  const owner = accountDatabase().owner;
  const output = join(directory, 'accounts.fdbackup'),
    target = join(directory, 'restored');
  const created = await createArchive(directory, output, 'test-only encrypted backup password');
  expect(created.filePaths).toContain('accounts.sqlite');
  expect(created.filePaths).toContain('investments.json');
  await verifyArchive(output, 'test-only encrypted backup password');
  await restoreArchive(output, target, 'test-only encrypted backup password');
  closeAccountDatabase();
  vi.stubEnv('DATA_DIR', target);
  await initializeAccounts();
  expect(accountDatabase().owner).toBe(owner);
  expect((accountDatabase().db.prepare('SELECT count(*) AS n FROM session').get() as { n: number }).n).toBe(
    0,
  );
  expect((await call('watchlist', undefined, ownerCookie)).response.status).toBe(401);
  const login = await call('auth/login', { email: 'friend@example.test', password: PASSWORD }, '', false, {
    'x-fluxdesk-client-ip': '192.0.2.3',
  });
  expect(login.response.status).toBe(200);
  expect((await call('watchlist', undefined, login.cookie)).body.assetIds).toEqual(['binance:ETHUSDT']);
  expect(await readFile(join(target, 'watchlist.json'), 'utf8')).toContain('BTCUSDT');
});
