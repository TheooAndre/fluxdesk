import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { accountDatabase, ownerRegistered } from './account-db.ts';
import {
  accountCookie,
  accountHost,
  accountSecret,
  ACCOUNT_COOKIE,
  verifyOwnerSetup,
} from './account-policy.ts';

type Attempt = { ownerSetup?: boolean; recoveryUser?: string; resetToken?: string };
const attempt = new AsyncLocalStorage<Attempt>();
const recoveryHash = (code: string) => createHash('sha256').update(`fd-recovery-v1:${code}`).digest('hex');
let instance: {
  path: string;
  db: ReturnType<typeof accountDatabase>['db'];
  auth: ReturnType<typeof createAuth>;
  ready: Promise<void>;
} | null = null;
let passwordWork = 0;

function createAuth() {
  const { db, owner } = accountDatabase();
  return betterAuth({
    appName: 'FluxDesk',
    baseURL: `https://${accountHost()}`,
    basePath: '/api/account-auth',
    secret: accountSecret(),
    database: db,
    logger: { disabled: true },
    telemetry: { enabled: false },
    trustedOrigins: (request) => {
      const setup = request?.headers.get('x-fluxdesk-auth-origin');
      return [`https://${accountHost()}`, ...(setup ? [`https://${setup}`] : [])];
    },
    account: { accountLinking: { enabled: false } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        const current = attempt.getStore();
        // Reset tokens never leave the server. A saved recovery code is the proof;
        // this is not an unverified-email-based account recovery channel.
        if (!current || current.recoveryUser !== user.id) throw Error('Recovery proof required');
        current.resetToken = token;
      },
    },
    session: { expiresIn: 7 * 86_400, updateAge: 86_400, cookieCache: { enabled: false } },
    advanced: {
      // The explicit cookie already has the stronger __Host- prefix. Suppress
      // only Better Auth's automatic __Secure- name prefix; Secure is forced below.
      useSecureCookies: false,
      cookiePrefix: 'fd',
      cookies: { session_token: { name: ACCOUNT_COOKIE } },
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 30,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 3600, max: 10 },
        '/change-password': { window: 3600, max: 8 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (attempt.getStore()?.ownerSetup) return { data: { ...user, id: owner } };
            if (!ownerRegistered()) return false;
            const count = db.prepare('SELECT count(*) AS n FROM user').get() as { n: number };
            return count.n < 100 ? { data: user } : false;
          },
        },
      },
    },
  });
}

export async function initializeAccounts() {
  const { path, db } = accountDatabase();
  if (!instance || instance.path !== path || instance.db !== db) {
    const auth = createAuth();
    const ready = (async () => {
      const migration = await getMigrations(auth.options);
      await migration.runMigrations();
      db.exec(`CREATE TABLE IF NOT EXISTS fd_recovery (
        userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
        hash TEXT, createdAt INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS fd_attempts (
        key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);`);
      await auth.$context;
    })();
    instance = { path, db, auth, ready };
  }
  await instance.ready;
  return instance.auth;
}

export async function accountSession(req: IncomingMessage) {
  const auth = await initializeAccounts();
  const cookie = accountCookie(req.headers.cookie);
  if (!cookie) return null;
  return auth.api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true, disableRefresh: true },
  });
}

function json(res: ServerResponse, status: number, body: object) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function limit(key: string, maximum: number, window: number): boolean {
  const { db } = accountDatabase(),
    now = Date.now();
  db.prepare('DELETE FROM fd_attempts WHERE until < ?').run(now);
  const digest = createHash('sha256').update(key).digest('hex');
  const count = db.prepare('SELECT count(*) AS n FROM fd_attempts').get() as { n: number };
  if (count.n >= 5000 && !db.prepare('SELECT key FROM fd_attempts WHERE key=?').get(digest)) return false;
  const row = db
    .prepare(
      `INSERT INTO fd_attempts (key,count,until) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`,
    )
    .get(digest, now + window) as { count: number };
  return row.count <= maximum;
}

