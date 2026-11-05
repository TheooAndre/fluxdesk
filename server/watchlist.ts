import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { assetIdentity } from './market.ts';
import { dataFile } from './identity.ts';

const LIMIT = 50;
type RecordState = { ids: string[]; loading?: Promise<void>; writes: Promise<void> };
const states = new Map<string, RecordState>();
function state(viewer?: string) {
  const file = dataFile('watchlist.json', viewer);
  let record = states.get(file);
  if (!record) {
    record = { ids: [], writes: Promise.resolve() };
    states.set(file, record);
  }
  return { file, record };
}

function validateIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIMIT || value.some((x) => typeof x !== 'string'))
    throw Error('Invalid saved watchlist');
  for (const id of value) assetIdentity(id);
  if (new Set(value).size !== value.length) throw Error('Duplicate saved watchlist entry');
  return [...value] as string[];
}
async function load(file: string, record: RecordState): Promise<void> {
  record.loading ??= (async () => {
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
      record.ids = validateIds(data.assetIds);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  })();
  await record.loading;
}
export async function savedWatchlist(viewer?: string): Promise<{ assetIds: string[] }> {
  const { file, record } = state(viewer);
  await load(file, record);
  return { assetIds: [...record.ids] };
}
export function changeWatchlist(assetId: string, add: boolean, viewer?: string): Promise<{ assetIds: string[] }> {
  assetIdentity(assetId);
  const { file, record } = state(viewer);
  const task = record.writes.then(async () => {
    await load(file, record);
    const next = add
      ? record.ids.includes(assetId)
        ? [...record.ids]
        : [...record.ids, assetId]
      : record.ids.filter((x) => x !== assetId);
    if (next.length > LIMIT) throw Error('Watchlist limit reached (50 markets)');
    if (next.length === record.ids.length) return { assetIds: [...record.ids] };
    await mkdir(dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, assetIds: next }), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, file);
      // Publish in memory only after durable replacement succeeds.
      record.ids = next;
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return { assetIds: [...record.ids] };
  });
  // A failed disk write must not poison all future updates.
  record.writes = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
