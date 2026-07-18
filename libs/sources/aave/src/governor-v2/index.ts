export {
  AAVE_GOVERNOR_V2_INTERFACE,
  AAVE_GOVERNOR_V2_TOPICS,
  interfaceForAaveGovernorV2,
} from './abi/events';
export type { AaveGovernorV2EventType, AaveGovernorV2Topics } from './abi/events';
export { decodeAaveGovernorV2Log } from './abi/decoder';
export {
  GOVERNOR_V2_STATE_INTERFACE,
  EXECUTOR_GRACE_PERIOD_INTERFACE,
  AaveGovernorV2StateDecodeError,
  encodeGetProposalByIdCall,
  decodeGetProposalByIdResult,
  deriveAaveV2State,
  encodeGracePeriodCall,
  decodeGracePeriodResult,
} from './abi/governor-state';
export type { V2ProposalSummary } from './abi/governor-state';
export { AAVE_V2_CHOICES } from './domain/choices';
export type { AaveV2ProposalChoiceTemplate } from './domain/choices';
export { projectAaveGovernorV2Event, V2ProposalProjectionError } from './domain/proposal-projector';
export type {
  V2ProjectionArchiveRow,
  V2ProposalWithoutResolvedRefs,
  V2ProposalCreatedProjection,
  V2ProposalStateTransitionProjection,
  AaveGovernorV2Projection,
} from './domain/proposal-projector';
export { AAVE_GOVERNOR_V2_EVENT_TYPES } from './domain/types';
export type {
  AaveGovernorV2Event,
  V2ProposalCreatedPayload,
  V2VoteEmittedPayload,
  V2ProposalQueuedPayload,
  V2ProposalExecutedPayload,
  V2ProposalCanceledPayload,
} from './domain/types';
export { AaveGovernorV2ActorAddressDeriver } from './domain/actor-address-deriver';
export type {
  AaveV2ActorAddressSource,
  AaveV2AddressCandidate,
} from './domain/actor-address-deriver';
export { AaveGovernorV2ProjectionApplier } from './domain/governor-v2-projection-applier';
export type {
  AaveV2DerivationOutcome,
  AaveV2DerivationFailureReason,
  AaveGovernorV2ProjectionApplierDeps,
  AaveGovernorV2ProjectionMetrics,
} from './domain/governor-v2-projection-applier';
export { AaveGovernorV2VoteProjectionApplier } from './domain/vote-projection-applier';
export type {
  AaveV2VoteDerivationOutcome,
  AaveV2VoteDerivationFailureReason,
  AaveGovernorV2VoteProjectionApplierDeps,
  AaveGovernorV2VoteProjectionMetrics,
} from './domain/vote-projection-applier';
export type {
  EventArchiveAaveGovernorV2,
  EventArchiveAaveGovernorV2Table,
  NewEventArchiveAaveGovernorV2,
} from './persistence/schema';
export type { AaveGovernorV2ArchivePayloadRow } from './persistence/archive-payload-repository';
export { AaveGovernorV2ArchivePayloadRepository } from './persistence/archive-payload-repository';
export type {
  AaveGovernorV2EventData,
  AaveGovernorV2EventRepositoryDeps,
} from './persistence/event-repository.types';
export { AaveGovernorV2EventRepository } from './persistence/event-repository';
export type {
  AaveGovernorV2ArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
} from './ingestion/archive-writer.types';
export { AaveGovernorV2ArchiveWriter } from './ingestion/archive-writer';
export type { AaveGovernorV2IngesterListenerDeps } from './ingestion/ingester-listener';
export { makeAaveGovernorV2IngesterListener } from './ingestion/ingester-listener';
export type { AaveGovernorV2Config, AaveGovernorV2PluginDeps } from './plugin/plugin';
export {
  AaveGovernorV2ConfigSchema,
  SUPPORTED_CHAIN_IDS as AAVE_GOVERNOR_V2_SUPPORTED_CHAIN_IDS,
  createAaveGovernorV2Plugin,
} from './plugin/plugin';
export { AaveGovernorV2StateReconciler } from './reconcile/aave-governor-v2-state-reconciler';
export type { AaveGovernorV2ReconcilePluginDeps } from './reconcile/aave-governor-v2-reconcile-plugin';
export { createAaveGovernorV2ReconcilePlugin } from './reconcile/aave-governor-v2-reconcile-plugin';
