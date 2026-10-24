import { readFile, stat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  validateJournal,
  validateTrade,
  validateDay,
  type JournalData,
  type JournalTrade,
  type JournalDay,
} from '../src/journal/model.ts';
export class JournalError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function checked<T>(validator: (input: unknown) => T, input: unknown): T {
  try {
    return validator(input);
  } catch (e) {
    throw new JournalError(e instanceof Error ? e.message : 'Invalid journal input');
  }
}
const file = () => resolve(process.env.DATA_DIR ?? 'data', 'journal.json');
let writes = Promise.resolve();
export async function readJournal(): Promise<JournalData> {
  try {
    if ((await stat(file())).size > 4 * 1024 * 1024) throw Error('Journal size limit exceeded');
    return validateJournal(JSON.parse(await readFile(file(), 'utf8')));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, trades: [], days: [] };
    throw e;
  }
}
async function change<T>(action: (d: JournalData) => T) {
  const task = writes.then(async () => {
    const d = await readJournal();
    const result = action(d);
    validateJournal(d);
    const raw = JSON.stringify(d);
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new JournalError('Journal limit reached (4 MiB)');
    const path = file();
    await mkdir(dirname(path), { recursive: true });
    const temp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, raw, { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    } finally {
      await unlink(temp).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
    return result;
  });
  writes = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
export function saveTrade(input: unknown) {
  const t = checked(validateTrade, input);
  return change((d) => {
    const old = d.trades.find((x) => x.id === t.id);
    if (t.id && !old) throw new JournalError('Trade no longer exists', 409);
    if (old && old.revision !== t.revision)
      throw new JournalError('Trade changed on another device. Reload before saving.', 409);
    if (!old && d.trades.length >= 2000) throw new JournalError('Journal limit reached (2000 trades)');
    const trade: JournalTrade = {
      ...t,
      id: old?.id ?? randomUUID(),
      revision: (old?.revision ?? 0) + 1,
      createdAt: old?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    d.trades = old ? d.trades.map((x) => (x.id === old.id ? trade : x)) : [...d.trades, trade];
    return { trade };
  });
}
export function removeTrade(id: string, revision: number) {
  return change((d) => {
    const t = d.trades.find((x) => x.id === id);
    if (!t) throw new JournalError('Trade not found', 404);
    if (t.revision !== revision)
      throw new JournalError('Trade changed on another device. Reload before deleting.', 409);
    d.trades = d.trades.filter((x) => x.id !== id);
    return { ok: true };
  });
}
export function saveDay(input: unknown) {
  const day = checked(validateDay, input);
  return change((d) => {
    const old = d.days.find((x) => x.date === day.date);
    if (old && day.revision !== old.revision)
      throw new JournalError('Daily note changed on another device. Reload before saving.', 409);
    if (!old && day.revision !== 0) throw new JournalError('Daily note no longer exists', 409);
    const next: JournalDay = { ...day, revision: (old?.revision ?? 0) + 1, updatedAt: Date.now() };
    d.days = [...d.days.filter((x) => x.date !== day.date), next];
    return { day: next };
  });
}
export function importJournal(input: unknown) {
  const incoming = checked(validateJournal, input);
  return change((d) => {
    let imported = 0,
      skipped = 0;
    const canonical = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(canonical)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, canonical(v)]),
            )
          : value;
    const comparable = (t: JournalTrade | JournalDay) => {
      const copy = { ...t } as Record<string, unknown>;
      delete copy.revision;
      delete copy.createdAt;
      delete copy.updatedAt;
      return JSON.stringify(canonical(copy));
    };
    for (const t of incoming.trades) {
      const old = d.trades.find((x) => x.id === t.id);
      if (old) {
        if (comparable(old) !== comparable(t))
          throw new JournalError('Import conflicts with an existing trade; no changes saved.', 409);
        skipped++;
      } else {
        d.trades.push({ ...t, revision: 1, updatedAt: Date.now() });
        imported++;
      }
    }
    for (const day of incoming.days) {
      const old = d.days.find((x) => x.date === day.date);
      if (old) {
        if (comparable(old) !== comparable(day))
          throw new JournalError('Import conflicts with an existing daily note; no changes saved.', 409);
        skipped++;
      } else {
        d.days.push({ ...day, revision: 1, updatedAt: Date.now() });
        imported++;
      }
    }
    return { imported, skipped };
  });
}
