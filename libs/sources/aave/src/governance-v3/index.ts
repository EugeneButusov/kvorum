export {
  AAVE_GOVERNANCE_V3_INTERFACE,
  AAVE_GOVERNANCE_V3_TOPICS,
  interfaceForAaveGovernanceV3,
} from './abi/events';
export type { AaveGovernanceV3EventType } from './abi/events';
export { decodeAaveGovernanceV3Log } from './abi/decoder';
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
