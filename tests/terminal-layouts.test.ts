import { describe, expect, it } from 'vitest';
import { readLayouts, writeLayouts, type TerminalLayout } from '../src/lib/terminal-layouts.ts';
const layout: TerminalLayout = {
  name: 'BTC',
  assetId: 'binance:BTCUSDT',
  benchmark: 'USD',
  tf: '6h',
  category: 'l1',
  venue: 'all',
  sort: 'volume',
  descending: true,
};
describe('saved terminal layouts', () => {
  it('round-trips the selected terminal settings', () => {
    expect(readLayouts(writeLayouts([layout]))).toEqual([layout]);
    expect(readLayouts(null)).toEqual([]);
  });
  it('rejects unsupported venue intervals instead of issuing an invalid query', () => {
    expect(() => writeLayouts([{ ...layout, assetId: 'hyperliquid:BTC' }])).toThrow();
  });
  it('rejects corrupt, future, duplicate and oversized storage', () => {
    for (const raw of ['{', JSON.stringify({ version: 2, layouts: [] }), 'x'.repeat(32769)])
      expect(() => readLayouts(raw)).toThrow();
    expect(() => writeLayouts([layout, { ...layout, name: 'btc' }])).toThrow();
    expect(() =>
      writeLayouts(Array.from({ length: 11 }, (_, i) => ({ ...layout, name: String(i) }))),
    ).toThrow();
  });
  it('rejects invalid contracts, filters and labels', () => {
    for (const patch of [
      { assetId: 'javascript:bad' },
      { benchmark: 'bad' },
      { category: 'guess' },
      { name: ' ' },
      { descending: 'true' },
    ]) {
      expect(() => writeLayouts([{ ...layout, ...patch } as TerminalLayout])).toThrow();
    }
  });
});
