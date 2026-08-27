import { rangeFrom, toConcentrationView, toDelegationFlowView, toPassRateView } from './health';
import type { components } from '@/lib/api/schema';

const E18 = 10n ** 18n;

function concRow(
  bucket: string,
  gini: number,
  share: { n_1: number; n_5: number; n_10: number; n_20: number },
): components['schemas']['ConcentrationRowDto'] {
  return {
    bucket,
    gini,
    top_share: share,
    effective_delegate_count: 10,
    total_voting_power: '0',
    delegate_count: 20,
  };
}

describe('toConcentrationView', () => {
  it('stacks the top-share increments (not the nested cumulative totals)', () => {
    const view = toConcentrationView([
      concRow('2026-06-01', 0.5, { n_1: 0.1, n_5: 0.3, n_10: 0.5, n_20: 0.7 }),
    ]);
    expect(view.bands.map((b) => b.label)).toEqual(['Top 1', 'Top 2–5', 'Top 6–10', 'Top 11–20']);
    expect(view.bands.map((b) => b.values[0])).toEqual([10, 20, 20, 20]); // sums to n_20 = 70%
    expect(view.current).toEqual({ gini: 0.5, top10Pct: 50 });
  });

  it('sorts buckets and computes the 90-day top-10 delta in percentage points', () => {
    const view = toConcentrationView([
      concRow('2026-07-01', 0.6, { n_1: 0.2, n_5: 0.4, n_10: 0.6, n_20: 0.8 }),
      concRow('2026-01-01', 0.4, { n_1: 0.1, n_5: 0.2, n_10: 0.4, n_20: 0.5 }),
    ]);
    // 90+ days before Jul is Jan → top10 0.6 vs 0.4 = +20pp.
    expect(view.delta90Top10).toBeCloseTo(20, 6);
    expect(view.buckets[0]).toContain('Jan');
  });

  it('is empty-safe', () => {
    const view = toConcentrationView([]);
    expect(view.current).toBeNull();
    expect(view.delta90Top10).toBeNull();
  });
});

describe('toPassRateView', () => {
  it('builds a per-source series and the overall pass rate', () => {
    const view = toPassRateView([
      {
        source_type: 'snapshot',
        bucket: '2026-05-01',
        passed: 3,
        failed: 1,
        pass_rate: 0.75 as never,
      },
      {
        source_type: 'snapshot',
        bucket: '2026-06-01',
        passed: 2,
        failed: 2,
        pass_rate: 0.5 as never,
      },
    ]);
    expect(view.series[0]!.label).toBe('snapshot');
    expect(view.series[0]!.values).toEqual([75, 50]);
    expect(view.overallPct).toBe(62.5); // (3+2) passed / (4+4) decided
  });

  it('treats a null pass_rate as zero and null overall when nothing decided', () => {
    const view = toPassRateView([
      { source_type: 'x', bucket: 'b', passed: 0, failed: 0, pass_rate: null },
    ]);
    expect(view.series[0]!.values).toEqual([0]);
    expect(view.overallPct).toBeNull();
  });
});

describe('toDelegationFlowView', () => {
  const nodes = [
    {
      actor_id: 'a',
      primary_address: '0xaaaa000000000000000000000000000000000000',
      display_name: 'holder.eth',
      current_voting_power: '0',
    },
    {
      actor_id: 'b',
      primary_address: '0xbbbb000000000000000000000000000000000000',
      display_name: null,
      current_voting_power: '0',
    },
    {
      actor_id: 'x',
      primary_address: '0xcccc000000000000000000000000000000000000',
      display_name: 'Gauntlet',
      current_voting_power: '0',
    },
    {
      actor_id: 'orphan',
      primary_address: '0xdddd000000000000000000000000000000000000',
      display_name: null,
      current_voting_power: '0',
    },
  ] as unknown as components['schemas']['DelegationFlowNodeDto'][];

  const edges = [
    {
      delegator_actor_id: 'a',
      delegate_actor_id: 'x',
      voting_power: (5n * E18).toString(),
      block_number: '1',
      event_type: 'delegate',
      created_at: '',
    },
    {
      delegator_actor_id: 'b',
      delegate_actor_id: 'x',
      voting_power: (2n * E18).toString(),
      block_number: '1',
      event_type: 'delegate',
      created_at: '',
    },
    {
      delegator_actor_id: 'a',
      delegate_actor_id: null,
      voting_power: (9n * E18).toString(),
      block_number: '1',
      event_type: 'undelegate',
      created_at: '',
    },
  ] as unknown as components['schemas']['DelegationFlowEdgeDto'][];

  it('keeps delegate edges, scales power, sorts by weight, and prunes orphan nodes', () => {
    const view = toDelegationFlowView(nodes, edges);
    expect(view.edges.map((e) => e.weight)).toEqual([5, 2]); // null-delegate edge dropped; scaled from 1e18
    expect(view.edges[0]!.from).toBe('a');
    // 'orphan' has no surviving edge → pruned.
    expect(view.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'x']);
    // display_name falls back to a truncated address.
    expect(view.nodes.find((n) => n.id === 'b')!.label).toBe('0xbbbb…0000');
  });

  it('caps to the top N by weight', () => {
    const view = toDelegationFlowView(nodes, edges, 1);
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0]!.weight).toBe(5);
  });
});

describe('rangeFrom', () => {
  const now = Date.UTC(2026, 6, 1);
  it('offsets by the range and omits the bound for all-time', () => {
    expect(rangeFrom('all', now)).toBeUndefined();
    expect(rangeFrom('90d', now)).toBe(new Date(now - 90 * 86_400_000).toISOString());
  });
});
