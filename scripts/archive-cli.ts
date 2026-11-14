import { lstat, readFile } from 'node:fs/promises';
import { createArchive, restoreArchive, verifyArchive } from '../server/archive.ts';

async function main(args: string[]) {
  const options = { requireJournal: false, requireAccounts: false, requireInvestments: false };
  const flags = {
    '--require-journal': 'requireJournal',
    '--require-accounts': 'requireAccounts',
    '--require-investments': 'requireInvestments',
  } as const;
  while (args.at(-1) && args.at(-1)! in flags) {
    const key = flags[args.at(-1)! as keyof typeof flags];
    if (options[key]) throw Error('Duplicate backup requirement');
    options[key] = true;
    args = args.slice(0, -1);
  }
  const [command, source, targetOrFlag, flagOrPassword, passwordFile] = args;
  const verify = command === 'verify' && args.length === 4 && targetOrFlag === '--password-file';
  const mutate =
    ['backup', 'restore'].includes(command ?? '') &&
    args.length === 5 &&
    flagOrPassword === '--password-file';
  if (!source || !(verify || mutate))
    throw Error(
      'Usage: pnpm archive backup <data-dir> <new-file.fdbackup> --password-file <private-file> [--require-journal] [--require-accounts] [--require-investments]\n   or: pnpm archive verify <file.fdbackup> --password-file <private-file> [--require-journal] [--require-accounts] [--require-investments]\n   or: pnpm archive restore <file.fdbackup> <new-empty-directory> --password-file <private-file> [--require-journal] [--require-accounts] [--require-investments]',
    );
  const path = verify ? flagOrPassword! : passwordFile!;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1026 || (info.mode & 0o077) !== 0)
    throw Error('Password file must be a small private regular file (chmod 600)');
  const password = (await readFile(path, 'utf8')).replace(/\r?\n$/, '');
  const result = verify
    ? await verifyArchive(source, password, options)
    : command === 'backup'
      ? await createArchive(source, targetOrFlag!, password, options)
      : await restoreArchive(source, targetOrFlag!, password, options);
  console.log(JSON.stringify({ operation: command, verified: true, ...result }, null, 2));
}
main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Archive operation failed');
  process.exitCode = 1;
});
