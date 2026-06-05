export type {
  EventArchiveCompoundGovernorBravo,
  EventArchiveCompoundGovernorBravoTable,
  NewEventArchiveCompoundGovernorBravo,
} from './persistence/schema';

export {
  COMPOUND_GOVERNOR_ALPHA_INTERFACE,
  COMPOUND_GOVERNOR_BRAVO_INTERFACE,
  COMPOUND_GOVERNOR_OZ_INTERFACE,
  COMPOUND_ALPHA_TOPICS,
  COMPOUND_BRAVO_TOPICS,
  COMPOUND_OZ_TOPICS,
  interfaceForSource,
} from './abi/events';
export type { CompoundEventType, CompoundGovernorVariant } from './abi/events';

export type {
  CompoundGovernorEvent,
  ProposalCreatedPayload,
  ProposalQueuedPayload,
  ProposalExecutedPayload,
  ProposalCanceledPayload,
  VoteCastPayload,
} from './domain/types';
export { DecodeError } from '@sources/core';

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
  GovernorProjectionApplierDeps,
  GovernorProjectionMetrics,
} from './domain/governor-projection-applier';
export { GovernorProjectionApplier } from './domain/governor-projection-applier';
export type {
  CompoundVoteDerivationFailureReason,
  CompoundVoteDerivationOutcome,
  GovernorVoteProjectionApplierDeps,
  GovernorVoteProjectionMetrics,
} from './domain/governor-vote-projection-applier';
export { GovernorVoteProjectionApplier } from './domain/governor-vote-projection-applier';
export type { VoteProjectionContext, VoteProjectionResult } from './domain/vote-projector';
export { projectVoteCast } from './domain/vote-projector';
export { VoteBlockTimestampFetcher } from '@sources/core';

export type { GovernorArchivePayloadRow } from './persistence/governor-archive-payload-repository';
export { GovernorArchivePayloadRepository } from './persistence/governor-archive-payload-repository';

export type {
  StaleReconciliationRow,
  ReconcileStateInput,
} from './persistence/compound-proposal-repository';
export { CompoundProposalRepository } from './persistence/compound-proposal-repository';

export type {
  GovernorEventData,
  GovernorEventRepositoryDeps,
} from './persistence/event-repository.types';
export { GovernorEventRepository } from './persistence/event-repository';

export type { GovernorArchiveWriterDeps } from './ingestion/archive-writer.types';
export { GovernorArchiveWriter } from './ingestion/archive-writer';

export type { IngesterListenerDeps } from './ingestion/ingester-listener';
export { makeGovernorIngesterListener } from './ingestion/ingester-listener';
export { CompoundStateReconciler } from './reconcile/compound-state-reconciler';
export { ReconcileDriver } from '@sources/core';
export type { ReconcileBound, ReconcileDriverMetrics, ReconcilePerChainBound } from '@sources/core';
export type { CompoundReconcilePluginDeps } from './reconcile/compound-reconcile-plugin';
export {
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
} from './reconcile/compound-reconcile-plugin';

export type { CompoundGovernorConfig, CompoundGovernorPluginDeps } from './plugin/plugin';
export {
  SUPPORTED_CHAIN_IDS,
  createCompoundGovernorBravoPlugin,
  createCompoundGovernorAlphaPlugin,
  createCompoundGovernorOzPlugin,
  createCompoundPlugins,
} from './plugin/plugin';
export { COMPOUND_PROPOSAL_CHOICES } from '../proposal-choices';
export { loadAbiLibrary } from '../calldata/abi-library';
export type { LoadedAbiLibrary, AbiEntry } from '../calldata/abi-library';
export { decodeByHeuristic } from '../calldata/heuristics';
export type { HeuristicResult } from '../calldata/heuristics';

export {
  CalldataDecoder,
  EtherscanClient,
  readCalldataDecoderConfig,
  ChainNotReadyError,
} from '@sources/core';
export type {
  DecodeInput,
  DecodeResult,
  DecodeSource,
  DecoderDependencies,
  EtherscanClientLike,
  EtherscanClientConfig,
  CalldataDecoderConfig,
  EtherscanConfig,
} from '@sources/core';
