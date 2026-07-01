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
  // The Snapshot strategy network; source for the vote's voting_chain_id. Populate reliably.
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

// ── Vote choice protocol table (ADR-072 D2) ───────────────────────────────────

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

// ── Snapshot delegation projection (on-chain Delegate Registry + Split Delegation) ─────

export interface SnapshotDelegationTable {
  id: Generated<string>;
  // Resolved from the decoded space → snapshot dao_source; null for global (Delegate Registry id == 0x0).
  dao_id: string | null;
  delegator_address: string;
  // ZERO_DELEGATE_ADDRESS on a clear (the unique key needs a non-null value).
  delegate_address: string;
  // The Snapshot space; null = global. The Delegate Registry decodes it from the bytes32 id; Split
  // Delegation from the context string.
  space_id: string | null;
  // Canonical chain_id of the registry (SPEC §2.5 "network"); stored as hex '0x1'.
  network: string;
  // 'delegate_registry' | 'split_delegation'.
  delegation_system: string;
  // Split Delegation ratio as a normalized fraction (numeric → string); null = full delegation (Delegate Registry).
  weight: string | null;
  // Split Delegation expiration; null = no expiry (Delegate Registry, or with expiry 0).
  expires_at: Date | null;
  // 'set' | 'clear'.
  event_type: string;
  // UInt64 block_number exceeds JS number precision; node-postgres returns bigint as string.
  block_number: string;
  log_index: number;
  tx_hash: string;
  created_at: Date;
}

export type SnapshotDelegation = Selectable<SnapshotDelegationTable>;
export type NewSnapshotDelegation = Insertable<SnapshotDelegationTable>;

// ── CH archive tables for the two on-chain delegation systems ──────────────────

export interface ArchiveEventSnapshotDelegateRegistryTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: 'SetDelegate' | 'ClearDelegate';
  // Server-stamped via DEFAULT now(); writers MUST NOT supply this column.
  received_at: Date;
  payload: string;
}

export type NewArchiveEventSnapshotDelegateRegistry = Omit<
  ArchiveEventSnapshotDelegateRegistryTable,
  'received_at'
>;

export interface ArchiveEventSnapshotSplitDelegationTable {
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: 'DelegationUpdated' | 'DelegationCleared' | 'ExpirationUpdated' | 'OptOutStatusSet';
  // Server-stamped via DEFAULT now(); writers MUST NOT supply this column.
  received_at: Date;
  payload: string;
}

export type NewArchiveEventSnapshotSplitDelegation = Omit<
  ArchiveEventSnapshotSplitDelegationTable,
  'received_at'
>;

// ── Declaration merging ───────────────────────────────────────────────────────

declare module '@libs/db' {
  interface PgDatabase {
    snapshot_proposal_metadata: SnapshotProposalMetadataTable;
    snapshot_delegation: SnapshotDelegationTable;
  }

  interface ClickHouseDatabase {
    archive_event_snapshot: ArchiveEventSnapshotTable;
    snapshot_vote_choice: SnapshotVoteChoiceTable;
    archive_event_snapshot_delegate_registry: ArchiveEventSnapshotDelegateRegistryTable;
    archive_event_snapshot_split_delegation: ArchiveEventSnapshotSplitDelegationTable;
  }
}

type _PgCheck = PgDatabase['snapshot_proposal_metadata'];
type _PgDelegationCheck = PgDatabase['snapshot_delegation'];
type _ChCheck = ClickHouseDatabase['archive_event_snapshot'];
type _ChVoteCheck = ClickHouseDatabase['snapshot_vote_choice'];
type _ChDelegateRegistryCheck = ClickHouseDatabase['archive_event_snapshot_delegate_registry'];
type _ChSplitDelegationCheck = ClickHouseDatabase['archive_event_snapshot_split_delegation'];
