export type {
  EventArchiveCompoundGovernorBravo,
  EventArchiveCompoundGovernorBravoTable,
  NewEventArchiveCompoundGovernorBravo,
} from './persistence/schema';

export {
  COMPOUND_GOVERNOR_EVENTS,
  COMPOUND_GOVERNOR_INTERFACE,
  COMPOUND_EVENT_TOPICS,
} from './abi/events';
export type { CompoundEventType } from './abi/events';

export type {
  CompoundGovernorEvent,
  ProposalCreatedPayload,
  ProposalQueuedPayload,
  ProposalExecutedPayload,
  ProposalCanceledPayload,
} from './domain/types';
export { DecodeError } from './domain/types';

export { decodeCompoundLog } from './abi/decoder';
export {
  GOVERNOR_STATE_INTERFACE,
  TIMELOCK_INTERFACE,
  GovernorStateDecodeError,
  encodeStateCall,
  decodeStateResult,
  encodeTimelockCall,
  decodeTimelockResult,
  encodeGracePeriodCall,
  decodeGracePeriodResult,
  encodeDelayCall,
  decodeDelayResult,
  mapGovernorStateCode,
} from './abi/governor-state';
export { extractCompoundTitle } from './domain/title-extractor';
export type {
  CompoundProjectionArchiveRow,
  CompoundProposalProjection,
  ProposalCreatedProjection,
  ProposalStateTransitionProjection,
  ProposalWithoutResolvedRefs,
} from './domain/proposal-projector';
export { ProposalProjectionError, projectCompoundProposalEvent } from './domain/proposal-projector';

export type {
  CompoundDerivationFailureReason,
  CompoundDerivationOutcome,
  CompoundProjectionApplierDeps,
  CompoundProjectionMetrics,
} from './domain/compound-projection-applier';
export { CompoundProjectionApplier } from './domain/compound-projection-applier';

export type { CompoundArchivePayloadRow } from './persistence/compound-archive-payload-repository';
export { CompoundArchivePayloadRepository } from './persistence/compound-archive-payload-repository';

export type {
  ReconcilePerChainBound,
  StaleReconciliationRow,
  ReconcileStateInput,
} from './persistence/compound-proposal-repository';
export { CompoundProposalRepository } from './persistence/compound-proposal-repository';

export type { EventData, EventRepositoryDeps } from './persistence/event-repository.types';
export { EventRepository } from './persistence/event-repository';

export type {
  ArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
} from './ingestion/archive-writer.types';
export { ArchiveWriter } from './ingestion/archive-writer';

export type { IngesterListenerDeps } from './ingestion/ingester-listener';
export { makeIngesterListener } from './ingestion/ingester-listener';
export { CompoundStateReconciler } from './reconcile/compound-state-reconciler';

export type { CompoundGovernorConfig, CompoundGovernorPluginDeps } from './plugin/plugin';
export {
  createCompoundGovernorBravoPlugin,
  createCompoundGovernorAlphaPlugin,
  createCompoundPlugins,
} from './plugin/plugin';
