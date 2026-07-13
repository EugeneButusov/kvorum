// Data layer for the DAO health dashboard (§6.7): fetch + transform the live analytics endpoints
// (concentration, proposal-pass-rate, delegation-flow) into the shapes the chart primitives consume.
// All values arrive as 0..1 fractions; power figures are UInt256 base units.

import type { FlowEdge, FlowNode } from '@/components/charts/delegation-flow';
import type { Series } from '@/components/charts/time-series';
import type { createApiClient } from '@/lib/api/client';
import type { components } from '@/lib/api/schema';

type ConcentrationRow = components['schemas']['ConcentrationRowDto'];
type PassRateRow = components['schemas']['PassRateRowDto'];
type FlowNodeDto = components['schemas']['DelegationFlowNodeDto'];
type FlowEdgeDto = components['schemas']['DelegationFlowEdgeDto'];

type Api = ReturnType<typeof createApiClient>;

const POWER_DECIMALS = 18n;

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function scalePower(reported: string): number {
  try {
    const base = BigInt(reported);
    const whole = base / 10n ** POWER_DECIMALS;
    const frac = Number(base % 10n ** POWER_DECIMALS) / Number(10n ** POWER_DECIMALS);
    return Number(whole) + frac;
  } catch {
    return 0;
  }
}

