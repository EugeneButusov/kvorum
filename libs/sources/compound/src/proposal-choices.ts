import { EVoteChoice } from '@libs/domain';

// Governor Bravo VoteType ordinal → EVoteChoice mapping per ADR-039.
// SPEC §2.4.6 lists the inverse ordering; ADR-039 is authoritative.
export const COMPOUND_PROPOSAL_CHOICES: ReadonlyArray<{
  choice_index: number;
  value: EVoteChoice;
}> = [
  { choice_index: 0, value: EVoteChoice.Against },
  { choice_index: 1, value: EVoteChoice.For },
  { choice_index: 2, value: EVoteChoice.Abstain },
] as const;
