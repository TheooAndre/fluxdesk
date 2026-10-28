import { lstat, readFile } from 'node:fs/promises';
import { createArchive, restoreArchive, verifyArchive } from '../server/archive.ts';

async function main(args: string[]) {
  const requireJournal = args.at(-1) === '--require-journal';
  if (requireJournal) args = args.slice(0, -1);
  const [command, source, targetOrFlag, flagOrPassword, passwordFile] = args;
  const verify = command === 'verify' && args.length === 4 && targetOrFlag === '--password-file';
  const mutate =
    ['backup', 'restore'].includes(command ?? '') &&
    args.length === 5 &&
    flagOrPassword === '--password-file';
  if (!source || !(verify || mutate))
    throw Error(
      'Usage: pnpm archive backup <data-dir> <new-file.fdbackup> --password-file <private-file> [--require-journal]\n   or: pnpm archive verify <file.fdbackup> --password-file <private-file> [--require-journal]\n   or: pnpm archive restore <file.fdbackup> <new-empty-directory> --password-file <private-file> [--require-journal]',
    );
  const path = verify ? flagOrPassword! : passwordFile!;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1026 || (info.mode & 0o077) !== 0)
    throw Error('Password file must be a small private regular file (chmod 600)');
  const password = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  const result = verify
    ? await verifyArchive(source, password, { requireJournal })
    : command === 'backup'
      ? await createArchive(source, targetOrFlag!, password, { requireJournal })
      : await restoreArchive(source, targetOrFlag!, password, { requireJournal });
  console.log(JSON.stringify({ operation: command, verified: true, ...result }, null, 2));
}
main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Archive operation failed');
  process.exitCode = 1;
});
