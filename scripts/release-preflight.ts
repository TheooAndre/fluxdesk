import { lstat, readFile } from 'node:fs/promises';
import { releasePreflight } from '../server/release-preflight.ts';
try {
  const path = process.argv[2];
  if (!path || process.argv.length !== 3) throw Error();
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > 262144) throw Error();
  const report = releasePreflight(JSON.parse(await readFile(path, 'utf8')));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.configurationReady ? 0 : 1;
} catch {
  console.error('Supply one regular metadata JSON file (maximum 256 KiB). Never include secret values.');
  process.exitCode = 2;
}
