import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { accountMode } from './account-policy.ts';
import { localOwnerId } from './account-db.ts';

export const publicMode = () => accountMode() || process.env.FLUXDESK_PUBLIC_MODE === 'true';
export const ownerId = () => accountMode() ? localOwnerId() : process.env.FLUXDESK_OWNER_SUB;

export function isOwner(id: string | undefined): boolean {
  return !!id && !!ownerId() && id === ownerId();
}

export function visibleTo(owner: string | undefined, viewer: string | undefined): boolean {
  if (!publicMode()) return true;
  return !!viewer && (owner ? owner === viewer : isOwner(viewer));
}

export function dataFile(name: 'journal.json' | 'watchlist.json', viewer?: string): string {
  const root = process.env.DATA_DIR ?? 'data';
  if (!publicMode()) return resolve(root, name);
  if (!viewer || !/^(?:(?:discord|x):[0-9]{1,30}|account:[A-Za-z0-9_-]{16,64})$/.test(viewer)) throw Error('Authentication required');
  if (isOwner(viewer)) return resolve(root, name);
  // Hash the immutable provider ID. No provider-supplied text becomes a path component.
  return resolve(root, 'users', createHash('sha256').update(viewer).digest('hex'), name);
}
