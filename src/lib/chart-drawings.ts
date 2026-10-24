import type {
  IPrimitivePaneRenderer,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  UTCTimestamp,
} from 'lightweight-charts';

export type DrawingPoint = { time: number; price: number };
export type Drawing = {
  id: string;
  kind: 'horizontal' | 'trend' | 'rectangle';
  color: string;
  points: DrawingPoint[];
};
export const DRAWING_LIMIT = 50;
export const drawingKey = (asset: string, interval: string) => `fluxdesk:drawings:v1:${asset}:${interval}`;

export function parseDrawings(raw: string | null): Drawing[] {
  if (!raw) return [];
  if (raw.length > 50_000) throw Error('Saved drawings exceed the size limit');
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > DRAWING_LIMIT) throw Error('Invalid saved drawings');
  const ids = new Set<string>();
  for (const drawing of value) {
    if (
      !drawing ||
      typeof drawing.id !== 'string' ||
      drawing.id.length > 80 ||
      ids.has(drawing.id) ||
      !['horizontal', 'trend', 'rectangle'].includes(drawing.kind) ||
      !/^#[0-9a-f]{6}$/i.test(drawing.color) ||
      !Array.isArray(drawing.points) ||
      drawing.points.length !== (drawing.kind === 'horizontal' ? 1 : 2) ||
      !drawing.points.every(
        (p: DrawingPoint) =>
          p &&
          Number.isInteger(p.time) &&
          p.time > 0 &&
          p.time < 1e11 &&
          Number.isFinite(p.price) &&
          p.price > 0 &&
          p.price <= 1e15,
      )
    )
      throw Error('Invalid saved drawings');
    ids.add(drawing.id);
  }
  return value as Drawing[];
}

/** Native series primitive: coordinates are recomputed by the chart on every pan/zoom/resize. */
export class DrawingPrimitive implements ISeriesPrimitive {
  private attachedTo?: SeriesAttachedParameter;
  private drawings: Drawing[] = [];
  private renderer: IPrimitivePaneRenderer = {
    draw: (target) => {
      const api = this.attachedTo;
      if (!api) return;
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, mediaSize.width, mediaSize.height);
        ctx.clip();
        for (const drawing of this.drawings) {
          const first = drawing.points[0]!;
          const y1 = api.series.priceToCoordinate(first.price);
          if (y1 === null) continue;
          ctx.strokeStyle = drawing.color;
          ctx.fillStyle = drawing.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          if (drawing.kind === 'horizontal') {
            ctx.moveTo(0, y1);
            ctx.lineTo(mediaSize.width, y1);
            ctx.stroke();
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(first.price.toLocaleString('en-US', { maximumSignificantDigits: 9 }), 8, y1 - 6);
            continue;
          }
          const second = drawing.points[1];
          const x1 = api.chart.timeScale().timeToCoordinate(first.time as UTCTimestamp);
          if (x1 === null) continue;
          if (!second) {
            ctx.arc(x1, y1, 4, 0, 2 * Math.PI);
            ctx.fill();
            continue;
          }
          const x2 = api.chart.timeScale().timeToCoordinate(second.time as UTCTimestamp);
          const y2 = api.series.priceToCoordinate(second.price);
          if (x2 === null || y2 === null) continue;
          if (drawing.kind === 'rectangle') {
            ctx.globalAlpha = 0.12;
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
            ctx.globalAlpha = 1;
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          } else {
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
          for (const [x, y] of [
            [x1, y1],
            [x2, y2],
          ]) {
            ctx.beginPath();
            ctx.arc(x!, y!, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
        ctx.restore();
      });
    },
  };
  private view = { zOrder: () => 'top' as const, renderer: () => this.renderer };
  attached(parameters: SeriesAttachedParameter) {
    this.attachedTo = parameters;
  }
  detached() {
    this.attachedTo = undefined;
  }
  paneViews() {
    return [this.view];
  }
  setDrawings(drawings: Drawing[]) {
    this.drawings = drawings;
    this.attachedTo?.requestUpdate();
  }
}
