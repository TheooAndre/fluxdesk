import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, lstatSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';

let current: { path: string; db: DatabaseSync; owner: string } | null = null;

export function accountDatabase() {
  const path = resolve(process.env.DATA_DIR ?? 'data', 'accounts.sqlite');
  if (current?.path === path) return current;
  if (current) current.db.close();
  mkdirSync(resolve(process.env.DATA_DIR ?? 'data'), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    closeSync(fd);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Account database must be a regular file');
  }
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS fd_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO fd_meta (key, value) VALUES ('ownerId', '${randomUUID()}');`);
  const row = db.prepare("SELECT value FROM fd_meta WHERE key='ownerId'").get() as { value: string };
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(row.value)) {
    db.close();
    throw Error('Invalid account owner record');
  }
  current = { path, db, owner: row.value };
  return current;
}

export function localOwnerId(): string {
  return `account:${accountDatabase().owner}`;
}

export function ownerRegistered(): boolean {
  const { db, owner } = accountDatabase();
  return !!db.prepare('SELECT id FROM user WHERE id=?').get(owner);
}

export function closeAccountDatabase() {
  current?.db.close();
  current = null;
}
