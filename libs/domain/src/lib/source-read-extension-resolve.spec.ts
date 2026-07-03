import type {
  CuratedDaoSourceConfig,
  ProposalExtension,
  SourceReadExtension,
} from './source-read-extension';
import {
  choiceBoundsFor,
  curateEvmSourceConfig,
  curateSourceConfigFor,
  delegationModelFor,
  getProposalExtensionFor,
  resolveReadExtension,
} from './source-read-extension-resolve';

const proposalExt: ProposalExtension = { voting: null, payloads: [], metadata: null };

const aave: SourceReadExtension = {
  sourceTypes: ['aave_governance_v3', 'aave_voting_machine'],
  choiceBounds: () => ({ min: 0, max: 1 }),
  delegationModel: () => 'relationship-only',
  getProposalExtension: () => Promise.resolve(proposalExt),
};

const compound: SourceReadExtension = {
  sourceTypes: ['compound_governor_bravo'],
  choiceBounds: () => ({ min: 0, max: 2 }),
  delegationModel: () => 'power-bearing',
  getProposalExtension: () => Promise.resolve(null),
};

// A source that overrides curateSourceConfig to mark itself off-chain.
const offchain: SourceReadExtension = {
  sourceTypes: ['snapshot'],
  choiceBounds: () => ({ min: 0, max: 127 }),
  delegationModel: () => 'power-bearing',
  getProposalExtension: () => Promise.resolve(null),
  curateSourceConfig: (_sourceType, raw): CuratedDaoSourceConfig => ({
    off_chain: true,
    space: (raw as { space?: string }).space,
  }),
};

const extensions = [aave, compound];

describe('source-read-extension-resolve', () => {
  describe('resolveReadExtension', () => {
    it('finds the contribution that declares the source type', () => {
      expect(resolveReadExtension(extensions, 'aave_voting_machine')).toBe(aave);
      expect(resolveReadExtension(extensions, 'compound_governor_bravo')).toBe(compound);
    });

    it('returns undefined for an unknown source type', () => {
      expect(resolveReadExtension(extensions, 'nope')).toBeUndefined();
    });
  });

  describe('choiceBoundsFor', () => {
    it('delegates to the matching contribution', () => {
      expect(choiceBoundsFor(extensions, 'aave_governance_v3')).toEqual({ min: 0, max: 1 });
      expect(choiceBoundsFor(extensions, 'compound_governor_bravo')).toEqual({ min: 0, max: 2 });
    });

    it('falls back to the widest default for unknown source types', () => {
      expect(choiceBoundsFor(extensions, 'nope')).toEqual({ min: 0, max: 2 });
      expect(choiceBoundsFor([], 'anything')).toEqual({ min: 0, max: 2 });
    });
  });

  describe('delegationModelFor', () => {
    it('delegates to the matching contribution', () => {
      expect(delegationModelFor(extensions, 'aave_governance_v3')).toBe('relationship-only');
      expect(delegationModelFor(extensions, 'compound_governor_bravo')).toBe('power-bearing');
    });

    it('falls back to power-bearing for unknown source types', () => {
      expect(delegationModelFor(extensions, 'nope')).toBe('power-bearing');
      expect(delegationModelFor([], 'anything')).toBe('power-bearing');
    });
  });

  describe('getProposalExtensionFor', () => {
    it('delegates to the matching contribution', async () => {
      await expect(getProposalExtensionFor(extensions, 'p1', 'aave_governance_v3')).resolves.toBe(
        proposalExt,
      );
      await expect(
        getProposalExtensionFor(extensions, 'p1', 'compound_governor_bravo'),
      ).resolves.toBeNull();
    });

    it('resolves null for unknown source types (never throws)', async () => {
      await expect(getProposalExtensionFor(extensions, 'p1', 'nope')).resolves.toBeNull();
      await expect(getProposalExtensionFor([], 'p1', 'anything')).resolves.toBeNull();
    });
  });

  describe('curateEvmSourceConfig', () => {
    it('extracts + lowercases contract_address and stringifies chain_id', () => {
      expect(
        curateEvmSourceConfig({ contract_address: '0xABCD', chain_id: 1, extra: 'ignored' }),
      ).toEqual({ off_chain: false, contract_address: '0xabcd', chain_id: '1' });
    });

    it('handles invalid shapes without throwing', () => {
      expect(curateEvmSourceConfig(null)).toEqual({ off_chain: false });
      expect(curateEvmSourceConfig(['x'])).toEqual({ off_chain: false });
      expect(curateEvmSourceConfig({})).toEqual({ off_chain: false });
    });
  });

  describe('curateSourceConfigFor', () => {
    it('uses the EVM default for sources that do not override', () => {
      expect(
        curateSourceConfigFor(extensions, 'compound_governor_bravo', {
          contract_address: '0xEF',
          chain_id: '10',
        }),
      ).toEqual({ off_chain: false, contract_address: '0xef', chain_id: '10' });
    });

    it('delegates to the source override when present', () => {
      expect(
        curateSourceConfigFor([...extensions, offchain], 'snapshot', {
          space: 'lido-snapshot.eth',
        }),
      ).toEqual({ off_chain: true, space: 'lido-snapshot.eth' });
    });

    it('falls back to the EVM default for unknown source types', () => {
      expect(curateSourceConfigFor([], 'anything', { chain_id: '0x1' })).toEqual({
        off_chain: false,
        chain_id: '0x1',
      });
    });
  });
});
