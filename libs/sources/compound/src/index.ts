export { COMPOUND_PROPOSAL_CHOICES } from './proposal-choices';
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
  ArchiveWriterDeps,
  ArchiveWriteContext,
  ArchiveWriteOutcome,
  IngesterListenerDeps,
  EventData,
  EventRepositoryDeps,
  CompoundGovernorConfig,
  CompoundGovernorPluginDeps,
} from './governor/index';
