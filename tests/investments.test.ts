import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { investmentCsv, parseInvestmentImport, validateInvestments } from '../src/investments/model.ts';
import { readInvestments, saveInvestments } from '../server/investments.ts';
import { createArchive, restoreArchive } from '../server/archive.ts';
import * as stocks from '../server/stock-data.ts';
import { stockDataFixture } from './fixtures/stock-data.ts';
import { investmentFixture } from './fixtures/investments.ts';
let directory = '';
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

it('accepts global listings, numeric tickers and explicit reference listings without mixing currencies', () => {
  const data = investmentFixture(),
    p = data.portfolios[0]!;
  p.stocks.push({
    ...p.stocks[0]!,
    id: 'japan-stock',
    symbol: '7203',
    exchange: 'TSE',
    country: 'Japan',
    currency: 'JPY',
    referenceSymbol: 'TSE:7203',
  });
  const checked = validateInvestments(data);
  expect(checked.portfolios[0]?.stocks.map((s) => s.currency)).toEqual(['USD', 'JPY']);
  expect(checked.portfolios[0]?.stocks[1]?.country).toBe('Japan');
});

it('bounds allocations and rejects non-finite values, duplicate listings, invalid dates and unsafe URLs', () => {
  for (const value of [NaN, Infinity, -1, 101]) {
    const data = investmentFixture();
    data.portfolios[0]!.stocks[0]!.targetWeight = value;
    expect(() => validateInvestments(data)).toThrow('weight');
  }
  const data = investmentFixture(),
    p = data.portfolios[0]!;
  p.stocks.push({ ...p.stocks[0]!, id: 'second' });
  expect(() => validateInvestments(data)).toThrow('already');
  p.stocks[1]!.symbol = 'OTHER';
  p.stocks[1]!.targetWeight = 99;
  expect(() => validateInvestments(data)).toThrow('100%');
  p.stocks[1]!.archived = true;
  expect(validateInvestments(data).portfolios[0]!.stocks).toHaveLength(2);
  p.stocks[0]!.reviewedAt = '2026-02-30';
  expect(() => validateInvestments(data)).toThrow('date');
  p.stocks[0]!.reviewedAt = '';
  p.stocks[0]!.brokerUrl = 'javascript:alert(1)';
  expect(() => validateInvestments(data)).toThrow('HTTPS');
  p.stocks[0]!.brokerUrl = 'https://secret@example.com';
  expect(() => validateInvestments(data)).toThrow('credentials');
  p.stocks[0]!.brokerUrl = '';
  p.stocks[0]!.referenceSymbol = 'NASDAQ:<script>';
  expect(() => validateInvestments(data)).toThrow('reference');
});

it('imports legacy MCGA JSON without executing HTML or presenting historical research as current', () => {
  const row = {
    name: 'Example China Co',
    symbol: 'TEST',
    market: 'Gettex',
    theme: 'Infrastructure',
    weight: 4,
    status: 'Hold',
    tv: 'HKEX:1234',
    link: 'https://example.com/invest/TEST',
    thesis: 'Historical hypothesis',
    trigger: 'Demand',
    fail: 'Cash burn',
    risks: 'Execution',
    metrics: 'Historical metric',
    news: 'Old news',
  };
  const [p] = parseInvestmentImport(
    `<script>throw new Error('must not execute'); const STOCKS=${JSON.stringify([row])};</script>`,
  );
  expect(p).toMatchObject({
    researchAsOf: '2026-10-19',
    stocks: [
      {
        currency: 'EUR',
        country: 'China',
        targetWeight: 4,
        reviewedAt: '2026-10-19',
        thesis: row.thesis,
        catalysts: row.trigger,
        invalidation: row.fail,
      },
    ],
  });
  expect(parseInvestmentImport(JSON.stringify(investmentFixture()))).toHaveLength(1);
  expect(() => parseInvestmentImport('const STOCKS=[runCode()];')).toThrow();
  expect(() => parseInvestmentImport('x'.repeat(1024 * 1024 + 1))).toThrow('1 MiB');
});

it('escapes CSV formulas and retains the listing, weight, status and research notes', () => {
  const data = investmentFixture(),
    p = data.portfolios[0]!;
  p.stocks[0]!.name = '=UNSAFE()';
  p.stocks[0]!.notes = 'Comma, quote " and\nnewline';
  const csv = investmentCsv(p);
  expect(csv).toContain('"\'=UNSAFE()"');
  expect(csv).toContain('"Comma, quote "" and\nnewline"');
  expect(csv).toContain('"NASDAQ","United States","USD"');
});

it('persists atomically, rejects stale concurrent edits, and includes private investments in encrypted restore', async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-investments-'));
  vi.stubEnv('DATA_DIR', directory);
  expect((await readInvestments()).revision).toBe(0);
  const results = await Promise.allSettled([
    saveInvestments(investmentFixture()),
    saveInvestments(investmentFixture()),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
  const saved = await readInvestments();
  expect(saved.revision).toBe(1);
  expect((await stat(join(directory, 'investments.json'))).mode & 0o777).toBe(0o600);
  const file = join(directory, 'private.fdbackup'),
    restored = join(directory, 'isolated-restore');
  const receipt = await createArchive(directory, file, 'synthetic-private-password');
  expect(receipt.filePaths).toEqual(['investments.json']);
  expect((await readFile(file)).includes(Buffer.from('Synthetic private memo'))).toBe(false);
  await restoreArchive(file, restored, 'synthetic-private-password');
  expect(JSON.parse(await readFile(join(restored, 'investments.json'), 'utf8'))).toEqual(saved);
  const changed = structuredClone(saved);
  changed.portfolios[0]!.stocks[0]!.notes = 'Second device edit';
  expect((await saveInvestments(changed)).revision).toBe(2);
  await expect(saveInvestments(saved)).rejects.toMatchObject({ status: 409 });
  expect((await readInvestments()).portfolios[0]!.stocks[0]!.notes).toBe('Second device edit');
});

it('verifies newly linked listings before saving and preserves research and revisions on provider failure', async () => {
  directory = await mkdtemp(join(tmpdir(), 'fluxdesk-stock-link-'));
  vi.stubEnv('DATA_DIR', directory);
  const original = investmentFixture();
  await saveInvestments(original);
  const changed = await readInvestments();
  changed.portfolios[0]!.stocks[0]!.marketSymbol = '7203.T';
  const provider = vi.spyOn(stocks, 'stockData').mockRejectedValue(new Error('Provider unavailable'));
  await expect(saveInvestments(changed)).rejects.toThrow('Provider unavailable');
  expect((await readInvestments()).revision).toBe(1);
  provider.mockResolvedValue(stockDataFixture());
  const saved = await saveInvestments(changed);
  expect(saved.portfolios[0]!.stocks[0]).toMatchObject({
    marketSymbol: '7203.T',
    thesis: 'Synthetic private memo',
  });
  expect((await readInvestments()).portfolios[0]!.stocks[0]!.marketSymbol).toBe('7203.T');
  provider.mockClear();
  saved.portfolios[0]!.stocks[0]!.notes = 'Updated memo';
  await saveInvestments(saved);
  expect(provider).not.toHaveBeenCalled();
});
