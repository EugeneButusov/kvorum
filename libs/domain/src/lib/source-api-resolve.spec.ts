import type { ProposalExtension, SourceApiContribution } from './source-api-contribution';
import {
  choiceBoundsFor,
  delegationModelFor,
  getProposalExtensionFor,
  resolveContribution,
} from './source-api-resolve';

const proposalExt: ProposalExtension = { voting: null, payloads: [] };

const aave: SourceApiContribution = {
  sourceTypes: ['aave_governance_v3', 'aave_voting_machine'],
  choiceBounds: () => ({ min: 0, max: 1 }),
  delegationModel: () => 'relationship-only',
  getProposalExtension: () => Promise.resolve(proposalExt),
};

const compound: SourceApiContribution = {
  sourceTypes: ['compound_governor_bravo'],
  choiceBounds: () => ({ min: 0, max: 2 }),
  delegationModel: () => 'power-bearing',
  getProposalExtension: () => Promise.resolve(null),
};

const contributions = [aave, compound];

describe('source-api-resolve', () => {
  describe('resolveContribution', () => {
    it('finds the contribution that declares the source type', () => {
      expect(resolveContribution(contributions, 'aave_voting_machine')).toBe(aave);
      expect(resolveContribution(contributions, 'compound_governor_bravo')).toBe(compound);
    });

    it('returns undefined for an unknown source type', () => {
      expect(resolveContribution(contributions, 'nope')).toBeUndefined();
    });
  });

  describe('choiceBoundsFor', () => {
    it('delegates to the matching contribution', () => {
      expect(choiceBoundsFor(contributions, 'aave_governance_v3')).toEqual({ min: 0, max: 1 });
      expect(choiceBoundsFor(contributions, 'compound_governor_bravo')).toEqual({ min: 0, max: 2 });
    });

    it('falls back to the widest default for unknown source types', () => {
      expect(choiceBoundsFor(contributions, 'nope')).toEqual({ min: 0, max: 2 });
      expect(choiceBoundsFor([], 'anything')).toEqual({ min: 0, max: 2 });
    });
  });

  describe('delegationModelFor', () => {
    it('delegates to the matching contribution', () => {
      expect(delegationModelFor(contributions, 'aave_governance_v3')).toBe('relationship-only');
      expect(delegationModelFor(contributions, 'compound_governor_bravo')).toBe('power-bearing');
    });

    it('falls back to power-bearing for unknown source types', () => {
      expect(delegationModelFor(contributions, 'nope')).toBe('power-bearing');
      expect(delegationModelFor([], 'anything')).toBe('power-bearing');
    });
  });

  describe('getProposalExtensionFor', () => {
    it('delegates to the matching contribution', async () => {
      await expect(
        getProposalExtensionFor(contributions, 'p1', 'aave_governance_v3'),
      ).resolves.toBe(proposalExt);
      await expect(
        getProposalExtensionFor(contributions, 'p1', 'compound_governor_bravo'),
      ).resolves.toBeNull();
    });

    it('resolves null for unknown source types (never throws)', async () => {
      await expect(getProposalExtensionFor(contributions, 'p1', 'nope')).resolves.toBeNull();
      await expect(getProposalExtensionFor([], 'p1', 'anything')).resolves.toBeNull();
    });
  });
});
