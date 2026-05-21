import type { ClickHouseDatabase } from '@libs/db';

// Analytical mirror tables — see core_001_analytical_mirror.sql for engine,
// codec, ORDER BY, and partition rationale. JSDoc on individual fields below
// captures the contract that Kysely query authors need at hover time.
//
// Sentinel conventions (mirror Q ETL ↔ O3 read round-trip):
//   * primary_choice = -1 ↔ PG vote.primary_choice IS NULL
//   * delegate_actor_id = '00000000-0000-0000-0000-000000000000' ↔ PG NULL
// Q writes sentinels; O3 converts back to NULL before serialising.
// For NULL-safe analytical aggregates, prefer the ALIAS column
// `primary_choice_nullable` (auto-skips the sentinel in SUM/AVG).

export interface VoteEventsFlatTable {
  vote_id: string;
  proposal_id: string;
  voter_actor_id: string;
  voter_address: string;
  dao_id: string;
  dao_slug: string;
  source_type: string;
  /** Int8; sentinel -1 = NULL in PG. ETL writes this; analytics SELECT against `primary_choice_nullable` (see below). */
  primary_choice: number;
  /** Read-only ALIAS over `primary_choice` (= NULL when sentinel -1, else the value). Server-computed — must NOT be supplied on insert. */
  primary_choice_nullable: number | null;
  /** UInt256 as JS string. Parse via BigInt() at analytical query sites; re-stringify per SPEC §4.7 before JSON. Never cast to Float64 in CH SQL — silent precision loss above 2^53. */
  voting_power: string;
  /** DateTime64(3). */
  cast_at: Date;
  /** PG insertion time; Q's ETL watermark column. */
  created_at: Date;
  /** UInt64 as JS string. Parse via BigInt() if used in arithmetic. */
  block_number: string;
  /** UInt8; 1 if PG vote.superseded_by_vote_id IS NOT NULL (ADR-021). */
  superseded: number;
}

export type VoteEventsFlat = VoteEventsFlatTable;
/** ETL row shape — omits the ALIAS column (CH rejects writes to ALIAS). */
export type NewVoteEventsFlat = Omit<VoteEventsFlatTable, 'primary_choice_nullable'>;

export interface DelegationFlowFlatTable {
  delegation_id: string;
  delegator_actor_id: string;
  /** Zero UUID '00000000-0000-0000-0000-000000000000' = NULL in PG (delegated-to-no-one). */
  delegate_actor_id: string;
  dao_id: string;
  dao_slug: string;
  /** UInt256 as JS string. Parse via BigInt() for arithmetic; never cast to Float64 in CH SQL. */
  voting_power: string;
  /** UInt64 as JS string. */
  block_number: string;
  /** 'delegate_changed' | 'votes_changed'. */
  event_type: string;
  /** PG insertion time; Q's ETL watermark column. */
  created_at: Date;
}

export type DelegationFlowFlat = DelegationFlowFlatTable;
export type NewDelegationFlowFlat = DelegationFlowFlatTable;

// Extend @libs/db's ClickHouseDatabase via declaration merging.
// Any compilation that transitively imports this file gets type-safe db access.
declare module '@libs/db' {
  interface ClickHouseDatabase {
    vote_events_analytics: VoteEventsFlatTable;
    delegation_flow_analytics: DelegationFlowFlatTable;
  }
}

// Gate the declaration-merging activation in J3's own typecheck.
type _VoteEventsFlatAugmentationActiveCheck = ClickHouseDatabase['vote_events_analytics'];
type _DelegationFlowFlatAugmentationActiveCheck = ClickHouseDatabase['delegation_flow_analytics'];
