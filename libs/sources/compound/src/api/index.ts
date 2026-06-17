import type { SourceApiContribution } from '@libs/domain';

export const compoundApiContribution: SourceApiContribution = {
  sourceTypes: ['compound_governor_alpha', 'compound_governor_bravo', 'compound_governor_oz'],
  choiceBounds(_sourceType) {
    return { min: 0, max: 2 };
  },
  delegationModel(_sourceType) {
    return 'power-bearing';
  },
  getProposalExtension(_proposalId, _sourceType) {
    return Promise.resolve(null);
  },
};
