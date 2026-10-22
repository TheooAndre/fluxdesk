import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Vercel Function gateway for the private persistent FluxDesk API.
 *
 * Requirements:
 *   - Vercel Authentication: ALL deployments, not merely previews.
 *   - FLUXDESK_BACKEND_URL: HTTPS origin of the persistent backend.
 *   - FLUXDESK_GATEWAY_TOKEN: SAME 32+ byte secret as the backend.
 *
 * Never send the gateway secret, backend auth or upstream cookies to browsers.
 * A misconfigured gateway fails CLOSED with a 503 instead of serving stale data.
 */
type GatewayRequest = IncomingMessage & { body?: unknown };
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
    if (target.protocol !== 'https:' || target.username || target.password ||
        target.search || target.hash || target.pathname !== '/' ||
        ['localhost', '127.0.0.1', '::1'].includes(target.hostname))
      return null;
    return target;
  } catch { return null; }
}

async function requestBody(req: GatewayRequest): Promise<string | undefined> {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method ?? '')) return undefined;
  if (req.body !== undefined) {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw Error('Request too large');
    return body;
  }
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw Error('Request too large');
  }
  return text;
}

export default async function handler(req: GatewayRequest, res: ServerResponse) {
  res.setHeader('cache-control', 'no-store');
  const upstream = backendOrigin();
  if (!upstream) return reply(res, 503, 'Private API backend is not configured');

  // Host is supplied by Vercel's routing layer. Never use arbitrary
  // x-forwarded-host or user-controlled query values to choose the backend.
  const host = req.headers.host;
  if (!host || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host))
    return reply(res, 400, 'Invalid public host');
  let publicUrl: URL;
  try { publicUrl = new URL(req.url ?? '/', `https://${host}`); }
  catch { return reply(res, 400, 'Invalid API path'); }
  // Vite's plain Vercel Functions do not implement Next.js [...path]
  // filenames. vercel.json rewrites /api/:path* to this single function and
  // supplies the requested API path as a query value.
  if (publicUrl.pathname !== '/api/gateway')
    return reply(res, 404, 'Unknown API endpoint');
  const requestedPaths = publicUrl.searchParams.getAll('__fd_route');
  if (requestedPaths.length !== 1 ||
      !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*$/i.test(requestedPaths[0] ?? ''))
    return reply(res, 404, 'Unknown API endpoint');
  const requestedPath = requestedPaths[0]!;
  publicUrl.searchParams.delete('__fd_route');
  if (!['GET', 'POST', 'DELETE', 'PUT'].includes(req.method ?? ''))
    return reply(res, 405, 'Method not allowed');

  const origin = req.headers.origin;
  if (req.method !== 'GET' &&
      (typeof origin !== 'string' || origin !== `https://${host}`))
    return reply(res, 403, 'Cross-origin mutation blocked');

  const destination = new URL('/api/' + requestedPath + publicUrl.search, upstream);
  try {
    const body = await requestBody(req);
    const result = await fetch(destination, {
      method: req.method,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-fluxdesk-gateway-token': process.env.FLUXDESK_GATEWAY_TOKEN!,
        'x-fluxdesk-public-host': host,
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body }),
    });
    // No redirects: never forward the secret to any redirected destination.
    if (result.status >= 300 && result.status < 400)
      return reply(res, 502, 'Unexpected backend redirect');
    const responseBytes = await result.arrayBuffer();
    if (responseBytes.byteLength > MAX_RESPONSE_BYTES)
      return reply(res, 502, 'Backend response exceeds size limit');
    res.writeHead(result.status, {
      'content-type': result.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(Buffer.from(responseBytes));
  } catch (error) {
    if (error instanceof Error && error.message === 'Request too large')
      return reply(res, 413, 'Request too large');
    // Never expose backend URLs, gateway credentials, or raw network errors.
    return reply(res, 502, 'Private API backend unavailable');
  }
}
