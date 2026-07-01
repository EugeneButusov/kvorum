export type {
  ArchiveEventSnapshot,
  ArchiveEventSnapshotTable,
  NewArchiveEventSnapshot,
  SnapshotProposalMetadata,
  SnapshotProposalMetadataTable,
  SnapshotProposalMetadataUpdate,
  NewSnapshotProposalMetadata,
} from './persistence/schema';

export { SnapshotClient, DEFAULT_SNAPSHOT_GRAPHQL_URL } from './client/client';
export type { SnapshotClientOptions } from './client/client';
export {
  createSnapshotPlugin,
  SnapshotConfigSchema,
  SUPPORTED_CHAIN_IDS,
  DEFAULT_POLL_INTERVAL_MS,
} from './plugin/plugin';
export type { SnapshotConfig, SnapshotPluginDeps } from './plugin/plugin';
export { makeSnapshotOffChainArchiveWriter } from './ingestion/archive-writer';
export { makeSnapshotPollListener, DEFAULT_PAGE_SIZE, SKIP_CAP } from './ingestion/poll-listener';
export type { SnapshotStaleProvider } from './ingestion/poll-listener';
export { contentHash } from './ingestion/content-hash';
export { makeSnapshotReadExtension } from './api/snapshot-read-extension';
export { snapshotMetrics } from './metrics';
export { SnapshotArchivePayloadRepository } from './persistence/archive-payload-repository';
export { SnapshotProposalRepository } from './persistence/snapshot-proposal-repository';
export { SnapshotActorAddressDeriver } from './domain/actor-address-deriver';
export { SnapshotProposalProjectionApplier } from './domain/proposal-projection-applier';
export { SnapshotVoteProjectionApplier } from './domain/vote-projection-applier';
export type { SnapshotVoteProjectionApplierDeps } from './domain/vote-projection-applier';
export { SnapshotVoteChoiceRepository } from './persistence/snapshot-vote-choice-repository';
export { decodeVoteChoice } from './domain/vote-choice-decoder';
export type { VoteChoiceDecode, DecodedChoice } from './domain/vote-choice-decoder';
export { roundVp, networkToChainId } from './domain/voting-power';
export type { SnapshotProposalProjectionApplierDeps } from './domain/proposal-projection-applier';
export { projectSnapshotProposal } from './domain/proposal-projector';
export type { SnapshotProposalProjection } from './domain/proposal-projector';
export { extractSnapshotTitle } from './domain/title-extractor';
export type {
  SnapshotCursor,
  SnapshotSubCursor,
  SnapshotProposalRow,
  SnapshotVoteRow,
  SnapshotProposalPayload,
  SnapshotVotePayload,
} from './domain/types';

// ── On-chain delegation (Delegate Registry + Split Delegation) ────────────
export {
  DELEGATE_REGISTRY_ADDRESS,
  SPLIT_DELEGATION_ADDRESS,
  SNAPSHOT_DELEGATION_CHAIN_ID,
  SNAPSHOT_DELEGATION_SPACES,
  SNAPSHOT_DELEGATION_PROJECTION_STAGE,
  DELEGATION_SYSTEM,
  DELEGATION_EVENT_TYPE,
} from './delegation/constants';
export {
  bytes32ToAddress,
  decodeSpaceId,
  encodeSpaceId,
  GLOBAL_SPACE_ID,
} from './delegation/address';
export { SnapshotDelegationRepository } from './delegation/snapshot-delegation-repository';
export type { CurrentDelegate } from './delegation/snapshot-delegation-repository';
export { SnapshotSpaceDaoResolver } from './delegation/space-dao-resolver';
export type {
  SnapshotDelegation,
  NewSnapshotDelegation,
  SnapshotDelegationTable,
} from './persistence/schema';

// Delegate Registry
export { decodeDelegateRegistryLog } from './delegate-registry/abi/decoder';
export { DELEGATE_REGISTRY_TOPICS } from './delegate-registry/abi/events';
export type { DelegateRegistryEvent } from './delegate-registry/domain/types';
export { DelegateRegistryArchiveWriter } from './delegate-registry/ingestion/archive-writer';
export { DelegateRegistryEventRepository } from './delegate-registry/persistence/event-repository';
export { DelegateRegistryArchivePayloadRepository } from './delegate-registry/persistence/archive-payload-repository';
export {
  createDelegateRegistryPlugin,
  DelegateRegistryConfigSchema,
} from './delegate-registry/plugin/plugin';
export type { DelegateRegistryConfig } from './delegate-registry/plugin/plugin';
export { DelegateRegistryActorAddressDeriver } from './delegate-registry/domain/actor-address-deriver';
export { projectDelegateRegistryEvent } from './delegate-registry/domain/delegation-projector';
export { DelegateRegistryDelegationProjectionApplier } from './delegate-registry/domain/delegation-projection-applier';
export type {
  SnapshotDelegationProjectionMetrics,
  DelegationDerivationOutcome,
  DelegationDerivationFailureReason,
} from './delegate-registry/domain/delegation-projection-applier';

// Split Delegation
export { decodeSplitDelegationLog } from './split-delegation/abi/decoder';
export { SPLIT_DELEGATION_TOPICS } from './split-delegation/abi/events';
export type { SplitDelegationEvent, SplitDelegationEntry } from './split-delegation/domain/types';
export { isTrackedSplitDelegation } from './split-delegation/domain/context-filter';
export { normalizeWeights } from './split-delegation/domain/weights';
export { SplitDelegationArchiveWriter } from './split-delegation/ingestion/archive-writer';
export { SplitDelegationEventRepository } from './split-delegation/persistence/event-repository';
export { SplitDelegationArchivePayloadRepository } from './split-delegation/persistence/archive-payload-repository';
export {
  createSplitDelegationPlugin,
  SplitDelegationConfigSchema,
} from './split-delegation/plugin/plugin';
export type { SplitDelegationConfig } from './split-delegation/plugin/plugin';
export { SplitDelegationActorAddressDeriver } from './split-delegation/domain/actor-address-deriver';
export { projectSplitDelegationEvent } from './split-delegation/domain/delegation-projector';
export { SplitDelegationProjectionApplier } from './split-delegation/domain/delegation-projection-applier';
