import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Provider = 'discord' | 'x';
type Session = { sub: string; provider: Provider; name: string; exp: number };
type Attempt = { provider: Provider; state: string; verifier: string; exp: number };
const SESSION_COOKIE = '__Host-fd-session';
const ATTEMPT_COOKIE = '__Host-fd-oauth';
const SESSION_SECONDS = 8 * 60 * 60;
const ATTEMPT_SECONDS = 5 * 60;
const settings = {
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/v10/oauth2/token',
    profile: 'https://discord.com/api/v10/users/@me',
    scope: 'identify',
    id: 'FLUXDESK_DISCORD_CLIENT_ID',
    secret: 'FLUXDESK_DISCORD_CLIENT_SECRET',
  },
  x: {
    authorize: 'https://x.com/i/oauth2/authorize',
    token: 'https://api.x.com/2/oauth2/token',
    profile: 'https://api.x.com/2/users/me',
    scope: 'users.read',
    id: 'FLUXDESK_X_CLIENT_ID',
    secret: 'FLUXDESK_X_CLIENT_SECRET',
  },
} as const;

export const socialMode = () => process.env.FLUXDESK_PUBLIC_MODE === 'true';
const secret = () => {
  const value = process.env.FLUXDESK_SESSION_SECRET;
  return value && Buffer.byteLength(value) >= 32 ? value : null;
};
function safeHost(req: IncomingMessage): string | null {
  const host = process.env.FLUXDESK_PUBLIC_HOST;
  return host && /^[a-z0-9.-]+$/.test(host) && req.headers.host === host ? host : null;
}
function cookie(req: IncomingMessage, name: string): string | null {
  const matches = (req.headers.cookie ?? '').split(';').map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : null;
}
function mac(purpose: string, host: string, encoded: string, key: string): string {
  return createHmac('sha256', key).update(`${purpose}\n${host}\n${encoded}`).digest('base64url');
}
function signed(purpose: string, host: string, value: object, key: string): string {
  const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
  return encoded + '.' + mac(purpose, host, encoded, key);
}
function verify<T>(purpose: string, host: string, token: string | null, key: string): T | null {
  if (!token || token.length > 900) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]!)) return null;
  const received = Buffer.from(parts[1]!), expected = Buffer.from(mac(purpose, host, parts[0]!, key));
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try { return JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as T; }
  catch { return null; }
}
export function sessionIdentity(req: IncomingMessage): Session | null {
  const host = safeHost(req), key = secret();
  if (!host || !key) return null;
  const value = verify<Session>('session-v1', host, cookie(req, SESSION_COOKIE), key);
  if (!value || !['discord', 'x'].includes(value.provider) || typeof value.sub !== 'string' ||
      !/^(discord|x):[0-9]{1,30}$/.test(value.sub) ||
      typeof value.name !== 'string' || value.name.length > 80 ||
      !Number.isSafeInteger(value.exp) || value.exp <= Date.now() ||
      value.exp > Date.now() + SESSION_SECONDS * 1000) return null;
  return value;
}
function setCookie(res: ServerResponse, name: string, value: string, age: number) {
  const previous = res.getHeader('set-cookie');
  const entry = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
  res.setHeader('set-cookie', [...(Array.isArray(previous) ? previous : previous ? [String(previous)] : []), entry]);
}
function json(res: ServerResponse, code: number, value: object) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function redirect(res: ServerResponse, location: string, code = 302) {
  res.writeHead(code, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  res.end();
}
function providerConfig(provider: Provider) {
  const base = settings[provider];
  const id = process.env[base.id], clientSecret = process.env[base.secret];
  return id && clientSecret ? { ...base, clientId: id, clientSecret } : null;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw Error('Provider request failed');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 32_768) throw Error('Provider response too large');
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
}

