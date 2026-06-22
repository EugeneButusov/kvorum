export type {
  AragonProposalMetadata,
  AragonProposalMetadataTable,
  AragonProposalMetadataUpdate,
  NewAragonProposalMetadata,
  ArchiveEventAragonVoting,
  ArchiveEventAragonVotingTable,
  NewArchiveEventAragonVoting,
  ArchiveEventDualGovernance,
  ArchiveEventDualGovernanceTable,
  NewArchiveEventDualGovernance,
  ArchiveEventEasyTrack,
  ArchiveEventEasyTrackTable,
  NewArchiveEventEasyTrack,
  DualGovernanceState,
  DualGovernanceStateHistory,
  DualGovernanceStateHistoryTable,
  DualGovernanceStateHistoryUpdate,
  NewDualGovernanceStateHistory,
  EasyTrackMotionMeta,
  EasyTrackMotionMetaTable,
  EasyTrackMotionMetaUpdate,
  EasyTrackMotionState,
  NewEasyTrackMotionMeta,
} from './persistence/schema';

// EVMScript decoder
export { toProposalActions } from './calldata/evmscript-actions';
export { createForwarderRegistry, FORWARD_SELECTOR, EXECUTE_SELECTOR } from './calldata/forwarders';
export type { ForwarderRegistry, ForwarderEntry } from './calldata/forwarders';
export { decodeEvmScript, EvmScriptDecodeError } from '@sources/core';
export type { EvmScriptCall, EvmScriptDecodeErrorReason } from '@sources/core';

// Aragon Voting (Lido two-phase fork)
export { ARAGON_VOTING_INTERFACE, ARAGON_VOTING_TOPICS } from './aragon-voting/abi/events';
export type { AragonVotingTopics } from './aragon-voting/abi/events';
export { decodeAragonVotingLog } from './aragon-voting/abi/decoder';
export type { AragonVotingEvent } from './aragon-voting/domain/types';
export { ARAGON_VOTING_EVENT_TYPES } from './aragon-voting/domain/types';
export { AragonVotingEventRepository } from './aragon-voting/persistence/event-repository';
export type {
  AragonVotingEventData,
  AragonVotingEventRepositoryDeps,
} from './aragon-voting/persistence/event-repository.types';
export { LidoAragonVotingArchiveWriter } from './aragon-voting/ingestion/archive-writer';
export type { LidoAragonVotingArchiveWriterDeps } from './aragon-voting/ingestion/archive-writer.types';
export { makeAragonVotingIngesterListener } from './aragon-voting/ingestion/ingester-listener';
export type { AragonVotingIngesterListenerDeps } from './aragon-voting/ingestion/ingester-listener';
export {
  createLidoAragonVotingPlugin,
  LidoAragonVotingConfigSchema,
  SUPPORTED_CHAIN_IDS,
} from './aragon-voting/plugin/plugin';
export type {
  LidoAragonVotingConfig,
  LidoAragonVotingPluginDeps,
} from './aragon-voting/plugin/plugin';
export { makeLidoReadExtension } from './aragon-voting/api/lido-read-extension';

// Aragon Voting derivation (proposal/vote projection, actor sweep, metadata)
export { LidoAragonVotingActorAddressDeriver } from './aragon-voting/domain/actor-address-deriver';
export type {
  AragonActorAddressSource,
  AragonAddressCandidate,
} from './aragon-voting/domain/actor-address-deriver';
export { AragonVotingArchivePayloadRepository } from './aragon-voting/persistence/archive-payload-repository';
export type { AragonVotingArchivePayloadRow } from './aragon-voting/persistence/archive-payload-repository';
export { AragonProposalRepository } from './aragon-voting/persistence/aragon-proposal-repository';
export { extractAragonTitle } from './aragon-voting/domain/title-extractor';
export {
  projectAragonProposalEvent,
  AragonProposalProjectionError,
} from './aragon-voting/domain/proposal-projector';
export type {
  AragonProposalProjection,
  AragonProposalCreatedProjection,
  AragonStateTransitionProjection,
  AragonConfigNoopProjection,
} from './aragon-voting/domain/proposal-projector';
export { projectAragonVoteCast } from './aragon-voting/domain/vote-projector';
export type { AragonVoteIncoming } from './aragon-voting/domain/vote-projector';
export { AragonProposalProjectionApplier } from './aragon-voting/domain/aragon-proposal-projection-applier';
export type {
  AragonProposalProjectionApplierDeps,
  AragonProposalProjectionMetrics,
} from './aragon-voting/domain/aragon-proposal-projection-applier';
export { AragonVoteProjectionApplier } from './aragon-voting/domain/aragon-vote-projection-applier';
export type {
  AragonVoteProjectionApplierDeps,
  AragonVoteProjectionMetrics,
} from './aragon-voting/domain/aragon-vote-projection-applier';
