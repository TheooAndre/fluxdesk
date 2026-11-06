import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { handleSocialAuth, sessionIdentity, socialMode } from './social-auth.ts';
import { AUTH_LIMITED_ROUTES, enforceAuthRateLimit, validAuthJson } from './rate-limit.ts';
import {
  accountCookie,
  accountHost,
  accountMode,
  ownerSetupProof,
  ACCOUNT_COOKIE,
} from '../server/account-policy.ts';

/**
 * Vercel Function gateway for the persistent FluxDesk API.
 *
 * Requirements:
 *   - Private mode: Vercel Authentication on all deployments.
 *   - Social mode: provider sign-in for user data and an explicitly public read allowlist.
 *   - FLUXDESK_BACKEND_URL: HTTPS origin of the persistent backend.
 *   - FLUXDESK_GATEWAY_TOKEN: SAME 32+ byte secret as the backend.
 *
 * Never send the gateway secret, backend auth or upstream cookies to browsers.
 * A misconfigured gateway fails CLOSED with a 503 instead of serving stale data.
 */
type GatewayRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[]>;
};
const MAX_BODY_BYTES = 16_384;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function reply(res: ServerResponse, code: number, message: string) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify({ error: message }));
}

function backendOrigin(): URL | null {
  const raw = process.env.FLUXDESK_BACKEND_URL;
  const secret = process.env.FLUXDESK_GATEWAY_TOKEN;
  if (!raw || !secret || Buffer.byteLength(secret, 'utf8') < 32) return null;
  try {
    const target = new URL(raw);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.pathname !== '/' ||
      ['localhost', '127.0.0.1', '::1'].includes(target.hostname)
    )
      return null;
    return target;
  } catch {
    return null;
  }
}

function apiPath(req: GatewayRequest, url: URL): string | null {
  // Validate before URL normalization can collapse dot segments. Never use
  // forwarded headers or route metadata to select an upstream origin.
  const rawPath = (req.url ?? '/').split('?')[0] ?? '';
  const match = /^\/api\/([a-z0-9_-]+(?:\/[a-z0-9_-]+)*)$/i.exec(rawPath);
  if (!match) return null;
  const routes = url.searchParams.getAll('__fd_route');
  // Vercel's lazy query getter reparses req.url with legacy url.parse() in
  // the deployed Node runtime (DEP0169). The URL above already parses that
  // query safely. Only inspect explicitly supplied data properties here;
  // keep validating rewrite metadata without invoking the platform getter.
  const suppliedQuery = Object.getOwnPropertyDescriptor(req, 'query')?.value as GatewayRequest['query'];
  const helperRoute = suppliedQuery?.__fd_route;
  if (routes.length > 1 || (helperRoute !== undefined && typeof helperRoute !== 'string')) return null;
  if (routes.length && helperRoute !== undefined && routes[0] !== helperRoute) return null;
  const route = routes[0] ?? helperRoute;
  if (route !== undefined && !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(route)) return null;
  // A Vercel rewrite can reach the function with the public /api/health URL
  // preserved, or with /api/gateway plus destination query metadata. Support
  // both, but reject conflicting metadata rather than silently rerouting it.
  if (rawPath === '/api/gateway') return route ?? null;
  const path = match[1]!;
  if (route !== undefined && route !== path) return null;
  return path;
}

async function requestBody(req: GatewayRequest, maxBytes = MAX_BODY_BYTES): Promise<string | undefined> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) return undefined;
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw Error('Request too large');
    return body;
  }
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw Error('Request too large');
  }
  return text;
}

