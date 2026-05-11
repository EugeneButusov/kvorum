export { COMPOUND_PROPOSAL_CHOICES } from './proposal-choices.js';
// Re-export the CH table type so libs/sources/compound is the canonical
// import point for consumers of the compound archive schema.
export type {
  EventArchiveCompoundGovernor,
  EventArchiveCompoundGovernorTable,
  NewEventArchiveCompoundGovernor,
} from '@libs/db';

export {
  COMPOUND_GOVERNOR_EVENTS,
  COMPOUND_GOVERNOR_INTERFACE,
  COMPOUND_EVENT_TOPICS,
  decodeCompoundLog,
  DecodeError,
  ArchiveWriter,
  isTransientPgError,
  makeIngesterListener,
} from './governor/index.js';

export type {
  CompoundEventType,
  CompoundGovernorEvent,
  ProposalCreatedPayload,
  ProposalQueuedPayload,
  ProposalExecutedPayload,
  ProposalCanceledPayload,
  ArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
  IngesterListenerDeps,
} from './governor/index.js';
