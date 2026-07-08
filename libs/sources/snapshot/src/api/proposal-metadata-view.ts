import type { ProposalSourceMetadata } from '@libs/domain';

// Concrete Snapshot proposal-metadata shape. Extends the domain's open `ProposalSourceMetadata`
// base (discriminated by `kind`) and lives here — not in @libs/domain — so the source-blind contract
// names no specific source. Its swagger DTO twin lives in @nest/snapshot.
export interface SnapshotProposalMetadataView extends ProposalSourceMetadata {
  kind: 'snapshot';
  space_id: string;
  voting_type: string | null;
  strategies: unknown | null;
  ipfs_hash: string | null;
  network: string | null;
  scores_state: string | null;
  flagged: boolean;
  // Per-choice voting-power tally (0-indexed), summed from the full snapshot_vote_choice breakdown.
  // Populated only for voting types the single `primary_choice` cannot represent — approval and
  // weighted/quadratic — so consumers get the correct approval/weighted tally without re-summing
  // votes. null for single-choice/basic (primary_choice already gives the tally) and ranked/copeland
  // (algorithmic scoring, not a per-choice sum).
  choice_scores: number[] | null;
}
