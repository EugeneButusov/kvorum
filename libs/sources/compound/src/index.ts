export { COMPOUND_PROPOSAL_CHOICES } from './proposal-choices';
export { CalldataDecoder } from './calldata/decoder';
export type { DecodeInput } from './calldata/decoder';
export { ChainNotReadyError } from './calldata/types';
export type {
  DecodeResult,
  DecodeSource,
  DecoderDependencies,
  EtherscanClientLike,
} from './calldata/types';
export { loadAbiLibrary } from './calldata/abi-library';
export type { LoadedAbiLibrary, AbiEntry } from './calldata/abi-library';
export { EtherscanClient } from './calldata/etherscan-client';
export type { EtherscanClientConfig } from './calldata/etherscan-client';
export { readCalldataDecoderConfig } from './calldata/config';
export type { CalldataDecoderConfig, EtherscanConfig } from './calldata/config';
// Re-export the CH table type so @sources/compound is the canonical
// import point for consumers of the compound archive schema.
export type {
  EventArchiveCompoundGovernor,
  EventArchiveCompoundGovernorTable,
  NewEventArchiveCompoundGovernor,
} from './governor/index';

export {
  COMPOUND_GOVERNOR_EVENTS,
  COMPOUND_GOVERNOR_INTERFACE,
  COMPOUND_EVENT_TOPICS,
  decodeCompoundLog,
  DecodeError,
  EventRepository,
  extractCompoundTitle,
  ProposalProjectionError,
  CompoundArchivePayloadRepository,
  CompoundProjectionApplier,
  projectCompoundProposalEvent,
  ArchiveWriter,
  makeIngesterListener,
  createCompoundGovernorPlugin,
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
} from './governor/index';
