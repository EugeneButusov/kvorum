export {
  AAVE_GOVERNANCE_V3_INTERFACE,
  AAVE_GOVERNANCE_V3_TOPICS,
  interfaceForAaveGovernanceV3,
} from './abi/events';
export type { AaveGovernanceV3EventType } from './abi/events';
export { decodeAaveGovernanceV3Log } from './abi/decoder';
export { AAVE_V3_CHOICES } from './domain/choices';
export { loadAbiLibrary } from '../calldata/abi-library';
export type { LoadedAbiLibrary, AbiEntry } from '../calldata/abi-library';
export { extractAaveTitle } from './domain/title-extractor';
export { AaveGovernanceActorAddressDeriver } from './domain/actor-address-deriver';
export { AaveIpfsTitleFetcher } from './domain/ipfs-title-fetcher';
export { AaveGovernanceProjectionApplier } from './domain/governance-projection-applier';
export {
  projectAaveGovernanceV3Event,
  AaveProposalProjectionError,
} from './domain/proposal-projector';
export type {
  AaveGovernanceV3Event,
  PayloadSentPayload,
  ProposalCanceledPayload,
  ProposalCreatedPayload,
  ProposalExecutedPayload,
  ProposalFailedPayload,
  ProposalQueuedPayload,
  VotingActivatedPayload,
} from './domain/types';
export type {
  EventArchiveAaveGovernanceV3,
  EventArchiveAaveGovernanceV3Table,
  NewEventArchiveAaveGovernanceV3,
} from './persistence/schema';
export type { AaveGovernanceArchivePayloadRow } from './persistence/archive-payload-repository';
export { AaveGovernanceArchivePayloadRepository } from './persistence/archive-payload-repository';
export type { AaveAddressCandidate, AaveActorAddressSource } from './domain/actor-address-deriver';
export type { AaveIpfsFetchResult, AaveIpfsTitleFetcherDeps } from './domain/ipfs-title-fetcher';
export type {
  AaveProposalProjection,
  AaveProposalCreatedProjection,
  AaveProposalStateTransitionProjection,
  AaveVotingActivatedProjection,
  AavePayloadDeclaredProjection,
  AaveProjectionArchiveRow,
  AaveProposalWithoutResolvedRefs,
} from './domain/proposal-projector';
export type {
  AaveDerivationFailureReason,
  AaveDerivationOutcome,
  AaveGovernanceProjectionApplierDeps,
  AaveGovernanceProjectionMetrics,
} from './domain/governance-projection-applier';
export type {
  AaveGovernanceEventData,
  AaveGovernanceEventRepositoryDeps,
} from './persistence/event-repository.types';
export { AaveGovernanceEventRepository } from './persistence/event-repository';
export type {
  AaveGovernanceArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
} from './ingestion/archive-writer.types';
export { AaveGovernanceArchiveWriter } from './ingestion/archive-writer';
export type { AaveGovernanceIngesterListenerDeps } from './ingestion/ingester-listener';
export { makeAaveGovernanceIngesterListener } from './ingestion/ingester-listener';
export type { AaveGovernanceV3Config, AaveGovernanceV3PluginDeps } from './plugin/plugin';
export {
  AaveGovernanceV3ConfigSchema,
  SUPPORTED_CHAIN_IDS,
  createAaveGovernanceV3Plugin,
} from './plugin/plugin';
export {
  GOVERNANCE_STATE_INTERFACE,
  AaveGovernanceStateDecodeError,
  decodeExpirationTimeResult,
  decodeProposalStateResult,
  encodeExpirationTimeCall,
  encodeGetProposalStateCall,
  mapAaveStateCode,
} from './abi/governance-state';
export { AaveGovernanceStateReconciler } from './reconcile/aave-governance-state-reconciler';
export type { AaveGovernanceReconcilePluginDeps } from './reconcile/aave-governance-reconcile-plugin';
export { createAaveGovernanceV3ReconcilePlugin } from './reconcile/aave-governance-reconcile-plugin';
