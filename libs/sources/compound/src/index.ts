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
// Re-export the COMP token CH table type so @sources/compound is the canonical import point.
export type {
  EventArchiveCompoundCompToken,
  EventArchiveCompoundCompTokenTable,
  NewEventArchiveCompoundCompToken,
} from './comp-token/persistence/schema';

export {
  COMPOUND_GOVERNOR_ALPHA_INTERFACE,
  COMPOUND_GOVERNOR_BRAVO_INTERFACE,
  COMPOUND_GOVERNOR_OZ_INTERFACE,
  COMPOUND_ALPHA_TOPICS,
  COMPOUND_BRAVO_TOPICS,
  COMPOUND_OZ_TOPICS,
  interfaceForSource,
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
  createCompoundGovernorOzPlugin,
  createCompoundPlugins,
  createCompoundGovernorBravoReconcilePlugin,
  createCompoundGovernorOzReconcilePlugin,
} from './governor/index';
export {
  COMP_TOKEN_DEPLOY_BLOCK,
  COMP_TOKEN_ADDRESS,
  COMPOUND_COMP_TOKEN_INTERFACE,
  COMPOUND_COMP_TOKEN_TOPICS,
  decodeCompTokenLog,
  CompTokenEventRepository,
  CompTokenArchiveWriter,
  makeCompTokenIngesterListener,
  createCompTokenPlugin,
  CompTokenSourceConfigSchema,
  COMP_TOKEN_SUPPORTED_CHAIN_IDS,
} from './comp-token/index';

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
  CompoundReconcilePluginDeps,
} from './governor/index';
export type {
  CompTokenEventType,
  CompTokenEvent,
  DelegateChangedPayload,
  DelegateVotesChangedPayload,
  CompTokenEventData,
  CompTokenEventRepositoryDeps,
  CompTokenArchiveWriterDeps,
  CompTokenIngesterListenerDeps,
  CompTokenSourceConfig,
  CompTokenPluginDeps,
} from './comp-token/index';
