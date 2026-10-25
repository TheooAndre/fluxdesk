import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import {
  DRAWING_LIMIT,
  DrawingPrimitive,
  drawingKey,
  parseDrawings,
  type Drawing,
  type DrawingPoint,
} from '../lib/chart-drawings.ts';
import { price } from '../lib/format.ts';

const labels = { horizontal: 'Horizontal level', trend: 'Trend line', rectangle: 'Rectangle' };
export default function ChartDrawings({
  chart,
  series,
  assetId,
  interval,
}: {
  chart: IChartApi;
  series: ISeriesApi<'Line'>;
  assetId: string;
  interval: string;
}) {
  const key = drawingKey(assetId, interval);
  const [initial] = useState(() => {
    try {
      return { drawings: parseDrawings(localStorage.getItem(key)), error: '' };
    } catch {
      return {
        drawings: [],
        error: 'Saved drawings could not be loaded. Changes will replace this chart’s saved drawings.',
      };
    }
  });
  const [drawings, setDrawings] = useState<Drawing[]>(initial.drawings);
  const [error, setError] = useState(initial.error);
  const [tool, setTool] = useState<Drawing['kind'] | null>(null);
  const [first, setFirst] = useState<DrawingPoint | null>(null);
  const [preview, setPreview] = useState<DrawingPoint | null>(null);
  const [color, setColor] = useState('#ffc856');
  const primitive = useMemo(() => new DrawingPrimitive(), []);
  const [undo, setUndo] = useState<Drawing[][]>([]);
  const save = useCallback(
    (next: Drawing[]) => {
      setUndo((history) => [...history.slice(-19), drawings]);
      setDrawings(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
        setError('');
      } catch {
        setError('Drawings are visible for this session but could not be saved on this device.');
      }
    },
    [drawings, key],
  );
  useEffect(() => {
    series.attachPrimitive(primitive);
    return () => series.detachPrimitive(primitive);
  }, [series, primitive]);
  useEffect(() => {
    const draft: Drawing[] =
      tool && first
        ? [{ id: 'preview', kind: tool, color, points: preview ? [first, preview] : [first] }]
        : [];
    primitive.setDrawings([...drawings, ...draft]);
  }, [primitive, drawings, tool, first, preview, color]);
  useEffect(() => {
    if (!tool) return;
    chart.applyOptions({
      handleScroll: { pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
    });
    const element = chart.chartElement();
    let down: { x: number; y: number; id: number } | null = null;
    const point = (event: PointerEvent): DrawingPoint | null => {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - chart.priceScale('left').width();
      const y = event.clientY - rect.top;
      const pane = chart.paneSize(0);
      if (x < 0 || y < 0 || x > pane.width || y > pane.height) return null;
      const time = chart.timeScale().coordinateToTime(x);
      if (typeof time !== 'number') return null;
      const value = series.coordinateToPrice(y);
      return value !== null && value > 0 && value <= 1e15
        ? { time, price: Number(value.toPrecision(10)) }
        : null;
    };
    // Native pointer taps avoid the library's 500ms double-click suppression,
    // which otherwise drops a fast second drawing point at a different location.
    const start = (event: PointerEvent) => {
      if (event.isPrimary && event.button === 0)
        down = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const cancel = () => {
      down = null;
    };
    const click = (event: PointerEvent) => {
      const origin = down;
      down = null;
      if (
        !origin ||
        event.pointerId !== origin.id ||
        Math.abs(event.clientX - origin.x) + Math.abs(event.clientY - origin.y) > 8
      )
        return;
      const next = point(event);
      if (!next) return;
      if (tool !== 'horizontal' && !first) {
        setFirst(next);
        return;
      }
      if (drawings.length >= DRAWING_LIMIT) return;
      save([
        ...drawings,
        {
          id: crypto.randomUUID(),
          kind: tool,
          color,
          points: tool === 'horizontal' ? [next] : [first!, next],
        },
      ]);
      setFirst(null);
      setPreview(null);
      setTool(null);
    };
    const move = (event: PointerEvent) => setPreview(point(event));
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTool(null);
        setFirst(null);
        setPreview(null);
      }
    };
    element.addEventListener('pointerdown', start);
    element.addEventListener('pointerup', click);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('pointermove', move);
    window.addEventListener('keydown', escape);
    return () => {
      element.removeEventListener('pointerdown', start);
      element.removeEventListener('pointerup', click);
      element.removeEventListener('pointercancel', cancel);
      element.removeEventListener('pointermove', move);
      window.removeEventListener('keydown', escape);
      chart.applyOptions({
        handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      });
    };
  }, [chart, series, tool, first, drawings, color, save]);
  return (
    <div className="chart-drawings">
      <div className="chart-toolbar" role="group" aria-label="Drawing tools">
        <button
          className="subtle"
          aria-pressed={!tool}
          onClick={() => {
            setTool(null);
            setFirst(null);
            setPreview(null);
          }}
        >
          Cursor
        </button>
        {(Object.keys(labels) as Drawing['kind'][]).map((kind) => (
          <button
            key={kind}
            className="subtle"
            aria-pressed={tool === kind}
            disabled={drawings.length >= DRAWING_LIMIT}
            onClick={() => {
              setTool(kind);
              setFirst(null);
              setPreview(null);
            }}
          >
            {labels[kind]}
          </button>
        ))}
        <label>
          Color{' '}
          <input
            aria-label="Drawing color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <button
          className="subtle"
          disabled={!undo.length && !first}
          onClick={() => {
            if (first) {
              setFirst(null);
              setPreview(null);
              return;
            }
            const previous = undo.at(-1);
            if (!previous) return;
            save(previous);
            setUndo(undo.slice(0, -1));
          }}
        >
          Undo drawing
        </button>
        <button
          className="subtle"
          disabled={!drawings.length}
          onClick={() => {
            save([]);
            setFirst(null);
            setPreview(null);
          }}
        >
          Clear drawings
        </button>
      </div>
      <p className="chart-caption" role="status">
        {tool
          ? tool === 'horizontal'
            ? 'Tap or click a price in the candle pane.'
            : first
              ? 'Tap or click the second point. Cursor or Escape cancels.'
              : 'Tap or click the first point in the candle pane.'
          : drawings.length ? `${drawings.length} / ${DRAWING_LIMIT} drawings · Device only` : null}
      </p>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      {!!drawings.length && (
        <details>
          <summary>Manage drawings ({drawings.length})</summary>
          <ul className="drawing-list">
            {drawings.map((drawing, index) => (
              <li key={drawing.id}>
                <span>
                  {labels[drawing.kind]} {index + 1} · {drawing.points.map((p) => price(p.price)).join(' → ')}
                </span>
                <button
                  className="subtle"
                  aria-label={`Delete drawing ${index + 1}`}
                  onClick={() => save(drawings.filter((d) => d.id !== drawing.id))}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <p className="chart-caption">
            Lines and rectangles use candle times. Both endpoints must be in loaded history to display.
            Drawings do not sync with TradingView or server backups.
          </p>
        </details>
      )}
    </div>
  );
}
