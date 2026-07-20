import type { NewProposalChoice } from '@libs/db';

export type AaveProposalChoiceTemplate = Omit<NewProposalChoice, 'proposal_id'>;

export const AAVE_V3_CHOICES: readonly AaveProposalChoiceTemplate[] = [
  { choice_index: 0, value: 'against' },
  { choice_index: 1, value: 'for' },
];
