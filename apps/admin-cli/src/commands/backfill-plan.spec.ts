import { describe, expect, it } from 'vitest';
import {
  findMissingChainConfigs,
  planBackfillOrder,
  selectBackfillMode,
  type BackfillTarget,
} from './backfill-plan.js';

function target(
  partial: Partial<BackfillTarget> & { source_type: string; chain_id: string },
): BackfillTarget {
  return {
    id: `${partial.source_type}-${partial.chain_id}`,
    source_config: {},
    active_from_block: '100',
    backfill_started_at_block: null,
    backfill_head_block: null,
    ...partial,
  };
}

describe('planBackfillOrder', () => {
  it('excludes reconcile sources', () => {
    const rows = [
      target({ source_type: 'aave_governance_v3', chain_id: '0x1' }),
      target({ source_type: 'aave_governance_v3_reconcile', chain_id: '0x1' }),
      target({ source_type: 'aave_payloads_controller_reconcile', chain_id: '0x89' }),
    ];
    const plan = planBackfillOrder(rows, { skipDeprecated: false });
    expect([...plan.phase1, ...plan.phase2].map((t) => t.source_type)).toEqual([
      'aave_governance_v3',
    ]);
  });

  it('puts the mainnet spine (governance_v3 first) in phase1 and the rest in phase2', () => {
    const rows = [
      target({ source_type: 'aave_payloads_controller', chain_id: '0x89' }),
      target({ source_type: 'aave_token', chain_id: '0x1' }),
      target({ source_type: 'aave_voting_machine', chain_id: '0x89' }),
      target({ source_type: 'aave_governor_v2', chain_id: '0x1' }),
      target({ source_type: 'aave_governance_v3', chain_id: '0x1' }),
    ];
    const plan = planBackfillOrder(rows, { skipDeprecated: false });
    expect(plan.phase1.map((t) => t.source_type)).toEqual([
      'aave_governance_v3',
      'aave_governor_v2',
      'aave_token',
    ]);
    expect(plan.phase2.map((t) => t.source_type).sort()).toEqual([
      'aave_payloads_controller',
      'aave_voting_machine',
    ]);
  });

  it('keeps deprecated-chain sources by default and drops them with skipDeprecated', () => {
    const rows = [
      target({
        source_type: 'aave_payloads_controller',
        chain_id: '0x440',
        source_config: { deprecated: true },
      }),
      target({ source_type: 'aave_payloads_controller', chain_id: '0x89' }),
    ];
    expect(planBackfillOrder(rows, { skipDeprecated: false }).phase2).toHaveLength(2);

    const skipped = planBackfillOrder(rows, { skipDeprecated: true });
    expect(skipped.phase2).toHaveLength(1);
    expect(skipped.skippedDeprecated.map((t) => t.chain_id)).toEqual(['0x440']);
  });
});

describe('findMissingChainConfigs', () => {
  it('returns chains present in targets but missing from CHAIN_CONFIG (normalized)', () => {
    const targets = [
      target({ source_type: 'aave_voting_machine', chain_id: '0x1' }),
      target({ source_type: 'aave_voting_machine', chain_id: '0x89' }),
      target({ source_type: 'aave_payloads_controller', chain_id: '0xa4b1' }),
    ];
    // 0x089 normalizes to 0x89, so it covers the Polygon voting machine.
    expect(findMissingChainConfigs(targets, [{ chainId: '0x1' }, { chainId: '0x089' }])).toEqual([
      '0xa4b1',
    ]);
  });

  it('returns empty when every target chain is configured', () => {
    const targets = [target({ source_type: 'aave_governance_v3', chain_id: '0x1' })];
    expect(findMissingChainConfigs(targets, [{ chainId: '0x1' }])).toEqual([]);
  });
});

describe('selectBackfillMode', () => {
  it('resumes when a backfill is already in flight', () => {
    expect(selectBackfillMode({ backfill_started_at_block: '500' }, null, 1000n)).toBe('resume');
  });

  it('skips when the archive already reaches the confirmed head', () => {
    expect(selectBackfillMode({ backfill_started_at_block: null }, 1000n, 1000n)).toBe('skip');
    expect(selectBackfillMode({ backfill_started_at_block: null }, 1500n, 1000n)).toBe('skip');
  });

  it('runs fresh when untouched and the archive is behind or empty', () => {
    expect(selectBackfillMode({ backfill_started_at_block: null }, 500n, 1000n)).toBe('fresh');
    expect(selectBackfillMode({ backfill_started_at_block: null }, null, 1000n)).toBe('fresh');
  });
});
