import type { NewProposalChoice } from '@libs/db';

export type AaveV2ProposalChoiceTemplate = Omit<NewProposalChoice, 'proposal_id'>;

export const AAVE_V2_CHOICES: readonly AaveV2ProposalChoiceTemplate[] = [
  { choice_index: 0, value: 'against' },
  { choice_index: 1, value: 'for' },
];
