import { useId } from 'react';
import type { Candle } from '../types.ts';
export default function LineChart({
  data,
  color = '#4be5b7',
  height = 170,
  ariaLabel = 'Historical price line graph',
}: {
  data: { value: number }[] | Candle[];
  color?: string;
  height?: number;
  ariaLabel?: string;
}) {
  const grad = useId().replace(/:/g, '');
  const values = data.map((x) => ('value' in x ? x.value : x.close)).filter(Number.isFinite);
  if (values.length < 2) return <div className="empty">Waiting for chart data</div>;
  const min = Math.min(...values),
    max = Math.max(...values),
    range = Math.max(1e-8, max - min),
    w = 800,
    pad = 12,
    h = height;
  const points = values
    .map(
      (v, i) =>
        `${pad + (i * (w - 2 * pad)) / (values.length - 1)},${pad + (1 - (v - min) / range) * (h - 2 * pad)}`,
    )
    .join(' ');
  const fill = `${pad},${h - pad} ${points} ${w - pad},${h - pad}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
      className="w-full rounded-lg"
      style={{ height }}
    >
      <defs>
        <linearGradient id={grad} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`M0 ${h / 4} H${w} M0 ${h / 2} H${w} M0 ${h * 0.75} H${w}`}
        stroke="#273346"
        strokeWidth="1"
        strokeDasharray="4 6"
        fill="none"
      />
      <polygon points={fill} fill={`url(#${grad})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.4"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
