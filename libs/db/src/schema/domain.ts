import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ── source_type reference table ───────────────────────────────────────────────

// Valid values live in the source_type DB table; each source package injects
// its own value via its own migrations-postgres migration.
export type SourceType = string;

export interface SourceTypeTable {
  value: string;
}

// ── Enum string-literal unions ────────────────────────────────────────────────

export type ProposalState =
  | 'pending'
  | 'active'
  | 'succeeded'
  | 'defeated'
  | 'queued'
  | 'executed'
  | 'canceled'
  | 'expired'
  | 'vetoed';

// ── Table row types ───────────────────────────────────────────────────────────

export interface DaoTable {
  id: Generated<string>;
  slug: string;
  name: string;
  primary_token_address: string;
  primary_chain_id: number;
  description: string;
  website_url: string;
  forum_url: string;
  created_at: Generated<Date>;
  updated_at: Date;
}

export type Dao = Selectable<DaoTable>;
export type NewDao = Insertable<DaoTable>;
export type DaoUpdate = Updateable<DaoTable>;

export interface DaoSourceTable {
  id: Generated<string>;
  dao_id: string;
  source_type: SourceType;
  source_config: unknown;
  // pg driver returns bigint columns as string to preserve precision
  active_from_block: string | null;
  active_to_block: string | null;
  backfill_started_at_block: string | null;
  backfill_head_block: string | null;
  created_at: Generated<Date>;
}

export type DaoSource = Selectable<DaoSourceTable>;
export type NewDaoSource = Insertable<DaoSourceTable>;
export type DaoSourceUpdate = Updateable<DaoSourceTable>;

export interface ActorTable {
  id: Generated<string>;
  primary_address: string;
  display_name: string | null;
  bio: string | null;
  profile_data: unknown | null;
  created_at: Generated<Date>;
  updated_at: Date;
}

export type Actor = Selectable<ActorTable>;
export type NewActor = Insertable<ActorTable>;
export type ActorUpdate = Updateable<ActorTable>;

export interface ProposalTable {
  id: Generated<string>;
  dao_id: string;
  source_type: SourceType;
  source_id: string;
  proposer_actor_id: string;
  title: string | null;
  description: string;
  description_hash: string;
  binding: boolean;
  voting_starts_at: Date;
  voting_ends_at: Date;
  // pg driver returns bigint as string
  voting_power_block: string;
  state: ProposalState;
  state_updated_at: Date;
  created_at: Generated<Date>;
  updated_at: Date;
}

export type Proposal = Selectable<ProposalTable>;
export type NewProposal = Insertable<ProposalTable>;
export type ProposalUpdate = Updateable<ProposalTable>;

export interface ProposalActionTable {
  id: Generated<string>;
  proposal_id: string;
  action_index: number;
  target_address: string;
  target_chain_id: number;
  // numeric(78,0) — full uint256 range; pg driver returns as string
  value_wei: string;
  function_signature: string | null;
  calldata: string;
  decoded_function: string | null;
  decoded_arguments: unknown | null;
  created_at: Generated<Date>;
}

export type ProposalAction = Selectable<ProposalActionTable>;
export type NewProposalAction = Insertable<ProposalActionTable>;

export interface ProposalChoiceTable {
  proposal_id: string;
  choice_index: number;
  label: string;
}

export type ProposalChoice = Selectable<ProposalChoiceTable>;
export type NewProposalChoice = Insertable<ProposalChoiceTable>;

export interface ReorgEventTable {
  id: Generated<string>;
  chain_id: number;
  detected_at: Date;
  // pg driver returns bigint as string
  divergence_block_number: string;
  orphaned_block_hashes: string[];
  canonical_block_hashes: string[];
  notes: string | null;
}

export type ReorgEvent = Selectable<ReorgEventTable>;
export type NewReorgEvent = Insertable<ReorgEventTable>;
