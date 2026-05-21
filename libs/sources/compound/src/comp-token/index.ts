export { COMP_TOKEN_DEPLOY_BLOCK, COMP_TOKEN_ADDRESS } from './constants';

export { COMPOUND_COMP_TOKEN_INTERFACE, COMPOUND_COMP_TOKEN_TOPICS } from './abi/events';
export type { CompTokenEventType } from './abi/events';

export { decodeCompTokenLog } from './abi/decoder';

export type {
  CompTokenEvent,
  DelegateChangedPayload,
  DelegateVotesChangedPayload,
} from './domain/types';

export type {
  CompTokenEventData,
  CompTokenEventRepositoryDeps,
} from './persistence/event-repository.types';
export { CompTokenEventRepository } from './persistence/event-repository';

export type { CompTokenArchiveWriterDeps } from './ingestion/archive-writer.types';
export { CompTokenArchiveWriter } from './ingestion/archive-writer';

export type { CompTokenIngesterListenerDeps } from './ingestion/ingester-listener';
export { makeCompTokenIngesterListener } from './ingestion/ingester-listener';
