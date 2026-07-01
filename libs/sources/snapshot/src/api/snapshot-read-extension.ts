import type {
  ChoiceBounds,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';

// Read surface for the Snapshot source family: the off-chain `snapshot` proposal/vote source plus
// the two on-chain delegation source types. The full read surface (choiceBounds per voting_type,
// snapshot_proposal_metadata via getProposalExtension) lands with the read-path work.
const DELEGATION_SOURCE_TYPES = ['snapshot_delegate_registry', 'snapshot_split_delegation'];

export function makeSnapshotReadExtension(): SourceReadExtension {
  return {
    sourceTypes: ['snapshot', ...DELEGATION_SOURCE_TYPES],
    choiceBounds(_sourceType: string): ChoiceBounds {
      // Placeholder. Snapshot choices are 1..N and vary per proposal; refined by the read-path work.
      return { min: 0, max: 1 };
    },
    delegationModel(sourceType: string): DelegationModel {
      // The on-chain delegation events carry no power figure (relationship only); the off-chain
      // `snapshot` source carries reported voting power on each vote.
      return DELEGATION_SOURCE_TYPES.includes(sourceType) ? 'relationship-only' : 'power-bearing';
    },
    getProposalExtension(
      _proposalId: string,
      _sourceType: string,
    ): Promise<ProposalExtension | null> {
      return Promise.resolve(null);
    },
  };
}
