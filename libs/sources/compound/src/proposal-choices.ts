import type { NewProposalChoice } from '@libs/db';

// On-chain Governor Bravo VoteType enum ordering per ADR-039.
// SPEC §2.4.6 lists the inverse ordering; ADR-039 is authoritative.
export const COMPOUND_PROPOSAL_CHOICES: ReadonlyArray<Omit<NewProposalChoice, 'proposal_id'>> = [
  { choice_index: 0, label: 'Against' },
  { choice_index: 1, label: 'For' },
  { choice_index: 2, label: 'Abstain' },
] as const;