export default async function handler(req: GatewayRequest, res: ServerResponse) {
  res.setHeader('cache-control', 'no-store');

  // Host is supplied by Vercel's routing layer. Never use arbitrary
  // x-forwarded-host or user-controlled query values to choose the backend.
  const host = req.headers.host;
  if (!host || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) return reply(res, 400, 'Invalid public host');
  let publicUrl: URL;
  try {
    publicUrl = new URL(req.url ?? '/', `https://${host}`);
  } catch {
    return reply(res, 400, 'Invalid API path');
  }
  const requestedPath = apiPath(req, publicUrl);
  if (!requestedPath) return reply(res, 404, 'Unknown API endpoint');
  publicUrl.searchParams.delete('__fd_route');
  // Vercel access-link parameters belong to its protection layer, never the API.
  publicUrl.searchParams.delete('_vercel_share');
  if (!accountMode() && socialMode() && (await handleSocialAuth(req, res, requestedPath, publicUrl))) return;
  const upstream = backendOrigin();
  if (!upstream) return reply(res, 503, 'Private API backend is not configured');
  const identity = !accountMode() && socialMode() ? sessionIdentity(req) : null;
  const setupHost =
    accountMode() &&
    process.env.VERCEL_ENV === 'production' &&
    host === process.env.VERCEL_URL &&
    host !== accountHost();
  if (accountMode()) {
    if (host !== accountHost() && !setupHost) return reply(res, 403, 'Use the main FluxDesk app');
    const publicReads = new Set([
      'health',
      'markets',
      'calendar',
      'perpetual',
      'candles',
      'asset',
      'signals',
      'pair',
      'correlations',
      'liquidations',
    ]);
    const authRoutes = new Set([
      'auth/session',
      'auth/register',
      'auth/register-owner',
      'auth/login',
      'auth/logout',
      'auth/change-password',
      'auth/recover',
    ]);
    if (publicReads.has(requestedPath) && req.method !== 'GET') return reply(res, 405, 'Method not allowed');
    if (requestedPath.startsWith('auth/') && !authRoutes.has(requestedPath))
      return reply(res, 404, 'Unknown account endpoint');
    if (requestedPath === 'auth/register-owner' && !setupHost)
      return reply(res, 403, 'Owner setup requires the protected production setup page');
    if (!publicReads.has(requestedPath) && !authRoutes.has(requestedPath)) {
      if (!/^(journal|alerts|watchlist|push|research|statarb|investments)(?:\/|$)/.test(requestedPath))
        return reply(res, 404, 'Unknown API endpoint');
      if (!accountCookie(req.headers.cookie)) return reply(res, 401, 'Sign in to use this feature');
    }
  } else if (socialMode()) {
    // Only the explicitly listed market/calendar endpoints are anonymously readable.
    const publicReads = new Set([
      'health',
      'markets',
      'calendar',
      'perpetual',
      'candles',
      'asset',
      'signals',
      'pair',
      'correlations',
      'liquidations',
    ]);
    if (publicReads.has(requestedPath)) {
      if (req.method !== 'GET') return reply(res, 405, 'Method not allowed');
    } else if (!identity) return reply(res, 401, 'Sign in to use this feature');
    if (
      (requestedPath.startsWith('research/') ||
        requestedPath.startsWith('statarb/') ||
        requestedPath === 'investments' ||
        requestedPath.startsWith('investments/')) &&
      identity?.sub !== process.env.FLUXDESK_OWNER_SUB
    )
      return reply(res, 403, 'Owner access required');
  }
  if (!['GET', 'POST', 'DELETE', 'PUT'].includes(req.method ?? ''))
    return reply(res, 405, 'Method not allowed');

  const origin = req.headers.origin;
  if (req.method !== 'GET' && (typeof origin !== 'string' || origin !== `https://${host}`))
    return reply(res, 403, 'Cross-origin mutation blocked');

  // The owner uses one persistent backend. Preview deployments may inspect it,
  // but must not accidentally edit the live journal, alerts, watchlist or archive.
  if (process.env.VERCEL_ENV === 'preview' && req.method !== 'GET')
    return reply(
      res,
      403,
      'This development preview is read-only. Open the main FluxDesk app to save changes.',
    );

  const destination = new URL('/api/' + requestedPath + publicUrl.search, upstream);
  try {
    const body = await requestBody(
      req,
      requestedPath === 'investments'
        ? 1024 * 1024
        : requestedPath === 'journal/import'
          ? 4 * 1024 * 1024
          : requestedPath.startsWith('journal/')
            ? 131072
            : MAX_BODY_BYTES,
    );
    if (AUTH_LIMITED_ROUTES.has(requestedPath)) {
      if (!(await enforceAuthRateLimit(req, res, requestedPath, body))) return;
      if (!validAuthJson(body)) return reply(res, 400, 'Invalid account request');
    }
    const result = await fetch(destination, {
      method: req.method,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-fluxdesk-gateway-token': process.env.FLUXDESK_GATEWAY_TOKEN!,
        'x-fluxdesk-public-host': host,
        ...(accountMode() && accountCookie(req.headers.cookie)
          ? { cookie: accountCookie(req.headers.cookie)! }
          : {}),
        ...(accountMode() && setupHost
          ? {
              'x-fluxdesk-owner-setup': ownerSetupProof(host, '/api/' + requestedPath, req.method ?? 'GET'),
            }
          : {}),
        ...(accountMode() &&
        typeof req.headers['x-vercel-forwarded-for'] === 'string' &&
        isIP(req.headers['x-vercel-forwarded-for'])
          ? {
              'x-fluxdesk-client-ip': req.headers['x-vercel-forwarded-for'],
            }
          : {}),
        ...(identity ? { 'x-fluxdesk-user-id': identity.sub } : {}),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body }),
    });
    // No redirects: never forward the secret to any redirected destination.
    if (result.status >= 300 && result.status < 400) return reply(res, 502, 'Unexpected backend redirect');
    if (accountMode() && result.headers.get('x-fluxdesk-access-mode') !== 'accounts-v1')
      return reply(res, 503, 'Account backend has not completed the access upgrade');
    if (!accountMode() && socialMode() && result.headers.get('x-fluxdesk-access-mode') !== 'social-v1')
      return reply(res, 503, 'Public API backend has not completed the access upgrade');
    const responseBytes = await result.arrayBuffer();
    if (responseBytes.byteLength > MAX_RESPONSE_BYTES)
      return reply(res, 502, 'Backend response exceeds size limit');
    const cookies = accountMode()
      ? result.headers
          .getSetCookie()
          .filter(
            (entry) =>
              entry.startsWith(ACCOUNT_COOKIE + '=') &&
              /;\s*HttpOnly(?:;|$)/i.test(entry) &&
              /;\s*Secure(?:;|$)/i.test(entry) &&
              /;\s*Path=\/(?:;|$)/i.test(entry) &&
              !/;\s*Domain=/i.test(entry),
          )
      : [];
    const retryAfter = result.headers.get('retry-after');
    res.writeHead(result.status, {
      'content-type': result.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(cookies.length ? { 'set-cookie': cookies } : {}),
      ...(retryAfter && /^\d{1,8}$/.test(retryAfter) ? { 'retry-after': retryAfter } : {}),
    });
    res.end(Buffer.from(responseBytes));
  } catch (error) {
    if (error instanceof Error && error.message === 'Request too large')
      return reply(res, 413, 'Request too large');
    // Never expose backend URLs, gateway credentials, or raw network errors.
    return reply(res, 502, 'Private API backend unavailable');
  }
}
