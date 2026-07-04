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
}
