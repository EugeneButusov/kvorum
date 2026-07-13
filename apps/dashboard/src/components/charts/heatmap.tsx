import { sequentialAlpha } from './chart-colors';
import type { ChartTableModel } from './data-table';
import { Figure } from './figure';

export type HeatmapProps = {
  title: string;
  rowLabels: string[];
  colLabels: string[];
  /** cells[row][col]; nulls render as an empty (no-data) square. */
  cells: (number | null)[][];
  /** Value domain for the colour ramp; defaults to the data min/max. */
  domain?: [number, number];
  formatValue?: (v: number) => string;
  caption?: string;
};

const CELL = 22;
const GAP = 2;
const ROW_LABEL_W = 96;
const COL_LABEL_H = 20;

/** Sequential heatmap (ADR-085): one hue, magnitude by opacity. Calendar grids / alignment matrices. */
export function Heatmap({
  title,
  rowLabels,
  colLabels,
  cells,
  domain,
  formatValue = (v) => String(v),
  caption,
}: HeatmapProps) {
  const flat = cells.flat().filter((v): v is number => v != null);
  const [min, max] = domain ?? [Math.min(0, ...flat), Math.max(1, ...flat)];
  const span = max - min || 1;
  const norm = (v: number) => (v - min) / span;

  const width = ROW_LABEL_W + colLabels.length * (CELL + GAP);
  const height = COL_LABEL_H + rowLabels.length * (CELL + GAP);

  return (
    <Figure
      title={title}
      table={toTable(rowLabels, colLabels, cells, formatValue)}
      caption={caption}
    >
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} className="max-w-full font-mono">
          {colLabels.map((c, ci) => (
            <text
              key={c}
              x={ROW_LABEL_W + ci * (CELL + GAP) + CELL / 2}
              y={COL_LABEL_H - 6}
              textAnchor="middle"
              fill="var(--ink-3)"
              fontSize={9}
            >
              {c}
            </text>
          ))}
          {rowLabels.map((r, ri) => (
            <g key={r}>
              <text
                x={ROW_LABEL_W - 8}
                y={COL_LABEL_H + ri * (CELL + GAP) + CELL / 2}
                textAnchor="end"
                dominantBaseline="middle"
                fill="var(--ink-3)"
                fontSize={10}
              >
                {r}
              </text>
              {colLabels.map((_, ci) => {
                const v = cells[ri]?.[ci] ?? null;
                const x = ROW_LABEL_W + ci * (CELL + GAP);
                const y = COL_LABEL_H + ri * (CELL + GAP);
                return v == null ? (
                  <rect
                    key={ci}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    fill="var(--bg-3)"
                    stroke="var(--line-3)"
                    strokeWidth={1}
                  />
                ) : (
                  <rect
                    key={ci}
                    x={x}
                    y={y}
                    width={CELL}
                    height={CELL}
                    fill="var(--accent)"
                    fillOpacity={sequentialAlpha(norm(v))}
                  >
                    <title>{`${r} · ${colLabels[ci]}: ${formatValue(v)}`}</title>
                  </rect>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
    </Figure>
  );
}

function toTable(
  rowLabels: string[],
  colLabels: string[],
  cells: (number | null)[][],
  format: (v: number) => string,
): ChartTableModel {
  return {
    columns: [
      { key: 'row', label: '' },
      ...colLabels.map((c) => ({ key: c, label: c, numeric: true })),
    ],
    rows: rowLabels.map((r, ri) => {
      const row: Record<string, string | number> = { row: r };
      colLabels.forEach((c, ci) => {
        const v = cells[ri]?.[ci];
        row[c] = v == null ? '—' : format(v);
      });
      return row;
    }),
  };
}
