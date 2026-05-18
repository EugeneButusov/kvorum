export { COMPOUND_PROPOSAL_CHOICES } from './proposal-choices';
export { loadAbiLibrary } from './calldata/abi-library';
export type { LoadedAbiLibrary, AbiEntry } from './calldata/abi-library';
export { decodeByHeuristic } from './calldata/heuristics';
export type { HeuristicResult } from './calldata/heuristics';
// Re-export from @sources/core so compound remains a single import point for consumers.
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
// Re-export the CH table type so @sources/compound is the canonical import point.
export type {
  EventArchiveCompoundGovernorBravo,
  EventArchiveCompoundGovernorBravoTable,
  NewEventArchiveCompoundGovernorBravo,
} from './governor/index';

export {
  COMPOUND_GOVERNOR_EVENTS,
  COMPOUND_GOVERNOR_INTERFACE,
  COMPOUND_EVENT_TOPICS,
  decodeCompoundLog,
  DecodeError,
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
  CompoundStateReconciler,
  CompoundReconcileDriver,
  CompoundProposalRepository,
  EventRepository,
  extractCompoundTitle,
  ProposalProjectionError,
  CompoundArchivePayloadRepository,
  CompoundProjectionApplier,
  projectCompoundProposalEvent,
  ArchiveWriter,
  makeIngesterListener,
  SUPPORTED_CHAIN_IDS,
  createCompoundGovernorBravoPlugin,
  createCompoundGovernorAlphaPlugin,
  createCompoundPlugins,
} from './governor/index';

export type {
  CompoundEventType,
  CompoundGovernorEvent,
  ProposalCreatedPayload,
  ProposalQueuedPayload,
  ProposalExecutedPayload,
  ProposalCanceledPayload,
  CompoundProjectionArchiveRow,
  CompoundProposalProjection,
  ProposalCreatedProjection,
  ProposalStateTransitionProjection,
  ProposalWithoutResolvedRefs,
  CompoundArchivePayloadRow,
  CompoundDerivationFailureReason,
  CompoundDerivationOutcome,
  CompoundProjectionApplierDeps,
  CompoundProjectionMetrics,
  ArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
  IngesterListenerDeps,
  EventData,
  EventRepositoryDeps,
  CompoundGovernorConfig,
  CompoundGovernorPluginDeps,
  ReconcilePerChainBound,
  StaleReconciliationRow,
  ReconcileStateInput,
  ReconcileBound,
  ReconcileDriverMetrics,
} from './governor/index';
