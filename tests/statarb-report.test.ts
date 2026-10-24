import { describe, expect, it } from 'vitest';
import demo from '../src/research/statarb-demo.json';
import { parseStatArbReport } from '../src/lib/statarb-report.ts';
const encode = (v: unknown) => JSON.stringify(v);
describe('stat-arb offline report boundary', () => {
  it('retains all original synthetic folds and abstentions without paper permission', () => {
    const result = parseStatArbReport(encode(demo));
    expect(result.synthetic).toBe(true);
    expect(result.development.folds).toHaveLength(4);
    expect(result.development.folds.filter(f => !f.selectedPairs.length)).toHaveLength(3);
    expect(result.development.trialsSearched).toBe(6);
    expect(result.holdout).toBeNull();
    expect(result.development.deflatedSharpe).toBeNull();
    expect(result).not.toHaveProperty('live_permission');
  });
  it.each([
    { ...demo, synthetic: 'false' },
    { ...demo, fundingComplete: 'true' },
    { ...demo, fingerprint: 'bad' },
    { ...demo, holdoutOpened: true },
    { ...demo, config: { ...demo.config, stop_z: 1 } },
    { ...demo, development: { ...demo.development, sharpe: 'Infinity' } },
    { ...demo, development: { ...demo.development, deflatedSharpe: 5 } },
    { ...demo, development: { ...demo.development, folds: Array(241).fill(demo.development.folds[0]) } },
  ])('rejects malformed reports and unsupported claims', input => {
    expect(() => parseStatArbReport(encode(input))).toThrow();
  });
  it('rejects overlapping development folds and overlapping final holdout', () => {
    const result = structuredClone(demo);
    result.development.folds[1]!.start = result.development.folds[0]!.start;
    expect(() => parseStatArbReport(encode(result))).toThrow();
    expect(() => parseStatArbReport(encode({ ...demo, holdoutOpened: true, holdout: demo.development }))).toThrow();
  });
  it('accepts a separate chronological holdout without authorizing it', () => {
    const holdout = { ...demo.development, folds: [{ ...demo.development.folds[0], start: '2024-01-01T00:00:00Z', end: '2024-01-30T20:00:00Z' }] };
    expect(parseStatArbReport(encode({ ...demo, holdoutOpened: true, holdout })).holdout?.folds).toHaveLength(1);
  });
  it('rejects oversized content before parsing and drops unknown fields', () => {
    expect(() => parseStatArbReport(' '.repeat(1_048_577))).toThrow(/1 MiB/);
    expect(parseStatArbReport(encode({ ...demo, liveReady: true }))).not.toHaveProperty('liveReady');
  });
});