function freshRecoveryCode(userId: string): string {
  const code = randomBytes(24).toString('base64url');
  accountDatabase()
    .db.prepare(
      `INSERT INTO fd_recovery (userId, hash, createdAt) VALUES (?,?,?)
    ON CONFLICT(userId) DO UPDATE SET hash=excluded.hash,createdAt=excluded.createdAt`,
    )
    .run(userId, recoveryHash(code), Date.now());
  return code;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += String(chunk);
    if (Buffer.byteLength(raw) > 16_384) throw Error('Invalid account request');
  }
  const data: unknown = JSON.parse(raw || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Invalid account request');
  return data as Record<string, unknown>;
}

const paths: Record<string, string> = {
  'auth/register': '/sign-up/email',
  'auth/register-owner': '/sign-up/email',
  'auth/login': '/sign-in/email',
  'auth/logout': '/sign-out',
  'auth/change-password': '/change-password',
};

export async function handleAccounts(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  host: string,
): Promise<boolean> {
  if (!path.startsWith('/api/auth/')) return false;
  const route = path.slice(5),
    method = req.method ?? 'GET';
  const setup = verifyOwnerSetup(req.headers['x-fluxdesk-owner-setup'], host, path, method);
  if (host !== accountHost() && !setup) {
    json(res, 403, { error: 'Use the main FluxDesk app to sign in' });
    return true;
  }
  const auth = await initializeAccounts();
  if (route === 'auth/session' && method === 'GET') {
    const session = await accountSession(req);
    json(res, 200, {
      authenticated: !!session,
      accountId: session ? `account:${session.user.id}` : null,
      provider: session ? 'password' : null,
      name: session?.user.name ?? null,
      owner: session?.user.id === accountDatabase().owner,
      providers: { discord: false, x: false, password: true },
      registrationOpen: ownerRegistered(),
      ownerSetupAllowed: setup && !ownerRegistered(),
      recoveryAvailable: true,
    });
    return true;
  }
  if (method !== 'POST' || (!paths[route] && route !== 'auth/recover')) {
    json(res, method === 'POST' || method === 'GET' ? 404 : 405, { error: 'Unknown account endpoint' });
    return true;
  }
  if (req.headers.origin !== `https://${host}`) {
    json(res, 403, { error: 'Cross-origin account request blocked' });
    return true;
  }
  if (route === 'auth/register-owner' && (!setup || ownerRegistered())) {
    json(res, 403, { error: 'Owner setup is only available on the protected production setup page' });
    return true;
  }
  if (route === 'auth/register' && !ownerRegistered()) {
    json(res, 503, { error: 'Registration opens when the owner finishes account setup' });
    return true;
  }
  const ip = req.headers['x-fluxdesk-client-ip'];
  const client = typeof ip === 'string' && isIP(ip) ? ip : 'unknown';
  if (!limit(`ip:${client}`, 30, 60_000)) {
    res.setHeader('retry-after', '60');
    json(res, 429, { error: 'Too many account requests. Try again shortly.' });
    return true;
  }
  const needsPassword = route !== 'auth/logout';
  if (needsPassword && passwordWork >= 1) {
    res.setHeader('retry-after', '3');
    json(res, 429, { error: 'Sign-in is busy. Try again in a few seconds.' });
    return true;
  }
  if (needsPassword) passwordWork++;
  try {
    const raw = await readBody(req);
    const data = Object.fromEntries(
      Object.entries(raw).filter(([key]) =>
        ['email', 'name', 'password', 'currentPassword', 'newPassword', 'recoveryCode'].includes(key),
      ),
    );
    if (typeof data.name === 'string' && (!data.name.trim() || data.name.length > 80))
      throw Error('Invalid account name');
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (
      needsPassword &&
      !limit(`identity:${email || accountCookie(req.headers.cookie) || client}`, 10, 60_000)
    ) {
      json(res, 429, { error: 'Too many account attempts. Try again shortly.' });
      return true;
    }
    const headers = new Headers({
      origin: `https://${host}`,
      'content-type': 'application/json',
      'x-forwarded-for': client,
    });
    const cookie = accountCookie(req.headers.cookie);
    if (cookie) headers.set('cookie', cookie);
    if (setup) headers.set('x-fluxdesk-auth-origin', host);
    if (route === 'auth/recover') {
      await recover(auth, res, email, data, headers);
      return true;
    }
    const changed = route === 'auth/change-password';
    const previous = changed ? await accountSession(req) : null;
    const response = await attempt.run({ ownerSetup: route === 'auth/register-owner' }, () =>
      auth.handler(
        new Request(`https://${accountHost()}/api/account-auth${paths[route]}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...data,
            ...(email ? { email } : {}),
            ...(changed ? { revokeOtherSessions: true } : {}),
          }),
        }),
      ),
    );
    if (!response.ok) {
      json(res, response.status >= 500 ? 503 : response.status, {
        error:
          response.status === 429
            ? 'Too many account attempts. Try again shortly.'
            : 'Account request failed. Check your details or use account recovery.',
      });
      return true;
    }
    const result = (await response.json()) as { user?: { id: string } };
    const userId = result.user?.id ?? previous?.user.id;
    const recoveryCode =
      userId && (route.startsWith('auth/register') || changed) ? freshRecoveryCode(userId) : undefined;
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader('set-cookie', cookies);
    json(res, 200, { success: true, ...(recoveryCode ? { recoveryCode } : {}) });
  } catch {
    json(res, 400, { error: 'Account request could not be completed. Check your details and try again.' });
  } finally {
    if (needsPassword) passwordWork--;
  }
  return true;
}

async function recover(
  auth: Awaited<ReturnType<typeof initializeAccounts>>,
  res: ServerResponse,
  email: string,
  data: Record<string, unknown>,
  headers: Headers,
) {
  const code = typeof data.recoveryCode === 'string' ? data.recoveryCode.trim() : '';
  const password = typeof data.newPassword === 'string' ? data.newPassword : '';
  if (
    !limit(`recovery:${email}`, 5, 3600_000) ||
    code.length !== 32 ||
    password.length < 12 ||
    password.length > 128
  ) {
    json(res, 400, { error: 'Recovery failed. Check your email, recovery code and new password.' });
    return;
  }
  const { db } = accountDatabase();
  const row = db
    .prepare(`SELECT u.id,r.hash FROM user u JOIN fd_recovery r ON r.userId=u.id WHERE u.email=?`)
    .get(email) as { id: string; hash: string | null } | undefined;
  const actual = Buffer.from(recoveryHash(code)),
    expected = Buffer.from(row?.hash ?? '0'.repeat(64));
  const valid = timingSafeEqual(actual, expected);
  if (
    !row ||
    !valid ||
    !db.prepare('UPDATE fd_recovery SET hash=NULL WHERE userId=? AND hash=?').run(row.id, row.hash).changes
  ) {
    json(res, 400, { error: 'Recovery failed. Check your email, recovery code and new password.' });
    return;
  }
  let reset = false;
  try {
    const context: Attempt = { recoveryUser: row.id };
    await attempt.run(context, async () => {
      await auth.api.requestPasswordReset({ body: { email }, headers });
      if (!context.resetToken) throw Error('Recovery request unavailable');
      await auth.api.resetPassword({ body: { token: context.resetToken, newPassword: password }, headers });
      reset = true;
    });
    json(res, 200, { success: true, recoveryCode: freshRecoveryCode(row.id) });
  } finally {
    if (!reset)
      db.prepare('UPDATE fd_recovery SET hash=? WHERE userId=? AND hash IS NULL').run(row.hash, row.id);
  }
}
