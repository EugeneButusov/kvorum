import { describe, expect, it } from 'vitest';
import {
  buildAllIngesterPlugins,
  UnknownSourceTypeError,
  validateSourceConfig,
} from './source-config-validation.js';

describe('buildAllIngesterPlugins', () => {
  it('covers every config-bearing ingester, EVM plus off-chain (snapshot + discourse_forum)', () => {
    const types = buildAllIngesterPlugins().map((p) => p.sourceType);
    // EVM (backfill registry)
    expect(types).toContain('compound_governor_bravo');
    expect(types).toContain('aave_governance_v3');
    expect(types).toContain('aragon_voting');
    expect(types).toContain('dual_governance');
    expect(types).toContain('easy_track');
    expect(types).toContain('snapshot_delegate_registry');
    expect(types).toContain('snapshot_split_delegation');
    // Off-chain (poll ingesters — absent from the EVM backfill registry)
    expect(types).toContain('snapshot');
    expect(types).toContain('discourse_forum');
  });
});

describe('validateSourceConfig', () => {
  it('accepts a valid EVM config (aragon_voting)', () => {
    expect(() =>
      validateSourceConfig('aragon_voting', {
        voting_address: '0x2e59a20f205bb85a89c53f1936454680651e618e',
      }),
    ).not.toThrow();
  });

  it('accepts a valid off-chain Snapshot config', () => {
    expect(() => validateSourceConfig('snapshot', { space: 'lido-snapshot.eth' })).not.toThrow();
  });

  it('accepts a valid off-chain Discourse config', () => {
    expect(() =>
      validateSourceConfig('discourse_forum', {
        host: 'research.lido.fi',
        categories: ['proposals'],
      }),
    ).not.toThrow();
  });

  it('rejects an invalid config for a known source_type (Zod parse error)', () => {
    expect(() => validateSourceConfig('snapshot', { space: '' })).toThrow();
    expect(() =>
      validateSourceConfig('aragon_voting', { voting_address: 'not-an-address' }),
    ).toThrow();
  });

  it('rejects an unrecognized source_type (no silent pass)', () => {
    expect(() => validateSourceConfig('not_a_real_source', {})).toThrow(UnknownSourceTypeError);
  });

  it('rejects a reconcile source_type (not a configurable ingester)', () => {
    expect(() => validateSourceConfig('aragon_voting_reconcile', {})).toThrow(
      UnknownSourceTypeError,
    );
  });
});
