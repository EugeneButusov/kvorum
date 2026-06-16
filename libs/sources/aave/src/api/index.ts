import type { SourceApiContribution } from '@libs/domain';

// PR1 stub: getProposalExtension implemented in PR2 via AaveProposalExtensionReadRepository.
export function makeAaveApiContribution(): SourceApiContribution {
  return {
    sourceTypes: [
      'aave_governance_v3',
      'aave_governor_v2',
      'aave_voting_machine',
      'aave_payloads_controller',
    ],
    choiceBounds(_sourceType) {
      return { min: 0, max: 1 };
    },
    getProposalExtension(_proposalId, _sourceType) {
      return Promise.resolve(null);
    },
  };
}
