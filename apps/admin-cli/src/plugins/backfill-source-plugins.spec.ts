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
});

// Canonical AAVE ERC-20 address (the aave_token config validates token_address against it).
const AAVE_ERC20_ADDRESS = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

describe('buildBackfillSourcePlugins', () => {
  it('bootstraps Compound and all backfill-capable Aave plugins transparently', () => {
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

  it('returns null for an unknown source_type', () => {
    expect(resolvePluginAndConfig('unknown_source' as never, {}, plugins)).toBeNull();
  });
});

describe('isBackfillableSourceType', () => {
  const plugins = buildBackfillSourcePlugins(allDeps());

  it('every registered backfill plugin declares evm transport (drift guard)', () => {
    expect(plugins.every((plugin) => plugin.transport === 'evm')).toBe(true);
  });

  it('is true for registered EVM source types', () => {
    expect(isBackfillableSourceType('aave_governance_v3', plugins)).toBe(true);
    expect(isBackfillableSourceType('compound_governor_bravo', plugins)).toBe(true);
  });

  it('is false for reconcile, off-chain, and unknown source types (not in the registry)', () => {
    expect(isBackfillableSourceType('aave_governance_v3_reconcile', plugins)).toBe(false);
    expect(isBackfillableSourceType('snapshot', plugins)).toBe(false);
    expect(isBackfillableSourceType('discourse_forum', plugins)).toBe(false);
    expect(isBackfillableSourceType('unknown_source', plugins)).toBe(false);
  });
});
