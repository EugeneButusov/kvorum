export { COMP_TOKEN_DEPLOY_BLOCK, COMP_TOKEN_ADDRESS } from './constants';

export { COMPOUND_COMP_TOKEN_INTERFACE, COMPOUND_COMP_TOKEN_TOPICS } from './abi/events';
export type { CompTokenEventType } from './abi/events';

export { decodeCompTokenLog } from './abi/decoder';

export type {
  CompTokenEvent,
  DelegateChangedPayload,
  DelegateVotesChangedPayload,
} from './domain/types';
export { CompTokenDelegationProjectionApplier } from './domain/comp-token-delegation-projection-applier';
export type {
  CompTokenDelegationDerivationFailureReason,
  CompTokenDelegationDerivationOutcome,
  CompTokenDelegationProjectionApplierDeps,
  CompTokenDelegationProjectionMetrics,
} from './domain/comp-token-delegation-projection-applier';
export { CompoundCompTokenVotingPowerStrategy } from './strategy/compound-comp-token-voting-power-strategy';
export { COMP_TOKEN_VOTING_POWER_ABI } from './strategy/comp-token-abi';
export {
  projectDelegateChanged,
  projectDelegateVotesChanged,
  ZERO_ADDRESS,
} from './domain/delegation-projector';

export type {
  CompTokenEventData,
  CompTokenEventRepositoryDeps,
} from './persistence/event-repository.types';
export { CompTokenEventRepository } from './persistence/event-repository';
export type { CompTokenArchivePayloadRow } from './persistence/comp-token-archive-payload-repository';
export { CompTokenArchivePayloadRepository } from './persistence/comp-token-archive-payload-repository';
export type { DelegationSnapshotEventRow } from './persistence/delegation-snapshot-repository';
export { CompTokenDelegationSnapshotRepository } from './persistence/delegation-snapshot-repository';

export type { CompTokenArchiveWriterDeps } from './ingestion/archive-writer.types';
export { CompTokenArchiveWriter } from './ingestion/archive-writer';

export type { CompTokenIngesterListenerDeps } from './ingestion/ingester-listener';
export { makeCompTokenIngesterListener } from './ingestion/ingester-listener';

export {
  createCompTokenPlugin,
  CompTokenSourceConfigSchema,
  COMP_TOKEN_SUPPORTED_CHAIN_IDS,
} from './plugin/plugin';
export type { CompTokenSourceConfig, CompTokenPluginDeps } from './plugin/plugin';
