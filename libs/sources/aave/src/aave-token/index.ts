export { AAVE_TOKEN_ADDRESS, AAVE_TOKEN_V3_ACTIVATION_BLOCK } from './constants';

export { AAVE_TOKEN_INTERFACE, AAVE_TOKEN_TOPICS, AAVE_GOVERNANCE_POWER_TYPE } from './abi/events';
export type { AaveTokenEventType } from './abi/events';

export { decodeAaveTokenLog } from './abi/decoder';

export type { AaveTokenEvent, DelegateChangedPayload } from './domain/types';
export { projectVotingDelegateChanged, ZERO_ADDRESS } from './domain/delegation-projector';
export { AaveTokenDelegationProjectionApplier } from './domain/aave-token-delegation-projection-applier';
export type {
  AaveTokenDelegationDerivationFailureReason,
  AaveTokenDelegationDerivationOutcome,
  AaveTokenDelegationProjectionApplierDeps,
  AaveTokenDelegationProjectionMetrics,
} from './domain/aave-token-delegation-projection-applier';
export type {
  AaveTokenActorAddressSource,
  AaveTokenAddressCandidate,
} from './domain/actor-address-deriver';
export { AaveTokenActorAddressDeriver } from './domain/actor-address-deriver';

export type {
  EventArchiveAaveToken,
  EventArchiveAaveTokenTable,
  NewEventArchiveAaveToken,
} from './persistence/schema';
export type {
  AaveTokenEventData,
  AaveTokenEventRepositoryDeps,
} from './persistence/event-repository.types';
export { AaveTokenEventRepository } from './persistence/event-repository';
export type { AaveTokenArchivePayloadRow } from './persistence/archive-payload-repository';
export { AaveTokenArchivePayloadRepository } from './persistence/archive-payload-repository';

export type { AaveTokenArchiveWriterDeps } from './ingestion/archive-writer.types';
export { AaveTokenArchiveWriter } from './ingestion/archive-writer';

export type { AaveTokenIngesterListenerDeps } from './ingestion/ingester-listener';
export { makeAaveTokenIngesterListener } from './ingestion/ingester-listener';

export type { AaveTokenConfig, AaveTokenPluginDeps } from './plugin/plugin';
export {
  AaveTokenConfigSchema,
  AAVE_TOKEN_SUPPORTED_CHAIN_IDS,
  createAaveTokenPlugin,
} from './plugin/plugin';
