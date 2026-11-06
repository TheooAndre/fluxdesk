import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('loads the emitted Vercel gateway in native Node without a TypeScript resolver', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fluxdesk-gateway-emission-'));
  try {
    const configuration = ts.readConfigFile(resolve('tsconfig.json'), ts.sys.readFile);
    if (configuration.error) throw Error('Cannot read deployment compiler configuration');
    const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, process.cwd());
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const path of [
      'api/gateway.ts',
      'api/rate-limit.ts',
      'api/social-auth.ts',
      'server/account-policy.ts',
    ]) {
      const target = join(directory, path.replace(/\.ts$/, '.js'));
      await mkdir(dirname(target), { recursive: true });
      const compiled = ts.transpileModule(await readFile(resolve(path), 'utf8'), {
        compilerOptions: { ...parsed.options, noEmit: false },
        fileName: resolve(path),
      });
      await writeFile(target, compiled.outputText);
    }
    // A source-only tsx/Vitest import missed the hosted ERR_MODULE_NOT_FOUND:
    // Vercel emits .js helpers but native ESM cannot resolve a retained .ts suffix.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--input-type=module', '--eval', 'const gateway = await import("./api/gateway.js"); console.log(typeof gateway.default);'],
      { cwd: directory, timeout: 10_000 },
    );
    expect(stdout.trim()).toBe('function');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