/** A short axis label from a bucket date, e.g. "Jul '26". */
export function bucketLabel(bucket: string): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(d.getUTCFullYear()).slice(2)}`;
}

export type TimeRange = '90d' | '1y' | 'all';

/** `from` ISO for a range, relative to `now`; `all` omits the bound. */
export function rangeFrom(range: TimeRange, now: number): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '90d' ? 90 : 365;
  return new Date(now - days * 86_400_000).toISOString();
}

// —— Concentration ———————————————————————————————————————————————————————————————

export type ConcentrationView = {
  buckets: string[];
  /** Gini over time (0..1). */
  gini: number[];
  /** Incremental top-share bands (%), stacking to the top-20 total. */
  bands: Series[];
  current: { gini: number; top10Pct: number } | null;
  /** Change in top-10 share (percentage points) over ~90 days; null if not enough history. */
  delta90Top10: number | null;
};

export function toConcentrationView(rows: ConcentrationRow[]): ConcentrationView {
  const sorted = [...rows].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const buckets = sorted.map((r) => bucketLabel(r.bucket));
  const gini = sorted.map((r) => r.gini);

  // top_share is cumulative (n_1 ⊂ n_5 ⊂ n_10 ⊂ n_20); stack the *increments* so the total reads as
  // the top-20 share rather than double-counting nested groups. Round to kill float noise (0.7−0.5).
  const pct = (v: number) => Math.round(v * 10000) / 100;
  const bands: Series[] = [
    { label: 'Top 1', values: sorted.map((r) => pct(r.top_share.n_1)) },
    { label: 'Top 2–5', values: sorted.map((r) => pct(r.top_share.n_5 - r.top_share.n_1)) },
    { label: 'Top 6–10', values: sorted.map((r) => pct(r.top_share.n_10 - r.top_share.n_5)) },
    { label: 'Top 11–20', values: sorted.map((r) => pct(r.top_share.n_20 - r.top_share.n_10)) },
  ];

  const last = sorted[sorted.length - 1];
  const current = last ? { gini: last.gini, top10Pct: pct(last.top_share.n_10) } : null;

  return { buckets, gini, bands, current, delta90Top10: delta90(sorted) };
}

function delta90(sorted: ConcentrationRow[]): number | null {
  const last = sorted[sorted.length - 1];
  if (!last) return null;
  const target = new Date(last.bucket).getTime() - 90 * 86_400_000;
  // Nearest bucket at or before ~90 days ago.
  const prior = [...sorted].reverse().find((r) => new Date(r.bucket).getTime() <= target);
  if (!prior) return null;
  return (last.top_share.n_10 - prior.top_share.n_10) * 100;
}

export async function fetchConcentration(
  api: Api,
  slug: string,
  query: { from?: string; bucket?: 'daily' | 'weekly' | 'monthly' } = {},
): Promise<ConcentrationView> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/concentration', {
      params: { path: { slug }, query: { bucket: query.bucket ?? 'monthly', ...query } },
    });
    if (error || !data) return toConcentrationView([]);
    return toConcentrationView(data.data);
  } catch {
    return toConcentrationView([]); // network failure → empty, never 500 the page
  }
}

// —— Pass rate ————————————————————————————————————————————————————————————————————

export type PassRateView = {
  buckets: string[];
  series: Series[];
  /** Overall pass rate across the window (%), or null when nothing resolved. */
  overallPct: number | null;
};

export function toPassRateView(rows: PassRateRow[]): PassRateView {
  const bucketKeys = [...new Set(rows.map((r) => r.bucket))].sort((a, b) => a.localeCompare(b));
  const types = [...new Set(rows.map((r) => r.source_type))];
  const byKey = new Map(rows.map((r) => [`${r.source_type}:${r.bucket}`, r]));

  const series: Series[] = types.map((type) => ({
    label: type,
    values: bucketKeys.map((b) => {
      const rate = num(byKey.get(`${type}:${b}`)?.pass_rate);
      return rate == null ? 0 : Math.round(rate * 1000) / 10;
    }),
  }));

  const passed = rows.reduce((s, r) => s + r.passed, 0);
  const decided = rows.reduce((s, r) => s + r.passed + r.failed, 0);

  return {
    buckets: bucketKeys.map(bucketLabel),
    series,
    overallPct: decided > 0 ? Math.round((passed / decided) * 1000) / 10 : null,
  };
}

export async function fetchPassRate(api: Api, slug: string, from?: string): Promise<PassRateView> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/proposal-pass-rate', {
      params: { path: { slug }, query: { bucket: 'monthly', ...(from ? { from } : {}) } },
    });
    if (error || !data) return toPassRateView([]);
    return toPassRateView(data.data);
  } catch {
    return toPassRateView([]);
  }
}

// —— Top delegates ————————————————————————————————————————————————————————————————

export type TopDelegate = { address: string; label: string; power: number };

/** The N actors holding the most current voting power (delegation-flow nodes), descending. */
export async function fetchTopDelegates(api: Api, slug: string, n = 5): Promise<TopDelegate[]> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/delegation-flow', {
      params: { path: { slug }, query: {} },
    });
    if (error || !data) return [];
    return data.nodes
      .map((node) => ({
        address: node.primary_address,
        label:
          (typeof node.display_name === 'string' && node.display_name) ||
          `${node.primary_address.slice(0, 6)}…${node.primary_address.slice(-4)}`,
        power: scalePower(node.current_voting_power),
      }))
      .filter((d) => d.power > 0)
      .sort((a, b) => b.power - a.power)
      .slice(0, n);
  } catch {
    return [];
  }
}

// —— Delegation flow ——————————————————————————————————————————————————————————————

export type DelegationFlowView = { nodes: FlowNode[]; edges: FlowEdge[] };

export function toDelegationFlowView(
  nodes: FlowNodeDto[],
  edges: FlowEdgeDto[],
  limit = 50,
): DelegationFlowView {
  const label = (n: FlowNodeDto) =>
    (typeof n.display_name === 'string' && n.display_name) ||
    `${n.primary_address.slice(0, 6)}…${n.primary_address.slice(-4)}`;

  const flowNodes: FlowNode[] = nodes.map((n) => ({ id: n.actor_id, label: label(n) }));

  const flowEdges: FlowEdge[] = edges
    .filter((e) => typeof e.delegate_actor_id === 'string')
    .map((e) => ({
      from: e.delegator_actor_id,
      to: e.delegate_actor_id as unknown as string,
      weight: scalePower(e.voting_power),
    }))
    .filter((e) => e.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);

  // Keep only nodes touched by the surviving edges.
  const used = new Set(flowEdges.flatMap((e) => [e.from, e.to]));
  return { nodes: flowNodes.filter((n) => used.has(n.id)), edges: flowEdges };
}

export async function fetchDelegationFlow(
  api: Api,
  slug: string,
  limit = 50,
): Promise<DelegationFlowView> {
  try {
    const { data, error } = await api.GET('/v1/daos/{slug}/analytics/delegation-flow', {
      params: { path: { slug }, query: {} },
    });
    if (error || !data) return { nodes: [], edges: [] };
    return toDelegationFlowView(data.nodes, data.edges, limit);
  } catch {
    return { nodes: [], edges: [] };
  }
}
