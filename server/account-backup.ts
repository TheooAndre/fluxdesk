import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const MAX_ACCOUNT_BYTES = 8 * 1024 * 1024;
export function accountBackupBytes(content: string): Buffer {
  const bytes = Buffer.from(content, 'base64');
  if (
    bytes.length < 100 ||
    bytes.length > MAX_ACCOUNT_BYTES ||
    bytes.toString('base64') !== content ||
    !bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
  )
    throw Error('Invalid account database backup');
  return bytes;
}

function validateDatabase(db: DatabaseSync) {
  db.exec('PRAGMA trusted_schema=OFF;');
  const schema = db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as {
    name: string;
    type: string;
  }[];
  if (schema.some((entry) => !['table', 'index'].includes(entry.type)))
    throw Error('Unsafe account database schema');
  for (const name of [
    'user',
    'account',
    'session',
    'verification',
    'rateLimit',
    'fd_meta',
    'fd_recovery',
    'fd_attempts',
  ]) {
    if (!schema.some((entry) => entry.name === name && entry.type === 'table'))
      throw Error('Account database backup incomplete');
  }
  const check = db.prepare('PRAGMA quick_check').get() as { quick_check: string };
  const owner = db.prepare("SELECT value FROM fd_meta WHERE key='ownerId'").get() as
    | { value?: string }
    | undefined;
  if (
    check.quick_check !== 'ok' ||
    !owner?.value ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner.value)
  )
    throw Error('Account database backup failed integrity checks');
}

export async function snapshotAccountDatabase(path: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'fluxdesk-account-backup-'));
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const target = join(directory, 'accounts.sqlite');
    await backup(source, target);
    const snapshot = new DatabaseSync(target);
    try {
      validateDatabase(snapshot);
      // Restoring accounts must not resurrect an old authenticated session.
      snapshot.exec('DELETE FROM session; DELETE FROM rateLimit; DELETE FROM fd_attempts; VACUUM;');
    } finally {
      snapshot.close();
    }
    const bytes = await readFile(target);
    return accountBackupBytes(bytes.toString('base64')).toString('base64');
  } finally {
    source.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function validateAccountBackup(content: string): Promise<void> {
  const bytes = accountBackupBytes(content);
  const directory = await mkdtemp(join(tmpdir(), 'fluxdesk-account-verify-'));
  try {
    const path = join(directory, 'accounts.sqlite');
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      validateDatabase(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
