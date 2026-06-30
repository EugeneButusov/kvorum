import type { Generated, Insertable, Selectable, Updateable } from 'kysely';
import type { ClickHouseDatabase, PgDatabase } from '@libs/db';

// ── Snapshot Proposal Metadata ────────────────────────────────────────────────

export interface SnapshotProposalMetadataTable {
  proposal_id: string;
  space_id: string;
  // Snapshot-owned vocabulary; stays text (Snapshot adds values, e.g. copeland).
  voting_type: string | null;
  strategies: unknown | null;
  ipfs_hash: string | null;
  // Source for Z4's voting_chain_id — AD2 must populate reliably.
  network: string | null;
  // Snapshot-owned vocabulary: pending|active|final|invalid; stays text.
  scores_state: string | null;
  flagged: Generated<boolean>;
}

export type SnapshotProposalMetadata = Selectable<SnapshotProposalMetadataTable>;
export type NewSnapshotProposalMetadata = Insertable<SnapshotProposalMetadataTable>;
export type SnapshotProposalMetadataUpdate = Updateable<SnapshotProposalMetadataTable>;

// ── CH archive table ──────────────────────────────────────────────────────────

export interface ArchiveEventSnapshotTable {
  dao_source_id: string;
  external_id: string;
  // Int32 mirrors PG archive_event.version (signed int32).
  version: number;
  content_hash: string;
  payload: string;
}

export type ArchiveEventSnapshot = ArchiveEventSnapshotTable;
export type NewArchiveEventSnapshot = ArchiveEventSnapshotTable;

// ── Vote choice protocol table (ADR-072 D2; AD4) ──────────────────────────────

export interface SnapshotVoteChoiceTable {
  vote_id: string;
  // JSON: [{choice_index:int, weight:"decimal"}], sorted desc by weight.
  choices: string;
  // Exact decimal reported voting power (core vote_events.voting_power is rounded).
  vp: string;
  // Raw per-strategy power breakdown (JSON), as archived.
  vp_by_strategy: string;
  // CH-defaulted ReplacingMergeTree version (now64(6)); omitted on insert, read for max-version dedup.
  version: Generated<string>;
}

export type SnapshotVoteChoice = SnapshotVoteChoiceTable;
export type NewSnapshotVoteChoice = SnapshotVoteChoiceTable;

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    snapshot_proposal_metadata: SnapshotProposalMetadataTable;
  }

  interface ClickHouseDatabase {
    archive_event_snapshot: ArchiveEventSnapshotTable;
    snapshot_vote_choice: SnapshotVoteChoiceTable;
  }
}

type _PgCheck = PgDatabase['snapshot_proposal_metadata'];
type _ChCheck = ClickHouseDatabase['archive_event_snapshot'];
type _ChVoteCheck = ClickHouseDatabase['snapshot_vote_choice'];
