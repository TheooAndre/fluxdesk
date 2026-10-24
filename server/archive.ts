import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import {validateJournal} from '../src/journal/model.ts';
import { datasetId, type HistoricalDataset } from './research/datasets.ts';
import { assetIdentity } from './market.ts';

const compress = promisify(gzip),
  decompress = promisify(gunzip);
const MAGIC = Buffer.from('FDARCHIVE1');
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
type ArchiveFile = { path: string; sha256: string; content: string };
export type ArchiveManifest = { schemaVersion: 1; createdAt: number; files: ArchiveFile[] };
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
const allowedPath = (path: string) =>
  path === 'state.json' || path === 'watchlist.json' || path === 'journal.json' || /^research\/datasets\/[a-f0-9]{64}\.json$/.test(path);

function validateFile(file: ArchiveFile): void {
  if (
    !file ||
    typeof file.path !== 'string' ||
    !allowedPath(file.path) ||
    typeof file.content !== 'string' ||
    typeof file.sha256 !== 'string' ||
    digest(file.content) !== file.sha256
  )
    throw Error('Invalid backup file path or checksum');
  const value = JSON.parse(file.content) as Record<string, unknown>;
  if (file.path.startsWith('research/')) {
    if (datasetId(value as unknown as HistoricalDataset) !== file.path.slice(18, -5))
      throw Error('Backup dataset fingerprint mismatch');
  } else if (file.path === 'journal.json') {
    validateJournal(value);
  } else if (file.path === 'watchlist.json') {
    if (
      !value ||
      value.schemaVersion !== 1 ||
      !Array.isArray(value.assetIds) ||
      value.assetIds.length > 50 ||
      new Set(value.assetIds).size !== value.assetIds.length
    )
      throw Error('Invalid backup watchlist');
    for (const id of value.assetIds) {
      if (typeof id !== 'string') throw Error('Invalid backup watchlist');
      assetIdentity(id);
    }
  } else if (!value || !['alerts', 'events', 'subscriptions'].every((key) => Array.isArray(value[key]))) {
    throw Error('Invalid backup application state');
  }
}
function validateManifest(value: unknown): ArchiveManifest {
  const data = value as ArchiveManifest;
  if (
    !data ||
    data.schemaVersion !== 1 ||
    !Number.isSafeInteger(data.createdAt) ||
    data.createdAt <= 0 ||
    !Array.isArray(data.files) ||
    !data.files.length ||
    data.files.length > 103
  )
    throw Error('Invalid backup manifest');
  const seen = new Set<string>();
  let bytes = 0;
  for (const file of data.files) {
    validateFile(file);
    if (seen.has(file.path)) throw Error('Duplicate backup path');
    seen.add(file.path);
    bytes += Buffer.byteLength(file.content);
    if (bytes > MAX_BYTES) throw Error('Backup exceeds 16 MiB source limit');
  }
  return data;
}
async function keyFor(password: string, salt: Buffer): Promise<Buffer> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024)
    throw Error('Backup password must contain 12 to 1024 characters/bytes');
  return new Promise((done, fail) =>
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? fail(error) : done(key),
    ),
  );
}
async function pack(manifest: ArchiveManifest, password: string): Promise<Buffer> {
  const raw = Buffer.from(JSON.stringify(validateManifest(manifest)));
  if (raw.length > MAX_BYTES) throw Error('Backup exceeds 16 MiB manifest limit');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(MAGIC);
    const encrypted = Buffer.concat([cipher.update(await compress(raw)), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]);
  } finally {
    key.fill(0);
  }
}
async function unpack(bytes: Buffer, password: string): Promise<ArchiveManifest> {
  const offset = MAGIC.length;
  if (
    bytes.length < offset + 45 ||
    bytes.length > MAX_ARCHIVE_BYTES ||
    !bytes.subarray(0, offset).equals(MAGIC)
  )
    throw Error('Unsupported or oversized encrypted backup');
  const key = await keyFor(password, bytes.subarray(offset, offset + 16));
  let compressed: Buffer;
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(offset + 16, offset + 28));
    cipher.setAAD(MAGIC);
    cipher.setAuthTag(bytes.subarray(offset + 28, offset + 44));
    compressed = Buffer.concat([cipher.update(bytes.subarray(offset + 44)), cipher.final()]);
  } catch {
    throw Error('Backup authentication failed: incorrect password or damaged file');
  } finally {
    key.fill(0);
  }
  const raw = await decompress(compressed, { maxOutputLength: MAX_BYTES });
  return validateManifest(JSON.parse(raw.toString('utf8')) as unknown);
}
async function readRegularFile(path: string, maxBytes = MAX_BYTES): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw Error('Backup input must be a bounded regular file');
  const bytes = await readFile(path);
  if (bytes.length > maxBytes) throw Error('Backup input exceeds size limit');
  return bytes;
}
/** Passive per-file snapshots: state/watchlist are atomically replaced; datasets
 * are immutable. This is not a global transaction across the three resources.
 * Secrets, environment files, mounted-volume identity and temporary files are excluded.
 */
