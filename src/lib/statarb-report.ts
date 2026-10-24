/** Untrusted offline research imports: bounded, reconstructed, never authorization. */
export type StatArbFold = {
  start: string; end: string; bars: number; selectedPairs: string[];
  sharpe: number | null; maxDrawdown: number; trades: number;
};
export type StatArbEvaluation = {
  sharpe: number | null; maxDrawdown: number; trades: number;
  costFraction: number; fundingFraction: number; trialsSearched: number;
  deflatedSharpe: null; folds: StatArbFold[];
};
export type StatArbReport = {
  schemaVersion: 1; engine: 'crypto-statarb-research@0.2.0';
  fingerprint: string; datasetHash: string | null; synthetic: boolean; venue: string;
  fundingComplete: boolean; pointInTimeUniverse: boolean; holdoutOpened: boolean;
  config: Record<string, number | boolean>;
  development: StatArbEvaluation; holdout: StatArbEvaluation | null;
};
export const MAX_STATARB_BYTES = 1_048_576;
const fail = (): never => { throw Error('Invalid stat-arb report. Export a complete research report using export_terminal.py.'); };
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function bool(v: unknown): boolean { return typeof v === 'boolean' ? v : fail(); }
function text(v: unknown, max = 120): string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !Array.from(v).some(c => c.charCodeAt(0) < 32) ? v : fail();
}
function number(v: unknown, min = -1e12, max = 1e12): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail();
}
function integer(v: unknown): number { const n = number(v, 0, 10_000_000); return Number.isSafeInteger(n) ? n : fail(); }
const nullable = (v: unknown) => v === null ? null : number(v);
function hash(v: unknown): string { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail(); }
function timestamp(v: unknown): string {
  const s = text(v, 40);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(s) && Number.isFinite(Date.parse(s)) ? s : fail();
}
function evaluation(value: unknown): StatArbEvaluation {
  const v = object(value);
  if (!Array.isArray(v.folds) || !v.folds.length || v.folds.length > 240 || v.deflatedSharpe !== null) return fail();
  let previous = -Infinity;
  const folds = v.folds.map((raw): StatArbFold => {
    const f = object(raw), start = timestamp(f.start), end = timestamp(f.end);
    if (Date.parse(start) <= previous || Date.parse(end) < Date.parse(start)) return fail();
    previous = Date.parse(end);
    if (!Array.isArray(f.selectedPairs) || f.selectedPairs.length > 50) return fail();
    const bars = integer(f.bars);
    if (bars < 3) return fail();
    return { start, end, bars, selectedPairs: f.selectedPairs.map(x => text(x)),
      sharpe: nullable(f.sharpe), maxDrawdown: number(f.maxDrawdown, -1, 0), trades: integer(f.trades) };
  });
  return { sharpe: nullable(v.sharpe), maxDrawdown: number(v.maxDrawdown, -1, 0), trades: integer(v.trades),
    costFraction: number(v.costFraction, 0), fundingFraction: number(v.fundingFraction),
    trialsSearched: integer(v.trialsSearched), deflatedSharpe: null, folds };
}
export function parseStatArbReport(input: string): StatArbReport {
  if (new TextEncoder().encode(input).length > MAX_STATARB_BYTES) throw Error('Stat-arb reports must be 1 MiB or smaller.');
  let parsed: unknown;
  try { parsed = JSON.parse(input); } catch { return fail(); }
  const v = object(parsed);
  if (v.schemaVersion !== 1 || v.engine !== 'crypto-statarb-research@0.2.0') return fail();
  const config = object(v.config), entries = Object.entries(config);
  if (!entries.length || entries.length > 40) return fail();
  const cleanConfig = Object.fromEntries(entries.map(([k, val]) => {
    if (!/^[a-z][a-z0-9_]{0,50}$/.test(k)) return fail();
    return [k, typeof val === 'boolean' ? val : number(val)];
  }));
  for (const key of ['timeframe_hours', 'formation_bars', 'test_bars', 'z_window', 'beta_refit_bars', 'entry_z', 'exit_z', 'stop_z', 'max_holding_bars', 'holdout_fraction']) {
    if (typeof cleanConfig[key] !== 'number' || cleanConfig[key] <= 0) return fail();
  }
  if (!(Number(cleanConfig.exit_z) < Number(cleanConfig.entry_z) && Number(cleanConfig.entry_z) < Number(cleanConfig.stop_z)) || Number(cleanConfig.holdout_fraction) >= 0.5) return fail();
  const holdoutOpened = bool(v.holdoutOpened), development = evaluation(v.development);
  const holdout = v.holdout === null ? null : evaluation(v.holdout);
  if (holdoutOpened !== !!holdout) return fail();
  if (holdout && Date.parse(holdout.folds[0]!.start) <= Date.parse(development.folds.at(-1)!.end)) return fail();
  return { schemaVersion: 1, engine: v.engine, fingerprint: hash(v.fingerprint), datasetHash: v.datasetHash === null ? null : hash(v.datasetHash),
    synthetic: bool(v.synthetic), venue: text(v.venue, 60), fundingComplete: bool(v.fundingComplete),
    pointInTimeUniverse: bool(v.pointInTimeUniverse), holdoutOpened, config: cleanConfig, development, holdout };
}