/** Browser-facing auth stays at Vercel; OAuth credentials/tokens never reach Northflank. */
export async function handleSocialAuth(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  if (!path.startsWith('auth/')) return false;
  if (!socialMode()) return false;
  const host = safeHost(req), key = secret();
  if (!host || !key) { json(res, 503, { error: 'Social sign-in is awaiting configuration' }); return true; }
  if (path === 'auth/session') {
    if (req.method !== 'GET') json(res, 405, { error: 'Method not allowed' });
    else {
      const session = sessionIdentity(req);
      json(res, 200, { authenticated: !!session, provider: session?.provider ?? null,
        name: session?.name ?? null, owner: !!session && session.sub === process.env.FLUXDESK_OWNER_SUB,
        providers: { discord: !!providerConfig('discord'), x: !!providerConfig('x') } });
    }
    return true;
  }
  if (path === 'auth/logout') {
    if (req.method !== 'POST') json(res, 405, { error: 'Method not allowed' });
    else if (req.headers.origin !== `https://${host}`) json(res, 403, { error: 'Cross-origin sign-out blocked' });
    else {
      setCookie(res, SESSION_COOKIE, '', 0);
      json(res, 200, { authenticated: false });
    }
    return true;
  }
  const start = /^auth\/(discord|x)$/.exec(path);
  const callback = /^auth\/callback\/(discord|x)$/.exec(path);
  if (!start && !callback) { json(res, 404, { error: 'Unknown auth route' }); return true; }
  if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed' }); return true; }
  const provider = (start?.[1] ?? callback?.[1]) as Provider;
  const config = providerConfig(provider);
  if (!config) { json(res, 503, { error: 'Sign-in provider is not configured' }); return true; }
  const redirectUri = `https://${host}/api/auth/callback/${provider}`;
  if (start) {
    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const attempt: Attempt = { provider, state, verifier, exp: Date.now() + ATTEMPT_SECONDS * 1000 };
    setCookie(res, ATTEMPT_COOKIE, signed('oauth-v1', host, attempt, key), ATTEMPT_SECONDS);
    const destination = new URL(config.authorize);
    destination.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId,
      redirect_uri: redirectUri, scope: config.scope, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256' }).toString();
    redirect(res, destination.href);
    return true;
  }
  const attempt = verify<Attempt>('oauth-v1', host, cookie(req, ATTEMPT_COOKIE), key);
  setCookie(res, ATTEMPT_COOKIE, '', 0);
  const returnedState = url.searchParams.get('state');
  const expectedState = attempt?.state;
  const stateMatches = !!returnedState && !!expectedState &&
    Buffer.byteLength(returnedState) === Buffer.byteLength(expectedState) &&
    timingSafeEqual(Buffer.from(returnedState), Buffer.from(expectedState));
  const code = url.searchParams.get('code');
  if (!attempt || attempt.provider !== provider || attempt.exp <= Date.now() ||
      !stateMatches || !code || code.length > 2048 ||
      (provider === 'discord' && url.searchParams.get('iss') !== 'https://discord.com') ||
      url.searchParams.has('error')) {
    redirect(res, '/?auth=failed', 303);
    return true;
  }
  try {
    const token = await boundedJson(await fetch(config.token, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded',
        authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64') },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        code_verifier: attempt.verifier }),
    })) as { access_token?: unknown; token_type?: unknown };
    if (typeof token.access_token !== 'string' || typeof token.token_type !== 'string' ||
        token.token_type.toLowerCase() !== 'bearer')
      throw Error('Invalid provider token');
    const profile = await boundedJson(await fetch(config.profile, {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token.access_token}` },
    })) as { id?: unknown; username?: unknown; global_name?: unknown; data?: { id?: unknown; username?: unknown; name?: unknown } };
    const data = provider === 'x' ? profile.data : profile;
    if (!data || typeof data.id !== 'string' || !/^[0-9]{1,30}$/.test(data.id))
      throw Error('Invalid provider identity');
    const name = String((provider === 'discord' ? profile.global_name : profile.data?.name) ??
      data.username ?? provider).slice(0, 80);
    const session: Session = { sub: `${provider}:${data.id}`, provider, name,
      exp: Date.now() + SESSION_SECONDS * 1000 };
    setCookie(res, SESSION_COOKIE, signed('session-v1', host, session, key), SESSION_SECONDS);
    redirect(res, '/', 303);
  } catch {
    redirect(res, '/?auth=failed', 303);
  }
  return true;
}
