import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { publicMode } from './identity.ts';

/**
 * Authenticates requests delivered by our HTTPS frontend gateway.
 * The gateway secret is never sent to browsers and must be configured on
 * BOTH the Vercel Function and the persistent API server.
 *
 * An OIDC reverse proxy remains a separate supported hosting option.
 */
export class GatewayAuthError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
  }
}

export function assertGatewaySecret(secret: string | undefined): void {
  if (secret !== undefined && Buffer.byteLength(secret, 'utf8') < 32)
    throw Error('FLUXDESK_GATEWAY_TOKEN must be at least 32 bytes');
}

const HOST = /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/i;

export function authenticateGateway(
  req: IncomingMessage,
  secret = process.env.FLUXDESK_GATEWAY_TOKEN,
): { originHost: string; gatewayProtected: boolean; userId?: string } {
  if (!secret) {
    if (publicMode()) throw new GatewayAuthError('Gateway configuration required', 503);
    return { originHost: req.headers.host ?? '', gatewayProtected: false, userId: undefined };
  }
  assertGatewaySecret(secret);
  const provided = req.headers['x-fluxdesk-gateway-token'];
  const received = typeof provided === 'string' ? Buffer.from(provided, 'utf8') : Buffer.alloc(0);
  const expected = Buffer.from(secret, 'utf8');
  if (received.length !== expected.length || !timingSafeEqual(received, expected))
    throw new GatewayAuthError('Gateway authentication required', 401);

  // Trust this header ONLY after the gateway credential is verified.
  // It contains the browser-facing Vercel origin host (not the backend host).
  const originHost = req.headers['x-fluxdesk-public-host'];
  if (typeof originHost !== 'string' || !HOST.test(originHost) || originHost.includes('..'))
    throw new GatewayAuthError('Invalid gateway host');
  const supplied = req.headers['x-fluxdesk-user-id'];
  const userId = typeof supplied === 'string' && /^(discord|x):[0-9]{1,30}$/.test(supplied) ? supplied : undefined;
  if (publicMode() && supplied !== undefined && !userId)
    throw new GatewayAuthError('Invalid gateway identity');
  return { originHost, gatewayProtected: true, userId };
}

export function assertRemoteBindingAllowed(
  host: string,
  env: Partial<Record<'REVERSE_PROXY_OIDC' | 'FLUXDESK_GATEWAY_TOKEN', string>>,
): void {
  assertGatewaySecret(env.FLUXDESK_GATEWAY_TOKEN);
  if (['127.0.0.1', '::1', 'localhost'].includes(host)) return;
  if (env.REVERSE_PROXY_OIDC === 'true' || env.FLUXDESK_GATEWAY_TOKEN) return;
  throw Error('Remote access requires an OIDC reverse proxy or a configured cloud gateway secret');
}
