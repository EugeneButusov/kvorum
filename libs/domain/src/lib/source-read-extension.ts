export interface ChoiceBounds {
  min: number;
  max: number;
}

export interface ProposalPayloadView {
  payload_index: number;
  target_chain_id: string;
  payloads_controller_address: string;
  payload_id: string;
  status: 'declared' | 'created' | 'queued' | 'executed' | 'cancelled' | 'expired';
  executed_at_destination: string | null; // ISO seconds
  unindexed_target_chain: boolean;
}

export interface ProposalVotingView {
  voting_chain_id: string | null;
  voting_machine_address: string | null;
  voting_strategy_address: string | null;
  creation_block: string;
}

// Per-source proposal metadata, discriminated by `kind` (== the proposal's source_type).
// Additive to the response: consumers that only read `voting`/`payloads` are unaffected. Date
// fields are ISO-second strings (the source impl converts from its Date columns), matching the
// convention on ProposalPayloadView.executed_at_destination.
export interface AragonProposalMetadataView {
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

export interface SnapshotProposalMetadataView {
  kind: 'snapshot';
  space_id: string;
  voting_type: string | null;
  strategies: unknown | null;
  ipfs_hash: string | null;
  network: string | null;
  scores_state: string | null;
  flagged: boolean;
}

export interface DualGovernanceProposalMetadataView {
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

export interface EasyTrackProposalMetadataView {
  kind: 'easy_track';
  motion_id: string;
  factory_address: string;
  objection_ends_at: string;
  state: 'active' | 'enacted' | 'objected' | 'rejected' | 'canceled';
}

export type ProposalSourceMetadata =
  | AragonProposalMetadataView
  | SnapshotProposalMetadataView
  | DualGovernanceProposalMetadataView
  | EasyTrackProposalMetadataView;

export interface ProposalExtension {
  voting: ProposalVotingView | null;
  payloads: readonly ProposalPayloadView[];
  // Source-specific proposal metadata (null when the source has none). Discriminated by `kind`.
  metadata: ProposalSourceMetadata | null;
}

// Source-wide delegation semantics. 'relationship-only' sources (e.g. Aave governance)
// emit delegation events with voting_power='0' by design; 'power-bearing' sources
// (e.g. Compound comp-token) carry actual voting power on each delegation row.
export type DelegationModel = 'relationship-only' | 'power-bearing';

// Public, curated view of a dao_source's `source_config` for GET /daos/{slug}/sources: an opaque map
// of binding fields owned by each source's curateSourceConfig (EVM sources → contract_address/
// chain_id; snapshot → space; forum → forum_host/forum_categories). Keeping it a map means apps/api
// enumerates no source-specific field names — a new source surfaces its config with no API change.
// (On-chain vs off-chain is derivable from source_type, so no separate flag is carried.)
export type CuratedDaoSourceConfig = Record<string, string | string[]>;

// Reserved per-entity extension surfaces (no fields yet). Type aliases rather than
// empty interfaces — `interface X {}` trips @typescript-eslint/no-empty-object-type.
export type VoteExtension = Record<string, never>;
export type DelegationExtension = Record<string, never>;

// A link from a proposal to an off-chain discussion where it is debated (today a Discourse forum
// thread; the shape is medium-neutral so other platforms — Mirror, Commonwealth, etc. — can join).
// Cross-source: a proposal of any source_type may carry these, so getOffchainDiscussionLinks is
// fanned out across all extensions, not resolved by the proposal's source.
export interface OffchainDiscussionLinkView {
  platform: string; // e.g. 'discourse' — lets consumers label/icon the source
  host: string; // e.g. 'research.lido.fi'
  url: string; // canonical link to the discussion
  title: string | null;
  confidence: 'high' | 'medium' | 'low';
  last_activity_at: string | null; // ISO seconds
}

// A per-vote choice breakdown entry (`weight` is a decimal string, sorted desc by weight). Sources
// with real multiplicity (e.g. Snapshot weighted/ranked) provide it via getVoteChoices; sources
// without it return null and the read layer synthesizes a one-element breakdown from primary_choice.
export interface VoteChoiceView {
  choice_index: number;
  weight: string;
}

// Per-source read extensions spanning proposals, votes, delegations, and dao-source config
// (ADR-0069, amended 2026-06-17 to lift the proposal-only scope guard). Carried on SourcePlugin
// and aggregated into the SOURCE_READ_EXTENSIONS collection; dispatched via the pure
// source-blind helpers in ./source-read-extension-resolve.
export interface SourceReadExtension {
  readonly sourceTypes: readonly string[];
  choiceBounds(sourceType: string): ChoiceBounds;
  delegationModel(sourceType: string): DelegationModel;
  getProposalExtension(proposalId: string, sourceType: string): Promise<ProposalExtension | null>;
  getVoteExtension?(voteId: string, sourceType: string): Promise<VoteExtension | null>;
  getDelegationExtension?(
    delegationId: string,
    sourceType: string,
  ): Promise<DelegationExtension | null>;
  // Curate this source's raw source_config into its public /sources view. Optional — sources that
  // omit it get the on-chain EVM default (contract_address/chain_id, off_chain=false).
  curateSourceConfig?(sourceType: string, rawConfig: unknown): CuratedDaoSourceConfig;
  // Cross-source: off-chain discussion threads referencing a proposal of ANY source. Fanned out
  // across all extensions (only the forum contribution implements it), unlike the source-type-keyed
  // methods.
  getOffchainDiscussionLinks?(proposalId: string): Promise<readonly OffchainDiscussionLinkView[]>;
  // The vote's multi-choice breakdown, for sources that carry one (resolved by the vote's
  // source_type). null → the source has no per-vote breakdown; the read layer synthesizes one from
  // primary_choice. Keeps source-specific choice tables out of the source-blind read repository.
  getVoteChoices?(voteId: string): Promise<readonly VoteChoiceView[] | null>;
}
