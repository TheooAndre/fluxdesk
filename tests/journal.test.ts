import { afterEach, it, expect, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newTrade,
  legMetrics,
  tradeMetrics,
  journalAnalytics,
  validateTrade,
  validateJournal,
  type JournalTrade,
} from '../src/journal/model.ts';
import { saveTrade, readJournal, saveDay, removeTrade, importJournal } from '../server/journal.ts';
import { createArchive, restoreArchive } from '../server/archive.ts';
import { csvRows, importJournalFile, CSV_HEADER, exportSummaryCsv } from '../src/journal/files.ts';
let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = '';
  vi.unstubAllEnvs();
});
async function setup() {
  dir = await mkdtemp(join(tmpdir(), 'fluxdesk-journal-'));
  vi.stubEnv('DATA_DIR', join(dir, 'data'));
}
const fill = (kind: 'entry' | 'exit', quantity: number, price: number, time: number, feeUsd = 0) => ({
  id: String(time),
  kind,
  quantity,
  price,
  time: new Date(Date.UTC(2026, 9, 24, 10) + time * 60000).toISOString(),
  feeUsd,
});
const trade = () => {
  const t = newTrade('2026-10-24');
  t.title = 'BTC trend';
  t.riskUsd = 50;
  t.legs[0]!.fills = [
    fill('entry', 1, 100, 1, 1),
    fill('entry', 1, 120, 2, 1),
    fill('exit', 1, 130, 3, 1),
    fill('exit', 1, 120, 4, 1),
  ];
  return t;
};
it('handles scale-in/out average cost, signed funding, rebates and risk-normalized P&L', () => {
  const t = trade();
  t.fundingUsd = -2;
  t.otherCostsUsd = 1;
  expect(tradeMetrics(t)).toMatchObject({ status: 'closed', gross: 30, fees: 4, net: 23, rMultiple: 0.46 });
  t.legs[0]!.leverage = 100;
  expect(tradeMetrics(t).net).toBe(23);
  t.legs[0]!.fills[0]!.feeUsd = -1;
  expect(tradeMetrics(t).net).toBe(25);
});
it('honors chronological average cost when entries occur after partial exits and supports shorts/tiny units', () => {
  const t = trade();
  t.legs[0]!.fills = [
    fill('entry', 1, 100, 1),
    fill('exit', 0.5, 120, 2),
    fill('entry', 1, 200, 3),
    fill('exit', 1.5, 180, 4),
  ];
  expect(legMetrics(t.legs[0]!).gross).toBeCloseTo(30);
  t.legs[0]!.direction = 'short';
  expect(legMetrics(t.legs[0]!).gross).toBeCloseTo(-30);
  t.legs[0]!.fills = [fill('entry', 1e-12, 100, 1), fill('exit', 1e-12, 110, 2)];
  expect(tradeMetrics(t).status).toBe('closed');
  expect(Number.isFinite(tradeMetrics(t).net)).toBe(true);
});
it('excludes planned and partial positions from closed analytics and aggregates multi-leg net', () => {
  const planned = newTrade(),
    open = trade();
  open.legs[0]!.fills.pop();
  const closed = trade();
  closed.legs.push({
    ...closed.legs[0]!,
    direction: 'short',
    fills: [fill('entry', 1, 200, 1), fill('exit', 1, 180, 5)],
  });
  expect(tradeMetrics(closed).net).toBe(46);
  expect(journalAnalytics([planned, open, closed])).toMatchObject({
    count: 1,
    net: 46,
    winRate: 1,
    profitFactor: null,
  });
});
it('validates oversells, dates, spot shorts, unsafe links and nonfinite values', () => {
  for (const mutate of [
    (t: JournalTrade) => {
      t.date = '2026-02-30';
    },
    (t: JournalTrade) => {
      t.legs[0]!.fills[2]!.quantity = 3;
    },
    (t: JournalTrade) => {
      t.screenshotUrls = ['javascript:alert(1)'];
    },
    (t: JournalTrade) => {
      t.fundingUsd = NaN;
    },
    (t: JournalTrade) => {
      t.legs[0]!.instrument = 'spot';
      t.legs[0]!.direction = 'short';
    },
  ]) {
    const t = trade();
    mutate(t);
    expect(() => validateTrade(t)).toThrow();
  }
});
it('persists across reads and detects edit/delete conflicts without losing the prior trade', async () => {
  await setup();
  const { trade: saved } = await saveTrade(trade());
  expect((await readJournal()).trades[0]).toEqual(saved);
  await saveTrade({ ...saved, title: 'updated' });
  await expect(saveTrade({ ...saved, title: 'stale' })).rejects.toMatchObject({ status: 409 });
  await expect(removeTrade(saved.id, saved.revision)).rejects.toMatchObject({ status: 409 });
  expect((await readJournal()).trades[0]!.title).toBe('updated');
  await removeTrade(saved.id, 2);
  expect((await readJournal()).trades).toEqual([]);
});
it('serializes concurrent writes, preserves daily revision checks, and imports atomically/deduplicates', async () => {
  await setup();
  const [a, b] = await Promise.all([saveTrade(trade()), saveTrade({ ...trade(), title: 'second' })]);
  expect((await readJournal()).trades).toHaveLength(2);
  await saveDay({
    date: '2026-10-24',
    revision: 0,
    plan: 'Focus',
    review: '',
    mood: 'calm',
    lessons: '',
    updatedAt: 0,
  });
  await expect(
    saveDay({
      date: '2026-10-24',
      revision: 0,
      plan: 'stale',
      review: '',
      mood: '',
      lessons: '',
      updatedAt: 0,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const exported = await readJournal();
  expect(await importJournal(exported)).toEqual({ imported: 0, skipped: 3 });
  const changed = { ...a.trade, title: 'bad' };
  await expect(
    importJournal({ schemaVersion: 1, trades: [{ ...b.trade, id: 'new-id' }, changed], days: [] }),
  ).rejects.toThrow('conflicts');
  expect((await readJournal()).trades).toHaveLength(2);
});
it('includes the journal in encrypted backup and validates its isolated restore', async () => {
  await setup();
  await saveTrade(trade());
  const before = await readJournal();
  const file = join(dir, 'backup.fdbackup'),
    target = join(dir, 'restored');
  await createArchive(join(dir, 'data'), file, 'test-private-journal-password');
  await restoreArchive(file, target, 'test-private-journal-password');
  expect(validateJournal(JSON.parse(await readFile(join(target, 'journal.json'), 'utf8')))).toEqual(before);
});
it('imports deterministic CSV entries and handles quoted newlines and spreadsheet-safe exports', async () => {
  const values = [
    '2026-10-24',
    'binance:BTCUSDT',
    'linear_perp',
    'long',
    '2026-10-24T10:00:00Z',
    '2026-10-24T11:00:00Z',
    '100',
    '110',
    '1',
    '1',
    '1',
    '-2',
    '10',
    'Main',
    'trend',
    'tag',
    'notes',
  ];
  const raw = CSV_HEADER.join(',') + '\n' + values.join(',');
  const a = await importJournalFile(raw, 'trades.csv'),
    b = await importJournalFile(raw, 'trades.csv');
  expect(a.trades[0]!.id).toBe(b.trades[0]!.id);
  expect(tradeMetrics(a.trades[0]!).net).toBe(6);
  expect(csvRows('a,b\n"line\n2","quote""here"')).toEqual([
    ['a', 'b'],
    ['line\n2', 'quote"here'],
  ]);
  expect(exportSummaryCsv([{ ...trade(), title: '=FORMULA' }])).toContain("'=FORMULA");
});

it('groups user labels safely and retains manual excursion observations', () => {
  const t = trade();
  t.strategy = '__proto__';
  t.account = 'constructor';
  t.tags = ['tag', 'tag'];
  t.mistakes = ['FOMO'];
  t.mfeUsd = 100;
  t.maeUsd = 20;
  expect(validateTrade(t).mfeUsd).toBe(100);
  const stats = journalAnalytics([t]);
  expect(stats.byStrategy[0]).toMatchObject({ name: '__proto__', count: 1, net: 26 });
  expect(stats.byAccount[0]!.name).toBe('constructor');
  expect(stats.byTags[0]!.count).toBe(1);
  expect(stats.rulesFollowedRate).toBe(1);
});

it('recovers the mutation queue after a failed read without reporting a false save', async () => {
  await setup();
  await saveTrade(trade());
  const before = await readJournal();
  await writeFile(join(dir, 'data', 'journal.json'), '{bad');
  await expect(saveTrade({ ...trade(), title: 'must not save' })).rejects.toThrow();
  await writeFile(join(dir, 'data', 'journal.json'), JSON.stringify(before));
  await saveTrade({ ...trade(), title: 'recovered' });
  expect((await readJournal()).trades).toHaveLength(2);
});
