import { describe, expect, it, vi } from 'vitest';
import {
  buildBackfillSourcePlugins,
  isBackfillableSourceType,
  resolvePluginAndConfig,
} from './backfill-source-plugins.js';

const makeDeps = () => ({
  archiveWriter: {} as never,
  dlqRepo: {} as never,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
});

const allDeps = () => ({
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

// Canonical AAVE ERC-20 address (the aave_token config validates token_address against it).
const AAVE_ERC20_ADDRESS = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

describe('buildBackfillSourcePlugins', () => {
  it('bootstraps Compound, Aave, Lido, and Snapshot-delegation plugins transparently', () => {
    const plugins = buildBackfillSourcePlugins(allDeps());

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

  it('includes every Aave v3 multi-chain source plus the legacy v2 governor', () => {
    const types = buildBackfillSourcePlugins(allDeps()).map((p) => p.sourceType);
    expect(types).toContain('aave_governor_v2');
    expect(types).toContain('aave_governance_v3');
    expect(types).toContain('aave_voting_machine');
    expect(types).toContain('aave_payloads_controller');
    expect(types).toContain('aave_token');
    expect(types).toContain('compound_governor_bravo');
    expect(types).toContain('compound_comp_token');
  });

  it('includes the three Lido EVM tracks plus both Snapshot on-chain delegation sources', () => {
    const types = buildBackfillSourcePlugins(allDeps()).map((p) => p.sourceType);
    expect(types).toContain('aragon_voting');
    expect(types).toContain('dual_governance');
    expect(types).toContain('easy_track');
    expect(types).toContain('snapshot_delegate_registry');
    expect(types).toContain('snapshot_split_delegation');
  });
});

describe('resolvePluginAndConfig', () => {
  const plugins = buildBackfillSourcePlugins(allDeps());

  it('resolves aave_governor_v2 to the right plugin and parses its config', () => {
    const resolved = resolvePluginAndConfig(
      'aave_governor_v2',
      { governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c' },
      plugins,
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.plugin.sourceType).toBe('aave_governor_v2');
    expect(resolved?.parsedConfig).toMatchObject({
      governor_address: '0xec568fffba86c094cf06b22134b23074dfe2252c',
    });
  });

  it('resolves aave_governance_v3', () => {
    const resolved = resolvePluginAndConfig(
      'aave_governance_v3',
      { governance_address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7' },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('aave_governance_v3');
  });

  it('resolves aave_voting_machine', () => {
    const resolved = resolvePluginAndConfig(
      'aave_voting_machine',
      { voting_machine_address: '0x06a1795a88b82700896583e123f46be43877bfb6' },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('aave_voting_machine');
  });

  it('resolves aave_payloads_controller', () => {
    const resolved = resolvePluginAndConfig(
      'aave_payloads_controller',
      { payloads_controller_address: '0xdabad81af85554e9ae636395611c58f7ec1aaec5' },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('aave_payloads_controller');
  });

  it('resolves aave_token', () => {
    const resolved = resolvePluginAndConfig(
      'aave_token',
      { token_address: AAVE_ERC20_ADDRESS },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('aave_token');
  });

  it('resolves compound_governor_bravo (Compound sources unchanged)', () => {
    const resolved = resolvePluginAndConfig(
      'compound_governor_bravo',
      { governor_address: '0xc0da01a04c3f3e0be433606045bb7017a7323e38', filter_address: null },
      plugins,
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.plugin.sourceType).toBe('compound_governor_bravo');
  });

  it('resolves aragon_voting (Lido two-phase fork)', () => {
    const resolved = resolvePluginAndConfig(
      'aragon_voting',
      { voting_address: '0x2e59a20f205bb85a89c53f1936454680651e618e' },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('aragon_voting');
  });

  it('resolves dual_governance (two watched addresses)', () => {
    const resolved = resolvePluginAndConfig(
      'dual_governance',
      {
        dual_governance_address: '0xc1db28b3301331277e307ffb51c806b0dccf5c0e',
        timelock_address: '0xce0425301c85c5ea2a0873a2dee44d78e02d2b0e',
      },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('dual_governance');
  });

  it('resolves easy_track', () => {
    const resolved = resolvePluginAndConfig(
      'easy_track',
      { easy_track_address: '0xf0211b7660680b49de1a7e9f25c65660f0a13fea' },
      plugins,
    );
    expect(resolved?.plugin.sourceType).toBe('easy_track');
  });

  it('returns null for an unknown source_type', () => {
    expect(resolvePluginAndConfig('unknown_source' as never, {}, plugins)).toBeNull();
  });
});

describe('isBackfillableSourceType', () => {
  const plugins = buildBackfillSourcePlugins(allDeps());

  it('every registered backfill plugin provides a backfill runtime (drift guard)', () => {
    expect(plugins.every((plugin) => plugin.buildBackfillRuntime != null)).toBe(true);
  });

  it('is true for registered EVM source types', () => {
    expect(isBackfillableSourceType('aave_governance_v3', plugins)).toBe(true);
    expect(isBackfillableSourceType('compound_governor_bravo', plugins)).toBe(true);
    expect(isBackfillableSourceType('aragon_voting', plugins)).toBe(true);
    expect(isBackfillableSourceType('dual_governance', plugins)).toBe(true);
    expect(isBackfillableSourceType('easy_track', plugins)).toBe(true);
    expect(isBackfillableSourceType('snapshot_delegate_registry', plugins)).toBe(true);
    expect(isBackfillableSourceType('snapshot_split_delegation', plugins)).toBe(true);
  });

  it('is false for reconcile, off-chain, and unknown source types (not in the registry)', () => {
    expect(isBackfillableSourceType('aave_governance_v3_reconcile', plugins)).toBe(false);
    expect(isBackfillableSourceType('snapshot', plugins)).toBe(false);
    expect(isBackfillableSourceType('discourse_forum', plugins)).toBe(false);
    expect(isBackfillableSourceType('unknown_source', plugins)).toBe(false);
  });
});
