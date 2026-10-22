import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertDurableDataDirectory, hasMountAt } from '../server/persistence.ts';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = '';
});
const mountinfo = (mount: string) =>
  '111 100 0:90 / ' + mount.replaceAll(' ', '\\040') +
  ' rw,relatime - ext4 /dev/sda1 rw\n';

describe('cloud research archive mount safety', () => {
  it('detects the exact Linux mountpoint, not just a parent mount', () => {
    const mounts = mountinfo('/data') + mountinfo('/app');
    expect(hasMountAt(mounts, '/data')).toBe(true);
    expect(hasMountAt(mounts, '/data/research')).toBe(false);
    expect(hasMountAt(mounts, '/')).toBe(false);
  });
  it('decodes mountinfo paths with escaped spaces', () => {
    expect(hasMountAt(mountinfo('/data/my volume'), '/data/my volume')).toBe(true);
  });
  it('passes only when the declared volume is mounted and writable', async () => {
    root = await mkdtemp(join(tmpdir(), 'fluxdesk-mount-'));
    const location = join(root, 'research-store');
    const mountinfoFile = join(root, 'mountinfo');
    await writeFile(mountinfoFile, mountinfo(location));
    await expect(assertDurableDataDirectory({
      directory: location,
      mountinfoPath: mountinfoFile,
    })).resolves.toBeUndefined();
    expect(await readdir(location)).toEqual([]);
  });
  it('rejects missing mounts without creating a fake research directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'fluxdesk-ephemeral-'));
    const location = join(root, 'ephemeral');
    const mountinfoFile = join(root, 'mountinfo');
    await writeFile(mountinfoFile, mountinfo('/other'));
    await expect(assertDurableDataDirectory({
      directory: location, mountinfoPath: mountinfoFile,
    })).rejects.toThrow('Persistent volume missing');
    expect(await readdir(root)).toEqual(['mountinfo']);
  });
  it('rejects unsafe and relative directories', async () => {
    await expect(assertDurableDataDirectory({ directory: 'relative' })).rejects.toThrow('absolute');
    await expect(assertDurableDataDirectory({ directory: '/' })).rejects.toThrow('Unsafe');
  });
  it('rejects non-readable mount metadata', async () => {
    await expect(assertDurableDataDirectory({
      directory: '/data', mountinfoPath: '/nonexistent-mountinfo',
    })).rejects.toThrow('Cannot verify');
  });
});
