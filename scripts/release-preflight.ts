import { lstat, readFile } from 'node:fs/promises';
import { releasePreflight, socialReleasePreflight } from '../server/release-preflight.ts';
try {
  const [path, mode] = process.argv.slice(2);
  if (!path || (mode !== undefined && !['--social-staging', '--social-live'].includes(mode)) ||
      process.argv.length > 4) throw Error();
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 262144) throw Error();
  const metadata: unknown = JSON.parse(await readFile(path, 'utf8'));
  const report = mode === '--social-staging' ? socialReleasePreflight(metadata, 'staging') :
    mode === '--social-live' ? socialReleasePreflight(metadata, 'live') : releasePreflight(metadata);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.configurationReady ? 0 : 1;
} catch {
  console.error('Supply one regular metadata JSON file (maximum 256 KiB) and optional --social-staging or --social-live. Never include secret values.');
  process.exitCode = 2;
}
