import type {
  SourceReadExtension,
  ChoiceBounds,
  DelegationModel,
  ProposalExtension,
} from '@libs/domain';

// Stub — real implementation in AF1 (threads pgDb, replaces Promise.resolve(null)).
export function makeLidoReadExtension(): SourceReadExtension {
  return {
    sourceTypes: ['aragon_voting'],
    choiceBounds(_sourceType: string): ChoiceBounds {
      return { min: 0, max: 1 };
    },
    delegationModel(_sourceType: string): DelegationModel {
      return 'relationship-only';
    },
    getProposalExtension(
      _proposalId: string,
      _sourceType: string,
    ): Promise<ProposalExtension | null> {
      return Promise.resolve(null);
    },
  };
}