export async function createArchive(
  source: string,
  output: string,
  password: string,
): Promise<{ files: number; datasetIds: string[] }> {
  const root = await realpath(source),
    files: ArchiveFile[] = [];
  let total = 0;
  const collect = async (relative: string) => {
    const content = (await readRegularFile(join(root, relative))).toString('utf8');
    total += Buffer.byteLength(content);
    if (total > MAX_BYTES) throw Error('Backup exceeds 16 MiB source limit');
    const file = { path: relative, content, sha256: digest(content) };
    validateFile(file);
    files.push(file);
  };
  for (const name of ['state.json', 'watchlist.json', 'journal.json']) {
    try {
      await collect(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const research = join(root, 'research'),
    datasets = join(research, 'datasets');
  try {
    for (const path of [research, datasets]) {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw Error('Research archive directory must not be a symlink');
    }
    const names = (await readdir(datasets)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).sort();
    if (names.length > 100) throw Error('Backup exceeds 100 dataset limit');
    for (const name of names) await collect('research/datasets/' + name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!files.length) throw Error('No application data found to back up');
  const manifest: ArchiveManifest = { schemaVersion: 1, createdAt: Date.now(), files };
  const encrypted = await pack(manifest, password);
  // Exclusive output creation: never replace an existing backup.
  await writeFile(resolve(output), encrypted, { mode: 0o600, flag: 'wx' });
  return {
    files: files.length,
    datasetIds: files.filter((f) => f.path.startsWith('research/')).map((f) => f.path.slice(18, -5)),
  };
}
export async function verifyArchive(
  file: string,
  password: string,
): Promise<{ files: number; datasetIds: string[] }> {
  const manifest = await unpack(await readRegularFile(file, MAX_ARCHIVE_BYTES), password);
  return {
    files: manifest.files.length,
    datasetIds: manifest.files.filter((f) => f.path.startsWith('research/')).map((f) => f.path.slice(18, -5)),
  };
}
/** Restore only to a NEW directory, after authenticating and validating every
 * entry. The live DATA_DIR is never merged, overwritten or deleted.
 */
export async function restoreArchive(
  file: string,
  target: string,
  password: string,
): Promise<{ files: number; datasetIds: string[] }> {
  const manifest = await unpack(await readRegularFile(file, MAX_ARCHIVE_BYTES), password);
  const destination = resolve(target);
  await mkdir(destination, { mode: 0o700 }); // EEXIST is deliberately fatal.
  try {
    for (const entry of manifest.files) {
      const path = join(destination, entry.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, entry.content, { mode: 0o600, flag: 'wx' });
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
  return {
    files: manifest.files.length,
    datasetIds: manifest.files.filter((f) => f.path.startsWith('research/')).map((f) => f.path.slice(18, -5)),
  };
}
