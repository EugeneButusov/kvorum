export {
  AAVE_VOTING_MACHINE_INTERFACE,
  AAVE_VOTING_MACHINE_TOPICS,
  interfaceForAaveVotingMachine,
} from './abi/events';
export type { AaveVotingMachineEventType } from './abi/events';
export { decodeAaveVotingMachineLog } from './abi/decoder';
export type {
  AaveVotingMachineEvent,
  ProposalResultsSentPayload,
  ProposalVoteConfigurationBridgedPayload,
  ProposalVoteStartedPayload,
  VoteEmittedPayload,
} from './domain/types';
export type {
  EventArchiveAaveVotingMachine,
  EventArchiveAaveVotingMachineTable,
  NewEventArchiveAaveVotingMachine,
} from './persistence/schema';
export type {
  AaveVotingMachineEventData,
  AaveVotingMachineEventRepositoryDeps,
} from './persistence/event-repository.types';
export { AaveVotingMachineEventRepository } from './persistence/event-repository';
export type { AaveVotingMachineArchivePayloadRow } from './persistence/archive-payload-repository';
export { AaveVotingMachineArchivePayloadRepository } from './persistence/archive-payload-repository';
export { projectAaveVote } from './domain/vote-projector';
export type {
  AaveVoteDerivationFailureReason,
  AaveVoteDerivationOutcome,
  AaveVoteProjectionApplierDeps,
  AaveVoteProjectionMetrics,
} from './domain/vote-projection-applier';
export { AaveVoteProjectionApplier } from './domain/vote-projection-applier';
export type { AaveVotingMachineArchiveWriterDeps } from './ingestion/archive-writer.types';
export type {
  ArchiveWriteContext as AaveVotingMachineArchiveWriteContext,
  ArchiveWriteOutcome as AaveVotingMachineArchiveWriteOutcome,
} from './ingestion/archive-writer.types';
export { AaveVotingMachineArchiveWriter } from './ingestion/archive-writer';
export type { AaveVotingMachineIngesterListenerDeps } from './ingestion/ingester-listener';
export { makeAaveVotingMachineIngesterListener } from './ingestion/ingester-listener';
export type { AaveVotingMachineConfig, AaveVotingMachinePluginDeps } from './plugin/plugin';
export {
  AaveVotingMachineConfigSchema,
  AAVE_VOTING_MACHINE_SUPPORTED_CHAIN_IDS,
  createAaveVotingMachinePlugin,
} from './plugin/plugin';
