import { expect, it, vi } from 'vitest';
import type { IPrimitivePaneRenderer, SeriesAttachedParameter } from 'lightweight-charts';
import { DrawingPrimitive, drawingKey, parseDrawings, type Drawing } from '../src/lib/chart-drawings.ts';
import { priceAlertDirection } from '../src/lib/price-alert.ts';

const level: Drawing = {
  id: 'a',
  kind: 'horizontal',
  color: '#ffc856',
  points: [{ time: 1800000000, price: 100 }],
};
it('validates bounded device drawings and keeps venue/timeframe storage separate', () => {
  expect(parseDrawings(JSON.stringify([level]))).toEqual([level]);
  expect(parseDrawings(null)).toEqual([]);
  for (const bad of [
    {},
    [level, level],
    [{ ...level, kind: 'script' }],
    [{ ...level, color: 'bad' }],
    [{ ...level, points: [] }],
    [{ ...level, kind: 'trend' }],
    [{ ...level, points: [{ time: 1, price: -1 }] }],
    Array(51).fill(level),
  ]) {
    expect(() => parseDrawings(JSON.stringify(bad))).toThrow();
  }
  expect(() => parseDrawings(' '.repeat(50001))).toThrow();
  expect(drawingKey('binance:ETHUSDT', '1h')).not.toBe(drawingKey('hyperliquid:ETH', '1h'));
  expect(drawingKey('binance:ETHUSDT', '1h')).not.toBe(drawingKey('binance:ETHUSDT', '4h'));
});
it('renders in chart coordinates after scale changes and detaches safely', () => {
  let scale = 1;
  const update = vi.fn(),
    lineTo = vi.fn(),
    strokeRect = vi.fn();
  const ctx = new Proxy(
    { lineTo, strokeRect },
    { get: (target, key) => Reflect.get(target, key) ?? vi.fn() },
  );
  const primitive = new DrawingPrimitive();
  primitive.attached({
    requestUpdate: update,
    series: { priceToCoordinate: (p: number) => p * scale },
    chart: { timeScale: () => ({ timeToCoordinate: (t: number) => (t - 1800000000) * scale }) },
  } as unknown as SeriesAttachedParameter);
  primitive.setDrawings([
    level,
    { ...level, id: 'b', kind: 'trend', points: [...level.points, { time: 1800000010, price: 110 }] },
    { ...level, id: 'c', kind: 'rectangle', points: [...level.points, { time: 1800000010, price: 110 }] },
  ]);
  const target = {
    useMediaCoordinateSpace: (fn: (scope: unknown) => void) =>
      fn({ context: ctx, mediaSize: { width: 500, height: 300 } }),
  } as Parameters<IPrimitivePaneRenderer['draw']>[0];
  primitive.paneViews()[0]!.renderer().draw(target);
  expect(lineTo).toHaveBeenCalledWith(10, 110);
  expect(strokeRect).toHaveBeenCalledWith(0, 100, 10, 10);
  scale = 2;
  primitive.paneViews()[0]!.renderer().draw(target);
  expect(lineTo).toHaveBeenCalledWith(20, 220);
  expect(strokeRect).toHaveBeenCalledWith(0, 200, 20, 20);
  expect(update).toHaveBeenCalledTimes(1);
  primitive.detached();
  primitive.setDrawings([]);
  expect(update).toHaveBeenCalledTimes(1);
});
it('infers a price direction only for finite, positive, distinct prices', () => {
  expect(priceAlertDirection(100, 90)).toBe('below');
  expect(priceAlertDirection(100, 110)).toBe('above');
  for (const pair of [
    [100, 100],
    [NaN, 90],
    [100, Infinity],
    [0, 100],
    [100, -1],
  ])
    expect(priceAlertDirection(pair[0]!, pair[1]!)).toBeNull();
});
