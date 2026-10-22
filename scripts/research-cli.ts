import { readFile } from 'node:fs/promises';
import { saveHistoricalDataset, type HistoricalDataset } from '../server/research/datasets.ts';
import { runStoredBacktest } from '../server/research/runner.ts';
import type { ResearchConfig } from '../src/engine/backtest.ts';

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function main(args: string[]) {
  const [command, argument, configPath] = args;
  if (command === 'import' && argument && !configPath) {
    const dataset = await readJson<HistoricalDataset>(argument);
    const receipt = await saveHistoricalDataset(dataset);
    console.log(JSON.stringify({ imported: true, dataset: receipt }, null, 2));
    return;
  }
  if (command === 'backtest' && argument && configPath && args.length === 3) {
    const config = await readJson<ResearchConfig>(configPath);
    const report = await runStoredBacktest(argument, config);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  throw Error(
    'Usage: pnpm research import ./dataset.json\n' +
    '   or: pnpm research backtest <sha256-dataset-id> ./config.json',
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Research command failed');
  process.exitCode = 1;
});
