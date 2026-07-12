import { extent, linear } from './scale';

/**
 * An inline micro-trend (ADR-085). No axes or frame — a sparkline is read in context, so its
 * accessible form is a short `aria-label` (e.g. the latest value) rather than a table toggle.
 */
export function Sparkline({
  values,
  label,
  width = 80,
  height = 20,
}: {
  values: number[];
  /** Screen-reader summary, e.g. "participation trend, latest 42%". */
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const y = linear(extent(values, { includeZero: true }), [height - 1.5, 1.5]);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
