import { describe, expect, it, vi } from 'vitest';
import { selectDaoSourceForChain } from './backfill.js';
import { buildBackfillSourcePlugins } from '../plugins/backfill-source-plugins.js';

const makeDeps = () => ({
  archiveWriter: {} as never,
  dlqRepo: {} as never,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});

describe('backfill command plugin coverage', () => {
  it('exposes all known EVM-backfillable source types, including Lido + Snapshot delegation', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: makeDeps(),
      compToken: makeDeps(),
      aaveGovernorV2: makeDeps(),
      aaveGovernanceV3: makeDeps(),
      aaveVotingMachine: makeDeps(),
      aavePayloadsController: makeDeps(),
      aaveToken: makeDeps(),
      lidoAragonVoting: makeDeps(),
      lidoDualGovernance: makeDeps(),
      lidoEasyTrack: makeDeps(),
      snapshotDelegateRegistry: makeDeps(),
      snapshotSplitDelegation: makeDeps(),
    });

    expect(plugins.map((plugin) => plugin.sourceType)).toEqual([
      'compound_governor_bravo',
      'compound_governor_alpha',
      'compound_governor_oz',
      'compound_comp_token',
      'aave_governor_v2',
      'aave_governance_v3',
      'aave_voting_machine',
      'aave_payloads_controller',
      'aave_token',
      'aragon_voting',
      'dual_governance',
      'easy_track',
      'snapshot_delegate_registry',
      'snapshot_split_delegation',
    ]);
  });

  it('reports every registered plugin as EVM-backfillable (buildBackfillRuntime present)', () => {
    const plugins = buildBackfillSourcePlugins({
      governor: makeDeps(),
      compToken: makeDeps(),
      aaveGovernorV2: makeDeps(),
      aaveGovernanceV3: makeDeps(),
      aaveVotingMachine: makeDeps(),
      aavePayloadsController: makeDeps(),
      aaveToken: makeDeps(),
      lidoAragonVoting: makeDeps(),
      lidoDualGovernance: makeDeps(),
      lidoEasyTrack: makeDeps(),
      snapshotDelegateRegistry: makeDeps(),
      snapshotSplitDelegation: makeDeps(),
    });

    expect(plugins.every((plugin) => plugin.buildBackfillRuntime != null)).toBe(true);
  });
});

describe('selectDaoSourceForChain', () => {
  const single = [{ id: 's1', chain_id: '0x1' }];
  const multi = [
    { id: 'eth', chain_id: '0x1' },
    { id: 'poly', chain_id: '0x89' },
    { id: 'avax', chain_id: '0xa86a' },
  ];

  it('returns none when no rows match the source_type', () => {
    expect(selectDaoSourceForChain([], undefined)).toEqual({ kind: 'none' });
  });

  it('resolves a single-chain source_type without --chain', () => {
    expect(selectDaoSourceForChain(single, undefined)).toEqual({ kind: 'ok', id: 's1' });
  });

  it('rejects a multi-chain source_type as ambiguous without --chain', () => {
    expect(selectDaoSourceForChain(multi, undefined)).toEqual({
      kind: 'ambiguous',
      registered: ['0x1', '0x89', '0xa86a'],
    });
  });

  it('selects the matching chain when --chain is given', () => {
    expect(selectDaoSourceForChain(multi, '0x89')).toEqual({ kind: 'ok', id: 'poly' });
  });

  it('normalizes the requested chain id before matching', () => {
    expect(selectDaoSourceForChain(multi, '0x089')).toEqual({ kind: 'ok', id: 'poly' });
  });

  it('reports not_on_chain with the registered chains when --chain matches nothing', () => {
    expect(selectDaoSourceForChain(multi, '0xa4b1')).toEqual({
      kind: 'not_on_chain',
      chain: '0xa4b1',
      registered: ['0x1', '0x89', '0xa86a'],
    });
  });
});
