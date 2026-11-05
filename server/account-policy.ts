import { createHmac, timingSafeEqual } from 'node:crypto';

export const accountMode = () => process.env.FLUXDESK_ACCOUNT_AUTH === 'true';
export const accountHost = () => process.env.FLUXDESK_PUBLIC_HOST ?? 'fluxdesk-terminal.vercel.app';
export const ACCOUNT_COOKIE = '__Host-fd-account';

export function accountSecret(): string {
  const key = process.env.FLUXDESK_GATEWAY_TOKEN;
  if (!key || Buffer.byteLength(key) < 32) throw Error('Account gateway configuration required');
  // Independent signing purpose; neither this derived key nor the gateway
  // credential is sent to clients or saved in the account database.
  return createHmac('sha256', key).update('fluxdesk/better-auth/session/v1').digest('hex');
}

export function ownerSetupProof(host: string, path: string, method: string, at = Date.now()): string {
  const mac = createHmac('sha256', accountSecret())
    .update(`owner-setup-v1\n${host}\n${path}\n${method}\n${at}`)
    .digest('hex');
  return `${at}.${mac}`;
}

export function verifyOwnerSetup(proof: unknown, host: string, path: string, method: string): boolean {
  if (typeof proof !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(proof)) return false;
  const at = Number(proof.slice(0, 13));
  if (at > Date.now() + 5_000 || Date.now() - at > 30_000) return false;
  return timingSafeEqual(Buffer.from(proof), Buffer.from(ownerSetupProof(host, path, method, at)));
}

export function accountCookie(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 16_384) return undefined;
  const parts = raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(ACCOUNT_COOKIE + '='));
  return parts.length === 1 && parts[0]!.length < 2048 ? parts[0] : undefined;
}
