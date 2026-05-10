export { COMPOUND_PROPOSAL_CHOICES } from './proposal-choices';
// Re-export the CH table type so libs/sources/compound is the canonical
// import point for consumers of the compound archive schema.
export type {
  EventArchiveCompoundGovernor,
  EventArchiveCompoundGovernorTable,
  NewEventArchiveCompoundGovernor,
} from '@libs/db';
