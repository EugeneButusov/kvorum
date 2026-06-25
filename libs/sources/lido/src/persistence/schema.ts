import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';

// ── Aragon Voting ─────────────────────────────────────────────────────────────

export interface AragonProposalMetadataTable {
  proposal_id: string;
  app_address: string;
  app_version: string | null;
  support_required_pct: string | null;
  min_accept_quorum_pct: string | null;
  main_phase_ends_at: Date | null;
  objection_phase_ends_at: Date | null;
  executed_at: Date | null;
  // pg driver returns bigint as string
  last_reconcile_check_block: string | null;
}

export type AragonProposalMetadata = Selectable<AragonProposalMetadataTable>;
export type NewAragonProposalMetadata = Insertable<AragonProposalMetadataTable>;
export type AragonProposalMetadataUpdate = Updateable<AragonProposalMetadataTable>;

// ── Dual Governance ───────────────────────────────────────────────────────────

export type DualGovernanceState =
  | 'normal'
  | 'veto_signaling'
  | 'veto_signaling_deactivation'
  | 'veto_cooldown'
  | 'rage_quit';

export interface DualGovernanceStateHistoryTable {
  id: Generated<string>;
  dao_id: string;
  state: DualGovernanceState;
  transition_at: Date;
  // pg driver returns bigint as string
  block_number: string;
  tx_hash: string;
  log_index: number;
  rage_quit_eth_amount: string | null;
  veto_signaling_started_at: Date | null;
  veto_signaling_deactivated_at: Date | null;
  payload: unknown;
}

export type DualGovernanceStateHistory = Selectable<DualGovernanceStateHistoryTable>;
export type NewDualGovernanceStateHistory = Insertable<DualGovernanceStateHistoryTable>;
export type DualGovernanceStateHistoryUpdate = Updateable<DualGovernanceStateHistoryTable>;

// AB3 (#330): DG proposal-flow ledger. Correlation + DG timelock sub-lifecycle (ADR-0074 §4).
export type DualGovernanceProposalOrigin = 'aragon' | 'direct';
export type DualGovernanceProposalStatus = 'submitted' | 'scheduled' | 'executed' | 'cancelled';

export interface DualGovernanceProposalTable {
  id: Generated<string>;
  dao_id: string;
  // pg driver returns bigint as string
  dg_proposal_id: string;
  proposal_id: string;
  origin: DualGovernanceProposalOrigin;
  aragon_source_id: string | null;
  executor: string;
  calls_hash: string;
  submitted_tx_hash: string;
  // pg driver returns bigint as string
  submitted_block: string;
  submitted_at: Date;
  status: DualGovernanceProposalStatus;
  scheduled_at: Date | null;
  executed_at: Date | null;
  cancelled_at: Date | null;
  // pg driver returns bigint as string
  last_reconcile_check_block: string | null;
}

export type DualGovernanceProposal = Selectable<DualGovernanceProposalTable>;
export type NewDualGovernanceProposal = Insertable<DualGovernanceProposalTable>;
export type DualGovernanceProposalUpdate = Updateable<DualGovernanceProposalTable>;

// ── Easy Track ────────────────────────────────────────────────────────────────

export type EasyTrackMotionState = 'active' | 'enacted' | 'objected' | 'rejected' | 'canceled';

export interface EasyTrackMotionMetaTable {
  proposal_id: string;
  // pg driver returns bigint as string
  motion_id: string;
  factory_address: string;
  objection_ends_at: Date;
  state: EasyTrackMotionState;
  // pg driver returns bigint as string
  last_reconcile_check_block: string | null;
}

export type EasyTrackMotionMeta = Selectable<EasyTrackMotionMetaTable>;
export type NewEasyTrackMotionMeta = Insertable<EasyTrackMotionMetaTable>;
export type EasyTrackMotionMetaUpdate = Updateable<EasyTrackMotionMetaTable>;

// ── CH archive tables ─────────────────────────────────────────────────────────

export interface ArchiveEventAragonVotingTable {
  dao_source_id: string;
  chain_id: string;
  // UInt64 exceeds JS number precision; typed as string
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  received_at: Date;
  payload: string;
}

export type ArchiveEventAragonVoting = ArchiveEventAragonVotingTable;
export type NewArchiveEventAragonVoting = Omit<ArchiveEventAragonVotingTable, 'received_at'>;

export interface ArchiveEventDualGovernanceTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  received_at: Date;
  payload: string;
}

export type ArchiveEventDualGovernance = ArchiveEventDualGovernanceTable;
export type NewArchiveEventDualGovernance = Omit<ArchiveEventDualGovernanceTable, 'received_at'>;

export interface ArchiveEventEasyTrackTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  received_at: Date;
  payload: string;
}

export type ArchiveEventEasyTrack = ArchiveEventEasyTrackTable;
export type NewArchiveEventEasyTrack = Omit<ArchiveEventEasyTrackTable, 'received_at'>;

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    aragon_proposal_metadata: AragonProposalMetadataTable;
    dual_governance_state_history: DualGovernanceStateHistoryTable;
    dual_governance_proposal: DualGovernanceProposalTable;
    easy_track_motion_meta: EasyTrackMotionMetaTable;
  }

  interface ClickHouseDatabase {
    archive_event_aragon_voting: ArchiveEventAragonVotingTable;
    archive_event_dual_governance: ArchiveEventDualGovernanceTable;
    archive_event_easy_track: ArchiveEventEasyTrackTable;
  }
}

type _PgCheck = PgDatabase['aragon_proposal_metadata'];
type _ChCheck = ClickHouseDatabase['archive_event_aragon_voting'];
