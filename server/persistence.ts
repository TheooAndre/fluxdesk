import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * A single-process API must not write precious alerts and candle snapshots to
 * a disposable container layer. We require an explicit Linux mount at DATA_DIR
 * when running behind the cloud gateway.
 *
 * /proc/self/mountinfo is supplied by Linux. Kubernetes and Docker mount an
 * attached named/persistent volume at /data. Check the exact mount point,
 * rather than relying only on existence of a writable /data directory that
 * might have been baked into an image.
 */
export function hasMountAt(
  mountinfo: string,
  directory: string,
): boolean {
  const path = resolve(directory);
  return mountinfo.split('\n').some((line) => {
    const fields = line.split(' ');
    if (fields.length < 6) return false;
    // Mount points in /proc/self/mountinfo escape spaces and backslashes.
    const mount = fields[4]!
      .replace(/\\040/g, ' ')
      .replace(/\\011/g, '\t')
      .replace(/\\012/g, '\n')
      .replace(/\\134/g, '\\');
    return mount === path;
  });
}

export async function assertDurableDataDirectory(
  config: {
    directory?: string;
    requireMount?: boolean;
    mountinfoPath?: string;
  } = {},
): Promise<void> {
  const raw = config.directory ?? process.env.DATA_DIR;
  if (!raw || !isAbsolute(raw))
    throw Error('Cloud backend requires an absolute DATA_DIR path');
  const directory = resolve(raw);
  if (directory === '/' || directory === '/tmp' || directory === '/app')
    throw Error('Unsafe cloud DATA_DIR');
  if (config.requireMount ?? true) {
    let mountinfo: string;
    try {
      mountinfo = await readFile(config.mountinfoPath ?? '/proc/self/mountinfo', 'utf8');
    } catch {
      throw Error('Cannot verify the persistent data volume is mounted');
    }
    if (!hasMountAt(mountinfo, directory))
      throw Error('Persistent volume missing at DATA_DIR; refusing to start');
  }

  // Confirm non-root runtime can write before starting background scanners.
  await mkdir(directory, { recursive: true });
  const probe = resolve(directory, '.fluxdesk-write-' + randomUUID());
  try {
    await writeFile(probe, 'ok', { flag: 'wx', mode: 0o600 });
  } catch {
    throw Error('Cloud data directory is not writable');
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}
