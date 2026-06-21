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

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    snapshot_proposal_metadata: SnapshotProposalMetadataTable;
  }

  interface ClickHouseDatabase {
    archive_event_snapshot: ArchiveEventSnapshotTable;
  }
}

type _PgCheck = PgDatabase['snapshot_proposal_metadata'];
type _ChCheck = ClickHouseDatabase['archive_event_snapshot'];
