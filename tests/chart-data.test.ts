import { describe, expect, it } from 'vitest';
import { prepareChartData, chartEma } from '../src/lib/chart-data.ts';
import type { Candle } from '../src/types.ts';
const bars: Candle[] = Array.from({ length: 80 }, (_, i) => ({ time: 1700000000000 + i * 60_000, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volumeBase: 5 + i, volumeUsd: 55 + i }));
describe('chart data fidelity', () => {
  it('converts milliseconds to UTC seconds and preserves OHLC and base-volume units', () => {
    const result = prepareChartData(bars);
    expect(result.candles[0]).toEqual({ time: 1700000000, open: 10, high: 12, low: 9, close: 11 });
    expect(result.volume[0]?.value).toBe(5);
    expect(result.line.at(-1)?.value).toBe(bars.at(-1)?.close);
    expect(result.candles).toHaveLength(bars.length);
  });
  it.each(['duplicate', 'reversed', 'nonfinite', 'badOHLC', 'negativeVolume'])('rejects %s without invented chart values', (defect) => {
    const input = bars.map((bar) => ({ ...bar }));
    if (defect === 'duplicate') input[1]!.time = input[0]!.time;
    if (defect === 'reversed') input.reverse();
    if (defect === 'nonfinite') input[3]!.close = NaN;
    if (defect === 'badOHLC') input[3]!.high = 1;
    if (defect === 'negativeVolume') input[3]!.volumeBase = -1;
    expect(() => prepareChartData(input)).toThrow();
  });
  it('uses only prior values for a full-window seeded EMA', () => {
    const points = prepareChartData(bars).line;
    const result = chartEma(points, 20);
    expect(result[0]?.time).toBe(points[19]?.time);
    expect(result[0]?.value).toBeCloseTo(20.5);
    expect(chartEma(points.slice(0, 19), 20)).toEqual([]);
    const changed = points.map((p, i) => ({ ...p, value: i === 79 ? 10000 : p.value }));
    expect(chartEma(changed, 20).slice(0, -1)).toEqual(result.slice(0, -1));
  });
});
