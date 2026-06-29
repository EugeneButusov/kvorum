import type {
  ChoiceBounds,
  DelegationModel,
  ProposalExtension,
  SourceReadExtension,
} from '@libs/domain';

// Stub — mirrors makeLidoReadExtension. AD1 ingests raw archive only; the real read surface
// (choiceBounds per voting_type, snapshot_proposal_metadata via getProposalExtension) lands with
// AD2/AD4 derivation and the AF read-path work. Inert until Snapshot proposals/votes are derived.
export function makeSnapshotReadExtension(): SourceReadExtension {
  return {
    sourceTypes: ['snapshot'],
    choiceBounds(_sourceType: string): ChoiceBounds {
      // Placeholder. Snapshot choices are 1..N and vary per proposal — AD4/AF replace this.
      return { min: 0, max: 1 };
    },
    delegationModel(_sourceType: string): DelegationModel {
      // Snapshot carries reported voting power on each vote/delegation row; AD5 confirms.
      return 'power-bearing';
    },
    getProposalExtension(
      _proposalId: string,
      _sourceType: string,
    ): Promise<ProposalExtension | null> {
      return Promise.resolve(null);
    },
  };
}
