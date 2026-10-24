import { newTrade, validateJournal, type JournalData, type JournalTrade } from './model.ts';
export function downloadJson(name: string, value: unknown, compact = false) {
  const u = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, compact ? undefined : 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export const CSV_HEADER = [
  'date',
  'assetId',
  'instrument',
  'direction',
  'entryTime',
  'exitTime',
  'entryPrice',
  'exitPrice',
  'quantity',
  'entryFeeUsd',
  'exitFeeUsd',
  'fundingUsd',
  'riskUsd',
  'account',
  'strategy',
  'tags',
  'notes',
] as const;
export function csvRows(text: string) {
  if (text.length > 4 * 1024 * 1024) throw Error('Import limit is 4 MiB');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted || field === '') quoted = !quoted;
      else throw Error('Malformed CSV quote');
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw Error('Unclosed CSV quote');
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  if (rows.length > 2001) throw Error('Import limit is 2000 trades');
  return rows;
}
export async function importJournalFile(text: string, filename: string): Promise<JournalData> {
  if (text.length > 4 * 1024 * 1024) throw Error('Import limit is 4 MiB');
  if (filename.toLowerCase().endsWith('.json')) return validateJournal(JSON.parse(text));
  const rows = csvRows(text);
  const header = rows.shift();
  if (!header || CSV_HEADER.some((k) => !header.includes(k)))
    throw Error('Use the FluxDesk CSV template; exchange-specific CSV formats require mapping first.');
  if (new Set(header).size !== header.length) throw Error('Duplicate CSV columns');
  const trades: JournalTrade[] = [];
  for (const row of rows) {
    if (row.length !== header.length) throw Error('CSV column count does not match header');
    const o = Object.fromEntries(header.map((k, i) => [k, row[i]!])) as Record<
      (typeof CSV_HEADER)[number],
      string
    >;
    const t = newTrade(o.date, o.assetId);
    t.title = o.assetId + ' ' + o.direction;
    t.account = o.account || 'Main';
    t.strategy = o.strategy;
    t.tags = o.tags.split('|').filter(Boolean);
    t.review = o.notes;
    t.fundingUsd = Number(o.fundingUsd || 0);
    t.riskUsd = o.riskUsd ? Number(o.riskUsd) : null;
    t.legs[0]!.instrument = o.instrument as 'linear_perp' | 'spot';
    t.legs[0]!.direction = o.direction as 'long' | 'short';
    t.legs[0]!.fills = [
      {
        id: 'entry',
        kind: 'entry',
        time: o.entryTime,
        quantity: Number(o.quantity),
        price: Number(o.entryPrice),
        feeUsd: Number(o.entryFeeUsd || 0),
      },
    ];
    if (o.exitTime)
      t.legs[0]!.fills.push({
        id: 'exit',
        kind: 'exit',
        time: o.exitTime,
        quantity: Number(o.quantity),
        price: Number(o.exitPrice),
        feeUsd: Number(o.exitFeeUsd || 0),
      });
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(CSV_HEADER.map((k) => o[k]))),
    );
    t.id =
      'csv-' +
      Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    t.revision = 1;
    t.createdAt = Date.now();
    t.updatedAt = t.createdAt;
    trades.push(t);
  }
  return validateJournal({ schemaVersion: 1, trades, days: [] });
}
export function csvTemplate() {
  return CSV_HEADER.join(',') + '\n';
}
export function exportSummaryCsv(trades: JournalTrade[]) {
  const quote = (s: unknown) =>
    '"' +
    String(s ?? '')
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  return [
    ['date', 'title', 'account', 'strategy', 'assets', 'tags', 'fundingUsd', 'otherCostsUsd', 'review'],
    ...trades.map((t) => [
      t.date,
      t.title,
      t.account,
      t.strategy,
      t.legs.map((l) => l.assetId).join('|'),
      t.tags.join('|'),
      t.fundingUsd,
      t.otherCostsUsd,
      t.review,
    ]),
  ]
    .map((r) => r.map(quote).join(','))
    .join('\n');
}
export function downloadText(name: string, text: string) {
  const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
