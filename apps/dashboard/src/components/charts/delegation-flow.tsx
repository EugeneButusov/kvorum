import type { ChartTableModel } from './data-table';
import { Figure } from './figure';
import { bandCenters, linear } from './scale';

export type FlowNode = { id: string; label: string };
export type FlowEdge = { from: string; to: string; weight: number };

export type DelegationFlowProps = {
  title: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  formatWeight?: (w: number) => string;
  caption?: string;
};

const W = 640;
const NODE_H = 22;
const ROW_GAP = 14;
const COL_INSET = 8;
const LABEL = 150;

/**
 * Delegation flow (ADR-085): a bipartite node-link — delegators on the left, delegates on the right,
 * edges weighted by delegated power. A general layered layout the delegation pages build on.
 */
export function DelegationFlow({
  title,
  nodes,
  edges,
  formatWeight = (w) => String(w),
  caption,
}: DelegationFlowProps) {
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const sources = [...new Set(edges.map((e) => e.from))];
  const targets = [...new Set(edges.map((e) => e.to))];

  const rows = Math.max(sources.length, targets.length, 1);
  const H = rows * NODE_H + (rows - 1) * ROW_GAP + 8;

  const leftX = LABEL;
  const rightX = W - LABEL;
  const ys = (count: number) => bandCenters(count, [NODE_H / 2 + 4, H - NODE_H / 2 - 4]);
  const sourceY = ys(sources.length);
  const targetY = ys(targets.length);
  const yOf = (list: string[], centers: number[], id: string) => centers[list.indexOf(id)] ?? 0;

  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));
  const stroke = linear([0, maxWeight], [1, 6]);

  return (
    <Figure title={title} table={toTable(edges, labelOf, formatWeight)} caption={caption}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="font-mono">
          {/* edges (drawn first, under the nodes) */}
          {edges.map((e, i) => (
            <line
              key={i}
              x1={leftX + COL_INSET}
              y1={yOf(sources, sourceY, e.from)}
              x2={rightX - COL_INSET}
              y2={yOf(targets, targetY, e.to)}
              stroke="var(--accent)"
              strokeOpacity={0.45}
              strokeWidth={stroke(e.weight)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* delegator nodes (left) */}
          {sources.map((id, i) => (
            <text
              key={id}
              x={leftX}
              y={sourceY[i]}
              textAnchor="end"
              dominantBaseline="middle"
              fill="var(--ink-2)"
              fontSize={11}
            >
              {truncate(labelOf.get(id) ?? id)}
            </text>
          ))}
          {/* delegate nodes (right) */}
          {targets.map((id, i) => (
            <text
              key={id}
              x={rightX}
              y={targetY[i]}
              textAnchor="start"
              dominantBaseline="middle"
              fill="var(--ink)"
              fontSize={11}
              fontWeight={600}
            >
              {truncate(labelOf.get(id) ?? id)}
            </text>
          ))}
        </svg>
      </div>
    </Figure>
  );
}

function truncate(s: string): string {
  return s.length > 20 ? `${s.slice(0, 19)}…` : s;
}

function toTable(
  edges: FlowEdge[],
  labelOf: Map<string, string>,
  format: (w: number) => string,
): ChartTableModel {
  return {
    columns: [
      { key: 'from', label: 'Delegator' },
      { key: 'to', label: 'Delegate' },
      { key: 'weight', label: 'Voting power', numeric: true },
    ],
    rows: edges.map((e) => ({
      from: labelOf.get(e.from) ?? e.from,
      to: labelOf.get(e.to) ?? e.to,
      weight: format(e.weight),
    })),
  };
}
