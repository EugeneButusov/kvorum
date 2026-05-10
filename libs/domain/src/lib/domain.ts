export const KVORUM_VERSION = '0.1.0';

// Canonical vote-choice identifiers shared across all Governor-style protocols.
// Values are stored in proposal_choice.label; the indexer maps choice_index
// from the on-chain VoteType ordinal.
export enum EVoteChoice {
  Against = 'against',
  For = 'for',
  Abstain = 'abstain',
}
