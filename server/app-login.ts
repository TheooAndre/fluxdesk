import { createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';

const derive = promisify(scrypt);
const COOKIE = '__Host-fluxdesk-session';
const TTL = 8 * 60 * 60;
// Defense in depth only: serverless instances do not share this limiter.
const attempts = new Map<string, { count: number; until: number }>();
let pending = 0;
export const appLoginEnabled = () => process.env.VITE_FLUXDESK_APP_LOGIN === 'true';
const password = () => {
  const value = process.env.FLUXDESK_APP_PASSWORD;
  return value && Buffer.byteLength(value) >= 20 && Buffer.byteLength(value) <= 256 ? value : null;
};
let cachedPassword: string | undefined;
let cachedSigningKey: Buffer | undefined;
function signingKey(secret: string): Buffer {
  if (cachedPassword !== secret || !cachedSigningKey) {
    cachedSigningKey = scryptSync(secret, 'fluxdesk-session-signing-v1', 32);
    cachedPassword = secret;
  }
  return cachedSigningKey;
}
function signature(payload: string, host: string, secret: string): string {
  return createHmac('sha256', signingKey(secret))
    .update(`fluxdesk-session-v1\n${host}\n${payload}`)
    .digest('base64url');
}
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signedIn(req: IncomingMessage, now = Date.now()): boolean {
  const secret = password();
  if (!secret || !req.headers.host) return false;
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(COOKIE + '='));
  if (values.length !== 1) return false;
  const token = values[0]!.slice(COOKIE.length + 1);
  if (token.length > 300) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expires, nonce, sig] = parts as [string, string, string];
  if (!/^\d{10}$/.test(expires) || !/^[A-Za-z0-9_-]{32}$/.test(nonce)) return false;
  const remaining = Number(expires) - Math.floor(now / 1000);
  return (
    remaining > 0 &&
    remaining <= TTL &&
    equal(sig, signature(`${expires}.${nonce}`, req.headers.host, secret))
  );
}
function json(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
/** Handles authentication locally on Vercel; never forwards passwords or cookies to Northflank. */
export async function handleAppLogin(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  if (!['auth/session', 'auth/login', 'auth/logout'].includes(path)) return false;
  if (path === 'auth/session' && req.method === 'GET') {
    if (!appLoginEnabled()) json(res, 200, { authenticated: true, loginRequired: false });
    else if (!password()) json(res, 503, { error: 'Private login is awaiting configuration.' });
    else json(res, 200, { authenticated: signedIn(req), loginRequired: true });
    return true;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return true;
  }
  if (req.headers.origin !== `https://${req.headers.host}` || !req.headers.host) {
    json(res, 403, { error: 'Cross-origin authentication blocked' });
    return true;
  }
  const secret = password();
  if (!appLoginEnabled() || !secret) {
    json(res, 503, { error: 'Private login is awaiting configuration.' });
    return true;
  }
  if (path === 'auth/logout') {
    res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    json(res, 200, { authenticated: false });
    return true;
  }
  // Trust only the platform's client-IP header in Vercel; never reflect it in responses/logs.
  const ip = String(req.headers['x-vercel-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').slice(
    0,
    100,
  );
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const attempt = attempts.get(ip) ?? { count: 0, until: now + 60_000 };
  if (attempt.count >= 5 || pending >= 4 || (!attempts.has(ip) && attempts.size >= 1000)) {
    res.setHeader('retry-after', '60');
    json(res, 429, { error: 'Too many sign-in attempts. Try again in a minute.' });
    return true;
  }
  attempt.count++;
  attempts.set(ip, attempt);
  try {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
      throw Error('Invalid login');
    let body = req.body;
    if (body === undefined) {
      let text = '';
      for await (const chunk of req) {
        text += String(chunk);
        if (Buffer.byteLength(text) > 1024) throw Error('Invalid login');
      }
      body = JSON.parse(text);
    } else if (typeof body === 'string') {
      if (Buffer.byteLength(body) > 1024) throw Error('Invalid login');
      body = JSON.parse(body);
    }
    if (
      !body ||
      typeof body !== 'object' ||
      !('password' in body) ||
      typeof body.password !== 'string' ||
      Buffer.byteLength(body.password) > 256
    )
      throw Error('Invalid login');
    pending++;
    let valid: boolean;
    try {
      const salt = 'fluxdesk-owner-login-v1';
      const [provided, expected] = await Promise.all([
        derive(body.password, salt, 32),
        derive(secret, salt, 32),
      ]);
      valid = timingSafeEqual(provided as Buffer, expected as Buffer);
    } finally {
      pending--;
    }
    if (!valid) {
      json(res, 401, { error: 'Incorrect password.' });
      return true;
    }
    attempts.delete(ip);
    const payload = `${Math.floor(Date.now() / 1000) + TTL}.${randomBytes(24).toString('base64url')}`;
    const token = `${payload}.${signature(payload, req.headers.host!, secret)}`;
    res.setHeader(
      'set-cookie',
      `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL}`,
    );
    json(res, 200, { authenticated: true });
  } catch {
    json(res, 400, { error: 'Invalid login request.' });
  }
  return true;
}
