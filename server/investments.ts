import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MAX_INVESTMENT_BYTES, validateInvestments, type Investments } from '../src/investments/model.ts';

export class InvestmentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const path = () => resolve(process.env.DATA_DIR ?? 'data', 'investments.json');
let writes = Promise.resolve();
export async function readInvestments(): Promise<Investments> {
  try {
    if ((await stat(path())).size > MAX_INVESTMENT_BYTES) throw Error('Investment file exceeds 1 MiB');
    return validateInvestments(JSON.parse(await readFile(path(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { schemaVersion: 1, revision: 0, portfolios: [] };
    throw error;
  }
}
export async function saveInvestments(input: unknown): Promise<Investments> {
  let next: Investments;
  try {
    next = validateInvestments(input);
  } catch (error) {
    throw new InvestmentError(error instanceof Error ? error.message : 'Invalid investments');
  }
  const task = writes.then(async () => {
    const old = await readInvestments();
    if (old.revision !== next.revision)
      throw new InvestmentError('Investments changed on another device. Reload before saving.', 409);
    const value: Investments = { ...next, revision: old.revision + 1 };
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > MAX_INVESTMENT_BYTES)
      throw new InvestmentError('Investment workspace exceeds 1 MiB');
    const target = path(),
      temp = `${target}.${randomUUID()}.tmp`;
    await mkdir(resolve(process.env.DATA_DIR ?? 'data'), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, raw, { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally {
      await unlink(temp).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return value;
  });
  writes = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
