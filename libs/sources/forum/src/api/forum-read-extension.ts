import type {
  ChoiceBounds,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';

// Minimal read surface for the `discourse_forum` source. Forum threads are not proposals/votes and
// carry no delegation — they surface on proposal detail via `proposal_forum_link` (the read-path
// work), not through a source proposal/vote extension. This exists to satisfy the SourcePlugin
// contract; its methods are not reached on the normal forum path.
export function makeForumReadExtension(): SourceReadExtension {
  return {
    sourceTypes: ['discourse_forum'],
    choiceBounds(_sourceType: string): ChoiceBounds {
      return { min: 0, max: 0 };
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
