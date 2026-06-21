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

// Aragon Voting (Lido two-phase fork) — AA1
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
