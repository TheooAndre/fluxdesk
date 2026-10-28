import { afterEach, expect, it } from 'vitest';
import { createCipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { createArchive, restoreArchive, verifyArchive } from '../server/archive.ts';
import { loadHistoricalDataset, saveHistoricalDataset } from '../server/research/datasets.ts';

const password = 'test-only-private-backup-password';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fluxdesk-backup-'));
  roots.push(root);
  const source = join(root, 'source');
  await mkdir(source);
  await writeFile(join(source, 'state.json'), JSON.stringify({ alerts: [], events: [], subscriptions: [] }));
  await writeFile(
    join(source, 'watchlist.json'),
    JSON.stringify({ schemaVersion: 1, assetIds: ['hyperliquid:BTC', 'binance:ETHUSDT'] }),
  );
  await writeFile(join(source, '.env'), 'FLUXDESK_GATEWAY_TOKEN=never-copy-this-secret');
  await writeFile(join(source, '.fluxdesk-volume-id'), 'never-restore-provider-volume-identity');
  const receipt = await saveHistoricalDataset(
    {
      schemaVersion: 1,
      assetId: 'binance:BTCUSDT',
      venue: 'binance',
      interval: '1h',
      capturedAt: 90 * 3600_000,
      candles: Array.from({ length: 80 }, (_, i) => ({
        time: i * 3600_000,
        closeTime: (i + 1) * 3600_000 - 1,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volumeBase: 1,
        volumeUsd: 100,
      })),
    },
    join(source, 'research', 'datasets'),
  );
  return { root, source, receipt, file: join(root, 'backup.fdbackup'), target: join(root, 'restored') };
}
// Construct authenticated hostile payloads to exercise restore validation before
// any filesystem writes. This is not an exported application archive encoder.
function hostileArchive(raw: string): Buffer {
  const header = Buffer.from('FDARCHIVE1'),
    salt = randomBytes(16),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(password, salt, 32), iv);
  cipher.setAAD(header);
  const content = Buffer.concat([cipher.update(gzipSync(raw)), cipher.final()]);
  return Buffer.concat([header, salt, iv, cipher.getAuthTag(), content]);
}
it('round-trips encrypted app state/watchlist/datasets and preserves the original dataset ID', async () => {
  const f = await fixture();
  const result = await createArchive(f.source, f.file, password);
  expect(result).toMatchObject({ files: 3, datasetIds: [f.receipt.id],
    filePaths: [`research/datasets/${f.receipt.id}.json`, 'state.json', 'watchlist.json'],
    createdAt: expect.any(Number),
    archiveSha256: createHash('sha256').update(await readFile(f.file)).digest('hex'),
  });
  expect((await stat(f.file)).mode & 0o777).toBe(0o600);
  expect((await readFile(f.file)).includes(Buffer.from('never-copy-this-secret'))).toBe(false);
  expect(await verifyArchive(f.file, password)).toEqual(result);
  expect(await restoreArchive(f.file, f.target, password)).toEqual(result);
  expect(await readdir(f.target)).toEqual(['research', 'state.json', 'watchlist.json']);
  expect((await stat(f.target)).mode & 0o777).toBe(0o700);
  const restored = await loadHistoricalDataset(f.receipt.id, join(f.target, 'research', 'datasets'));
  expect(restored.assetId).toBe('binance:BTCUSDT');
  expect(await readFile(join(f.target, 'watchlist.json'), 'utf8')).toBe(
    await readFile(join(f.source, 'watchlist.json'), 'utf8'),
  );
  const second = join(f.root, 'second.fdbackup');
  await createArchive(f.source, second, password);
  expect(await readFile(second)).not.toEqual(await readFile(f.file));
});
it('requires the journal before writing a backup or restore and reports identical authenticated receipts', async () => {
  const f = await fixture();
  const options = { requireJournal: true };
  await expect(createArchive(f.source, f.file, password, options)).rejects.toThrow('required journal.json');
  await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
  // Legacy archives remain readable, but cannot pass the new recovery requirement.
  await createArchive(f.source, f.file, password);
  await expect(verifyArchive(f.file, password, options)).rejects.toThrow('required journal.json');
  await expect(restoreArchive(f.file, f.target, password, options)).rejects.toThrow('required journal.json');
  await expect(stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(join(f.source, 'journal.json'), JSON.stringify({ schemaVersion: 1, trades: [], days: [] }));
  const current = join(f.root, 'with-journal.fdbackup');
  const result = await createArchive(f.source, current, password, options);
  expect(result.filePaths).toContain('journal.json');
  expect(result.archiveSha256).toBe(createHash('sha256').update(await readFile(current)).digest('hex'));
  expect(await verifyArchive(current, password, options)).toEqual(result);
  expect(await restoreArchive(current, f.target, password, options)).toEqual(result);
  expect(await readFile(join(f.target, 'journal.json'), 'utf8')).toBe(await readFile(join(f.source, 'journal.json'), 'utf8'));
});
it('rejects wrong passwords, corruption and short passwords without creating a restore directory', async () => {
  const f = await fixture();
  await createArchive(f.source, f.file, password);
  await expect(restoreArchive(f.file, f.target, 'wrong-private-password')).rejects.toThrow(
    'authentication failed',
  );
  const bytes = await readFile(f.file);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  await writeFile(f.file, bytes);
  await expect(restoreArchive(f.file, f.target, password)).rejects.toThrow('authentication failed');
  await expect(stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(createArchive(f.source, join(f.root, 'short.fdbackup'), 'short')).rejects.toThrow('password');
});
it('refuses to replace an existing backup or merge into an existing directory', async () => {
  const f = await fixture();
  await createArchive(f.source, f.file, password);
  const original = await readFile(f.file);
  await expect(createArchive(f.source, f.file, password)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(f.file)).toEqual(original);
  await mkdir(f.target);
  await writeFile(join(f.target, 'preserve-me'), 'valuable');
  await expect(restoreArchive(f.file, f.target, password)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(join(f.target, 'preserve-me'), 'utf8')).toBe('valuable');
});
it.each([
  '../outside.json',
  '/tmp/outside.json',
  'research/datasets/../../state.json',
  '.env',
  '.fluxdesk-volume-id',
])('rejects authenticated unsafe/secret path %s before writing', async (path) => {
  const f = await fixture();
  const content = '{}';
  await writeFile(
    f.file,
    hostileArchive(
      JSON.stringify({
        schemaVersion: 1,
        createdAt: 1,
        files: [{ path, content, sha256: createHash('sha256').update(content).digest('hex') }],
      }),
    ),
  );
  await expect(restoreArchive(f.file, f.target, password)).rejects.toThrow('path or checksum');
  await expect(stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects a gzip expansion beyond the output budget', async () => {
  const f = await fixture();
  await writeFile(f.file, hostileArchive(' '.repeat(16 * 1024 * 1024 + 1)));
  await expect(restoreArchive(f.file, f.target, password)).rejects.toThrow();
  await expect(stat(f.target)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects corrupt datasets and symlink inputs rather than following them into a backup', async () => {
  const f = await fixture();
  const file = join(f.source, 'research', 'datasets', f.receipt.id + '.json');
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace('"close":101', '"close":100'));
  await expect(createArchive(f.source, f.file, password)).rejects.toThrow('fingerprint mismatch');
  await writeFile(file, text);
  await rm(join(f.source, 'watchlist.json'));
  await symlink(join(f.source, '.env'), join(f.source, 'watchlist.json'));
  await expect(createArchive(f.source, f.file, password)).rejects.toThrow('regular file');
});
it('CLI verifies with a private password file and never logs its contents', async () => {
  const f = await fixture();
  await createArchive(f.source, f.file, password);
  const passwordFile = join(f.root, 'private-password');
  await writeFile(passwordFile, password + '\n', { mode: 0o600 });
  const run = promisify(execFile);
  const result = await run(process.execPath, [
    '--import',
    'tsx',
    'scripts/archive-cli.ts',
    'verify',
    f.file,
    '--password-file',
    passwordFile,
  ]);
  expect(JSON.parse(result.stdout)).toMatchObject({ verified: true, files: 3, datasetIds: [f.receipt.id] });
  expect(result.stdout + result.stderr).not.toContain(password);
  await expect(run(process.execPath, ['--import', 'tsx', 'scripts/archive-cli.ts', 'verify',
    f.file, '--password-file', passwordFile, '--require-journal']))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('required journal.json') });
  await chmod(passwordFile, 0o644);
  await expect(
    run(process.execPath, [
      '--import',
      'tsx',
      'scripts/archive-cli.ts',
      'verify',
      f.file,
      '--password-file',
      passwordFile,
    ]),
  ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('chmod 600') });
});
