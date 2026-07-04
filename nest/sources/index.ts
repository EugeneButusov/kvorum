export { SourcesModule } from './sources.module';
export { buildDriverMetrics, stateReconcilerMetrics } from './reconcile-metrics';
// Re-export the plugin collection token + type so source-blind consumers (apps/api)
// can inject them without importing @sources/* (eslint-banned under apps/api/src).
export { SOURCE_PLUGINS } from '@sources/core';
export type { SourcePlugin } from '@sources/core';

// Per-source API DTOs, owned by each source's nest package and aggregated here so apps/api assembles
// the proposal-detail response without importing @sources/* or naming individual source packages.
import {
  AragonProposalMetadataDto,
  DualGovernanceProposalMetadataDto,
  EasyTrackProposalMetadataDto,
} from '@nest/lido';
import { SnapshotProposalMetadataDto } from '@nest/snapshot';

export { ProposalVotingDto, ProposalPayloadDto, ProposalPayloadGroupDto } from '@nest/aave';
export {
  AragonProposalMetadataDto,
  DualGovernanceProposalMetadataDto,
  EasyTrackProposalMetadataDto,
} from '@nest/lido';
export { SnapshotProposalMetadataDto, OffchainDelegationDto } from '@nest/snapshot';
export { OffchainDiscussionLinkDto } from '@nest/forum';

// The discriminated set of proposal-detail `metadata` variants (by source `kind`). apps/api spreads
// this into the OpenAPI union so it never names individual sources; a new source's DTO joins here.
export const PROPOSAL_METADATA_DTOS = [
  AragonProposalMetadataDto,
  SnapshotProposalMetadataDto,
  DualGovernanceProposalMetadataDto,
  EasyTrackProposalMetadataDto,
];
