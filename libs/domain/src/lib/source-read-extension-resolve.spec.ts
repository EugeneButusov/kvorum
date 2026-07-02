import type { ProposalExtension, SourceReadExtension } from './source-read-extension';
import {
  choiceBoundsFor,
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
});
