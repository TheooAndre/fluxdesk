import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { assetIdentity } from './market.ts';

const file = resolve(process.env.DATA_DIR ?? 'data', 'watchlist.json');
const LIMIT = 50;
let ids: string[] = [];
let loading: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();

function validateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMIT || value.some((x) => typeof x !== 'string'))
    throw Error('Invalid saved watchlist');
  for (const id of value) assetIdentity(id);
  if (new Set(value).size !== value.length) throw Error('Duplicate saved watchlist entry');
  return [...value] as string[];
}
async function load(): Promise<void> {
  loading ??= (async () => {
    try {
      if ((await stat(file)).size > 8192) throw Error('Saved watchlist is too large');
      const data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (
        !data ||
        typeof data !== 'object' ||
        !('schemaVersion' in data) ||
        data.schemaVersion !== 1 ||
        !('assetIds' in data)
      )
        throw Error('Unsupported saved watchlist format');
      ids = validateIds(data.assetIds);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  })();
  await loading;
}
export async function savedWatchlist(): Promise<{ assetIds: string[] }> {
  await load();
  return { assetIds: [...ids] };
}
export function changeWatchlist(assetId: string, add: boolean): Promise<{ assetIds: string[] }> {
  assetIdentity(assetId);
  const task = writes.then(async () => {
    await load();
    const next = add
      ? ids.includes(assetId)
        ? [...ids]
        : [...ids, assetId]
      : ids.filter((x) => x !== assetId);
    if (next.length > LIMIT) throw Error('Watchlist limit reached (50 markets)');
    if (next.length === ids.length) return { assetIds: [...ids] };
    await mkdir(dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, assetIds: next }), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, file);
      // Publish in memory only after durable replacement succeeds.
      ids = next;
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return { assetIds: [...ids] };
  });
  // A failed disk write must not poison all future updates.
  writes = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
