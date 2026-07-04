import type { ProposalSourceMetadata } from '@libs/domain';

// Concrete proposal-metadata shapes for the three Lido on-chain tracks. They extend the domain's
// open `ProposalSourceMetadata` base (discriminated by `kind`) and live here — not in @libs/domain —
// so the source-blind contract names no specific source. Their swagger DTO twins live in @nest/lido.
export interface AragonProposalMetadataView extends ProposalSourceMetadata {
  kind: 'aragon_voting';
  app_address: string;
  app_version: string | null;
  // 10^18-based percentage params (Lido Aragon fork), not basis points. Kept as decimal strings.
  support_required_pct: string | null;
  min_accept_quorum_pct: string | null;
  main_phase_ends_at: string | null;
  objection_phase_ends_at: string | null;
  executed_at: string | null;
}

export interface DualGovernanceProposalMetadataView extends ProposalSourceMetadata {
  kind: 'dual_governance';
  origin: 'aragon' | 'direct';
  dg_proposal_id: string;
  status: 'submitted' | 'scheduled' | 'executed' | 'cancelled';
  executor: string;
  aragon_source_id: string | null;
  submitted_at: string;
  scheduled_at: string | null;
  executed_at: string | null;
  cancelled_at: string | null;
}

export interface EasyTrackProposalMetadataView extends ProposalSourceMetadata {
  kind: 'easy_track';
  motion_id: string;
  factory_address: string;
  objection_ends_at: string;
  state: 'active' | 'enacted' | 'objected' | 'rejected' | 'canceled';
}
