# Kvorum — Product Specification

> **Status:** v1.0 (frozen)
> **Frozen:** 2026-05-04
> **Last updated:** 2026-05-04 (Section 10 added concurrent with freeze)

Kvorum is an analytics platform for DAO governance. This document is the canonical specification for the product.

## Spec lifecycle

The spec evolves through three phases:

1. **Drafting.** Sections are written, reviewed, and revised in place. Decisions are made by discussion; the spec is the working record. Major changes simply rewrite the affected text.
2. **v1.0 frozen (current phase as of 2026-05-04).** All sections of v1 scope have been drafted and signed off. The spec is tagged as `v1.0` in the repository and the contents are treated as immutable for that version. The frozen v1.0 spec is the implementation reference.
3. **Post-freeze evolution via ADRs.** All subsequent changes — including v1.1 features that were anticipated in v1's forward-compatibility commitments — are delivered as numbered Architecture Decision Records (`docs/adr/0001-*.md`, etc.). Each ADR records context, decision, consequences, and the section(s) of the spec it amends. The spec document gains a "decisions log" section listing all ADRs in chronological order. Reading the v1.0 spec plus the ADRs in order yields the current canonical design.

This pattern is deliberately lightweight. There is no formal review board; ADRs are written by whoever is making the decision and reviewed by whoever is collaborating. The discipline is purely about _recording_ decisions so future readers (including future-self) can understand why the system is the way it is.

The v1.0 spec is now the contract. From this point forward, any change to what Kvorum is or how it works requires an ADR.

---

## Table of contents

1. [Premise & positioning](#1-premise--positioning)
2. [Domain model](#2-domain-model)
3. [Data sources & ingestion](#3-data-sources--ingestion)
4. [API specification](#4-api-specification)
5. [AI features specification](#5-ai-features-specification)
6. [Dashboard specification](#6-dashboard-specification)
7. [Non-functional requirements](#7-non-functional-requirements)
8. [Open questions & decisions log](#8-open-questions--decisions-log)
9. [Known concerns & v1.1 roadmap](#9-known-concerns--v11-roadmap)
10. [Implementation milestones](#10-implementation-milestones)

---

## 1. Premise & positioning

### 1.1 What this is

Kvorum is an analytics platform for DAO governance. It indexes governance activity across major DeFi protocols (initially Compound, Aave, and Lido), unifies it into a single queryable model, and exposes the result through a free public dashboard and a free developer API. Its purpose is to make DAO governance _legible_ — to operators, delegates, and researchers — at a depth that current tools do not provide.

The name comes from the Slavic spelling of _quorum_ — the moment governance actually becomes binding. The product takes its analytical lens from that moment: who showed up, with how much voting power, and what did they decide.

### 1.2 The problem

DAO governance generates a large amount of high-stakes, public, structured data: proposals, votes, delegations, executions, forum discussions, vote rationales. The data is theoretically available. In practice, it is:

- **Fragmented across protocols.** Each Governor implementation has its own conventions; Snapshot adds an off-chain layer; Aragon-based DAOs use a different model again.
- **Split across on-chain and off-chain sources.** Governor contracts, Snapshot, Discourse forums, delegate platforms — none of them speak to each other.
- **Presented in tools that prioritize browsing over analysis.** Aggregators show what is happening; they do not answer _why_ or _what does it mean_.

The result is that the teams responsible for stewarding these DAOs — foundation members, governance leads, protocol operators — have no good way to answer questions about their own governance:

- Is voting power concentrating or decentralizing over time?
- Which delegates actually participate, and how is their participation changing?
- Did the calldata of this proposal actually do what its description claimed?
- Where is delegation flowing, and which addresses are gaining or losing influence?
- Are there governance-attack signatures we should be watching?

The same gap exists for delegates trying to understand their peers, and for researchers and journalists writing about governance. But operators feel the gap most acutely, because they are accountable for governance health and have no instrumentation to measure it.

### 1.3 The premise

Governance data is unusually well-suited to a unified analytical layer:

- **Volume is low.** Across all major DeFi DAOs combined, proposals number in the low thousands and votes in the low hundreds of thousands. The entire dataset fits comfortably in a single Postgres database.
- **Structure is rich.** Proposals, votes, and delegations have well-defined schemas. The variance between protocols is in conventions, not in fundamental shape — which is exactly the situation where a thoughtful unified model adds value.
- **Text content is dense and consequential.** Proposal descriptions, forum discussions, and vote rationales are the natural input for LLM-based synthesis. Summarization, mismatch detection, and sentiment analysis on this corpus produce genuinely useful outputs that would be expensive and slow for humans to produce.

A platform that indexes this data correctly, unifies it across protocols, and overlays AI synthesis is currently not available. Kvorum is that platform. Building it is tractable for a single engineer over a 3–4 month build, with ongoing infrastructure costs in the tens of dollars per month.

### 1.4 Target users

Kvorum serves three user segments. All three are supported, but design tradeoffs default to the primary segment.

**Primary: Protocol & DAO operators.** Foundation members, governance leads, treasury managers, and protocol operators responsible for stewarding a DAO's governance health. They need to monitor their own DAO's metrics, audit incoming proposals, and understand voter behavior. They are the most demanding users — they want depth, accuracy, and operational reliability — and they are the segment most underserved by existing tools.

**Secondary: Delegates and sophisticated retail.** Active delegates managing voting commitments across multiple DAOs, and token holders selecting delegates to entrust. They primarily consume delegate scorecards, voting alignment views, and proposal explainers.

**Secondary: Researchers and journalists.** People writing about DAO governance, conducting academic analysis, or covering governance in the press. They primarily consume the API, raw data exports, and historical analyses.

A user segment we explicitly **do not** prioritize for v1: passive token holders who want a simple "should I vote yes or no" recommendation. That is a different product.

### 1.5 Product principles

Four principles guide what Kvorum is and how it is built:

1. **Unified cross-DAO model.** A single schema absorbs structurally different governance systems — Compound Bravo, Aave v2 with cross-chain execution, Lido's hybrid Aragon and dual-governance model with Snapshot signaling. The unification is the product's load-bearing engineering claim and the foundation for any cross-DAO analysis.
2. **Operator-first analytics.** Kvorum is designed first for the people accountable for stewarding a DAO's governance health — foundation members, governance leads, treasury managers — and for the metrics they need to do that work: concentration over time, delegation flows, participation trends, proposal integrity, attack indicators.
3. **AI synthesis layered on structured data.** Proposal summaries, calldata-vs-prose mismatch detection, forum thread synthesis, and similarity search are first-class features. AI is used where it adds genuine value (text-heavy synthesis); structured queries remain the foundation.
4. **Open and free.** Public dashboard with no authentication for browsing. Free developer API behind a personal access token. Transparent data model. Self-hostable for teams who require it.

### 1.6 Distribution model

**Dashboard:** Free, public, no authentication required for browsing.

**API:** Free, but token-gated. Developers register for an API key and use it on all requests. The token is for rate limiting, abuse prevention, usage analytics, and per-user revocation — not for paywalling. Anonymous requests are not supported.

This model is deliberate. Free maximizes adoption — for a portfolio-stage product, distribution beats revenue. Token-gating provides operational levers without friction (a one-time signup) and produces real usage analytics. The architecture supports future paid tiers (higher rate limits, webhooks, SLA, premium analytics) without re-architecture: tier becomes a column on the API key, not a structural change.

### 1.7 Non-goals for v1

To prevent scope creep, the following are explicitly **out of scope** for v1:

- **DAOs other than Compound, Aave, and Lido.** Three is enough to validate the unified model. Additional DAOs are a post-v1 concern.
- **Voting on behalf of users.** No transaction signing, no delegate-by-proxy, no automated voting. This is read-only analytics.
- **Treasury accounting and tax reporting.** Adjacent and tempting; out of scope.
- **Governance forum hosting or discussion features.** We _consume_ forum data; we don't host it.
- **Mobile apps.** Web responsive is sufficient.
- **Real-time alerts and webhooks.** A natural extension and a likely first paid feature, but not v1.
- **Emergency governance actions.** Aave's Guardian / Emergency Executor and equivalent mechanisms in other DAOs (admin pauses, multisig overrides, timelock bypass paths) are not modeled in v1. Operators benefit from this visibility and it is committed for v1.1, where it is modeled as a separate `governance_intervention` entity rather than retrofitted into `proposal`. (See KNOWN-003.)
- **Prediction models.** Statistical and ML-based outcome prediction is interesting but not in v1.
- **Generalized governance attack detection.** Specific known signatures may be flagged, but a comprehensive attack-detection system is post-v1.
- **Custom dashboards or saved queries.** Read-only views in v1; user accounts have an API key and that is all.

### 1.8 Success criteria for v1

The project will be considered a successful v1 if, by public launch:

- **Coverage:** All proposals, votes, and delegations for Compound, Aave, and Lido are indexed correctly, with vote tallies matching the source of truth (Tally / on-chain) to the wei.
- **Reliability:** Indexing handles reorgs correctly. The API returns consistent results. The dashboard is responsive.
- **AI features ship working:** All four committed AI features (proposal summarization, calldata-vs-prose mismatch detection, forum thread synthesis, proposal embeddings) are live for new content. The flagship features — summarization and mismatch detection — must be fully production-ready; synthesis and embeddings can ship at acceptable-quality rather than excellent-quality and improve post-launch.
- **API is usable:** Public OpenAPI docs, developer signup flow, working token authentication and rate limiting.
- **Public artifact exists:** A launch blog post containing at least one substantive analysis that could only be produced with this platform.

The project does **not** need to achieve a target user count, revenue, or external recognition to be considered a successful v1. Those are post-v1 concerns.

---

_Section 1 ends here._

---

## 2. Domain model

This section defines the entities Kvorum models, the relationships between them, and the rationale for the chosen abstractions. The domain model is the foundation everything else builds on; the API surface, the dashboard, and every analytical feature derive from these entities.

### 2.1 The unification problem

Kvorum's premise rests on a unified cross-DAO data model. The three v1 DAOs differ in structurally important ways, not just in cosmetics:

- **Compound** uses a single Governor Bravo contract on Ethereum mainnet. Voting is binary-plus-abstain; voting power is COMP balance plus delegated COMP at the proposal's snapshot block; lifecycle is linear.
- **Aave** uses Governance v3, in which voting can occur on Polygon or Avalanche while proposals originate on Ethereum and execute on multiple target chains via cross-chain payloads. Voting power is the sum of multiple token balances (AAVE + stkAAVE + aAAVE) under configurable strategies.
- **Lido** runs three governance systems in parallel: Aragon for some on-chain operational votes, Snapshot (the `lido-snapshot.eth` space) for off-chain signaling and most strategic decisions, and Dual Governance — a state machine with a dynamic timelock and stETH-holder veto power that is rolling out as a structural check on LDO holders.

A naive unification — extracting only what is common to all three — would produce a useless schema. The analytical value of Kvorum lives in handling the differences correctly.

A naive non-unification — separate per-DAO tables — would defeat the product premise. There would be no cross-DAO analysis without UNION ALL acrobatics.

The chosen approach is a real unified core with extension tables for protocol-specific data, and careful use of polymorphism where domain semantics genuinely vary (e.g., vote choice representations).

### 2.2 Architecture of the data model

The model is organized in three layers:

**Core entities.** Properly typed, normalized, indexed. These represent the universal abstractions every governance system has, even if the underlying mechanics differ. A proposal is a proposal; a vote is a vote; a delegation is a delegation. Cross-DAO queries operate at this layer. Foreign keys between core entities enforce referential integrity.

**Source-specific extension tables.** Joined by foreign key to the core. These hold the data that does not generalize: Aave's cross-chain payload metadata, Lido's dual-governance state, Snapshot's voting strategies, Aragon's quorum parameters. The presence or absence of an extension row tells you whether that data applies to a given proposal. Per-DAO queries reach into these when source-specific detail is needed.

**Raw event archive.** Append-only event-log tables, one per source type, holding the original events that Kvorum derived its state from. This is the auditability and rebuild-ability story: if a bug is discovered in interpretation logic, state can be reconstructed by replaying events. The archive is also the system of record for forensic queries (e.g., "show me the exact `VoteCast` event that recorded this vote").

### 2.3 Entity-relationship overview

The following diagram shows the core entities and their relationships. Extension tables and the raw event archive are documented separately in subsequent subsections.

```
                         ┌─────────┐
                         │   dao   │
                         └────┬────┘
                              │ 1
                              │
                              │ N
                         ┌────┴────────┐
                         │ dao_source  │  source configurations
                         └─────────────┘  (Governor, Snapshot, etc.)
                              ▲
                              │
                              │ source_type, source_id
                              │
┌─────────┐   N    ┌──────────┴──────┐   N   ┌────────────┐
│  actor  │◀───────│    proposal     │──────▶│  proposal_ │
│         │ proposer│                 │       │    action  │
│         │        │                 │       └────────────┘
│         │        │                 │
│         │        │                 │   N   ┌────────────┐
│         │        │                 │──────▶│  proposal_ │
│         │        │                 │       │    choice  │
│         │        └─────────┬───────┘       └────────────┘
│         │                  │ 1
│         │                  │
│         │                  │ N
│         │ N        ┌───────┴──────┐  N   ┌──────────────┐
│         │◀─────────│     vote     │─────▶│ vote_choice  │
│         │  voter   └──────────────┘      └──────────────┘
│         │
│         │ N        ┌──────────────┐
│         │◀─────────│  delegation  │ append-only history
│         │ delegator│              │
│         │ /delegate└──────────────┘
│         │
│         │ N        ┌──────────────────────┐
│         │◀─────────│ voting_power_snapshot│ per-proposal snapshots
└─────────┘          └──────────────────────┘
```

### 2.4 Core entities

Each core entity is defined below by its purpose, its essential fields, and its design rationale. Full column types and indexes are deferred to the database migration files; this section establishes intent.

#### 2.4.1 `dao`

Represents a single DAO that Kvorum tracks. There is one row per DAO regardless of how many governance sources that DAO uses.

Essential fields: `id`, `slug` (URL-safe identifier, e.g. `compound`, `aave`, `lido`), `name`, `primary_token_address`, `primary_chain_id`, `description`, `website_url`, `forum_url`, `created_at`, `updated_at`.

Rationale: The DAO is the user-facing aggregate. URLs and API endpoints reference DAOs by slug. The slug is stable; the UUID is internal.

#### 2.4.2 `dao_source`

Represents a single governance source that produces proposals for a DAO. A DAO may have multiple sources active simultaneously (Lido has Aragon + Snapshot + Dual Governance).

Essential fields: `id`, `dao_id`, `source_type`, `source_config` (JSONB — contract addresses, Snapshot space ID, etc.), `active_from_block`, `active_to_block` (nullable; NULL means currently active), `created_at`.

Rationale: Decouples DAO identity from the specific governance mechanism. Adding a fourth DAO is a `dao_source` insert, not a schema change. Tracking activation windows lets us model migrations correctly (e.g., when a DAO moves from Aragon to a custom Governor).

`source_type` is an enum: `compound_governor`, `aave_governor_v3`, `aragon_voting`, `snapshot`, `dual_governance`. The enum is extended carefully; new values require a migration but signal real architectural commitment.

#### 2.4.3 `actor`

Represents a participant in governance — typically a delegate, voter, or proposer. An actor may be associated with multiple addresses (a delegate using a hot wallet for voting and a cold wallet for self-delegation, for example).

Essential fields: `id`, `primary_address` (lowercase, indexed), `display_name` (ENS preferred, delegate-platform name as fallback, address shortened as last resort), `bio` (markdown, nullable), `profile_data` (JSONB — links to Twitter, forum profile, delegate platform URLs).

A separate `actor_address` table maps `(actor_id, address, is_primary, source)` for actors with multiple known addresses. Population is conservative: only when the linkage comes from a high-confidence source (delegate platform, on-chain signed message, self-attestation). Speculative clustering is out of scope for v1.

Rationale: Every reference from `proposal.proposer_actor_id`, `vote.voter_actor_id`, `delegation.delegator_actor_id`, and `delegation.delegate_actor_id` points to an actor, never to a raw address. When two addresses are later identified as the same actor, an actor merge automatically updates the unified view across all historical data. This is the foundation of cross-DAO delegate analysis.

#### 2.4.4 `proposal`

The central entity. Represents a discrete, identifiable item that a DAO can vote on, with defined start and end times, a voting outcome, and (for binding proposals) an associated set of on-chain actions.

Essential fields:

- `id` (internal UUID, never exposed externally)
- `dao_id` (FK to `dao`)
- `source_type`, `source_id` (the native ID in the source system; together with `dao_id` these form the external identifier)
- `proposer_actor_id` (FK to `actor`)
- `title` (extracted from description, nullable if unparseable)
- `description` (full markdown, source of truth for AI synthesis)
- `description_hash` (sha256, used as cache key for AI features; immutable)
- `binding` (boolean — does success cause on-chain execution?)
- `voting_starts_at`, `voting_ends_at` (timestamps)
- `voting_power_block` (nullable — the block at which voting power is captured for this proposal; NULL for purely off-chain votes that don't reference a specific block)
- `state` (enum: see below)
- `state_updated_at`
- `created_at`, `updated_at`

The `state` enum is intentionally a superset of any single source's state machine: `pending`, `active`, `succeeded`, `defeated`, `queued`, `executed`, `canceled`, `expired`, `vetoed`. Not every state applies to every source type — Compound never enters `vetoed`; Snapshot never enters `queued` or `executed` for non-binding signaling proposals. The cost of carrying unused states is minimal; the benefit is unified state filtering across all DAOs.

External references use the stable, source-derived identifier `(dao_slug, source_type, source_id)` rather than the internal UUID. URLs follow the pattern `/daos/{dao_slug}/proposals/{source_type}/{source_id}`.

#### 2.4.5 `proposal_action`

For binding proposals, the on-chain actions to execute on success. This table powers the calldata-vs-prose mismatch detector.

Essential fields: `id`, `proposal_id`, `action_index`, `target_address`, `target_chain_id`, `value_wei`, `function_signature`, `calldata` (raw hex), `decoded_function` (nullable — populated by ABI decoder when ABI is available), `decoded_arguments` (JSONB, nullable — structured representation of decoded calldata).

The presence of `decoded_function` and `decoded_arguments` indicates successful ABI resolution. When ABIs are not available — for novel target contracts or proxies with unverified implementations — these fields remain NULL but the raw `calldata` is always preserved.

Cross-chain payloads (Aave v3) are expressed by setting `target_chain_id` to the destination chain. A single proposal may have actions targeting multiple chains.

#### 2.4.6 `proposal_choice`

Describes the meaning of choice indices for a proposal. For a Compound proposal there are three rows: index 0 = "For", index 1 = "Against", index 2 = "Abstain". For a Snapshot ranked-choice proposal with five options, there are five rows with the actual option labels.

Essential fields: `proposal_id`, `index`, `label`.

Rationale: Decouples vote semantics from proposal semantics. Allows vote choices to be stored as integer indices (compact, indexable) while preserving the human-readable meaning. Necessary for handling Snapshot's flexible voting types without polluting the core schema.

#### 2.4.7 `vote`

Represents a single vote cast on a proposal. One row per voter per proposal.

Essential fields: `id`, `proposal_id`, `voter_actor_id`, `voting_power_reported` (numeric, full precision — the voting power as reported by the source: Governor contract for on-chain votes, Snapshot API for Snapshot votes), `voting_power_computed` (numeric, nullable — populated when Kvorum independently verifies voting power; NULL in v1), `voting_power_verified` (boolean — `true` when computed and reported agree within tolerance; `false` otherwise; always `false` in v1), `voting_power_discrepancy` (numeric, nullable — the absolute difference when verification was attempted but failed; NULL when verification was not attempted), `cast_at`, `block_number` (nullable for Snapshot votes), `tx_hash` (nullable for Snapshot votes), `source_id` (the native vote ID where applicable), `reason` (nullable text — vote rationale where provided), `primary_choice` (denormalized — the highest-weight choice index for this vote, used for fast aggregation).

The three-field voting power model anticipates the v1.1 Snapshot strategy verifier (see Section 3.9). For v1, `voting_power_reported` is the operational field — the source's reported value is used everywhere, equivalent to a single `voting_power` column. The additional fields are reserved for v1.1+ when independent verification populates them. For on-chain votes (Governor-based), `voting_power_reported` is verifiable by definition (Kvorum's derivation is the source); the verification fields are populated as part of the snapshot job's existing on-chain verification path.

Vote choices are expressed via the `vote_choice` table rather than a column on `vote` itself. This is necessary because Snapshot supports ranked-choice and weighted voting types where a single `choice` column cannot represent the vote correctly.

`primary_choice` is a deliberate denormalization: it allows fast "for/against split" aggregations on the dashboard without requiring a join to `vote_choice` for every query. It is computed at insert time from the underlying choices and is never used for analytical correctness — only for presentational performance. The source of truth remains `vote_choice`.

#### 2.4.8 `vote_choice`

Represents the choice or choices made within a single vote. For binary votes there is one row with `weight = 1.0`; for weighted votes there are N rows summing to 1.0; for ranked-choice votes there are N rows where `choice_index` carries the rank ordering.

Essential fields: `vote_id`, `choice_index`, `weight` (numeric, default 1.0).

Rationale: The minimum viable representation for the variety of voting types in v1 (and beyond — quadratic voting fits the same model). The 95% case (binary or three-option) costs one extra row per vote; the 5% case (ranked, weighted) is correctly representable rather than approximated.

#### 2.4.9 `delegation`

Append-only history of delegation events. Every `DelegateChanged` and `DelegateVotesChanged` event from a Governor produces a row; equivalent events from Aragon and Snapshot delegation produce rows in the same shape.

Essential fields: `id`, `dao_id`, `delegator_actor_id`, `delegate_actor_id` (nullable — NULL represents "delegated to no one"), `voting_power` (numeric — the delegated power as of this event), `block_number`, `tx_hash`, `event_type` (`delegate_changed` | `votes_changed`), `created_at`.

Rationale: Append-only is correct. Historical state is never overwritten. Current delegation state is derived: `SELECT DISTINCT ON (delegator_actor_id, dao_id) ... ORDER BY delegator_actor_id, dao_id, block_number DESC`. This makes time-travel queries possible at the cost of some derivation work — an acceptable tradeoff given the read patterns.

For Snapshot — which uses delegation strategies that may be off-chain or vary per space — delegation events are extracted from the Snapshot delegation contract on supported chains and from the Snapshot Hub API, normalized into the same table shape.

#### 2.4.10 `voting_power_snapshot`

Per-proposal snapshots of voting power for every actor that may participate in that proposal's vote. Populated lazily when a proposal enters the `active` state.

Essential fields: `id`, `actor_id`, `dao_id`, `proposal_id`, `block_number`, `power` (numeric, full precision), `computed_at`.

Rationale: Eager snapshotting (every block, every delegate) explodes storage for marginal benefit. Lazy snapshotting (per proposal) bounds the cost: hundreds to thousands of rows per proposal, which is trivial. The tradeoff is that arbitrary historical voting-power queries (for blocks that aren't proposal snapshots) require on-demand computation from delegation history — slow, but rarely needed for dashboard use cases.

The unique constraint on `(actor_id, proposal_id)` enforces immutability: once snapshotted, voting power for a proposal does not change. This is one of Kvorum's invariants.

#### 2.4.11 `forum_thread` and `proposal_forum_link`

Off-chain context lives in DAO forums (Discourse instances for Compound, Aave, and Lido). Threads are ingested separately and linked to proposals when a correspondence can be established.

`forum_thread` essential fields: `id`, `dao_id`, `source_url` (canonical), `external_id` (Discourse topic ID), `title`, `created_at`, `last_activity_at`, `post_count`, `raw_content` (concatenated post bodies, used as input to AI synthesis), `summary` (nullable — populated by AI synthesizer).

`proposal_forum_link` essential fields: `proposal_id`, `forum_thread_id`, `link_source` (`description_url` | `community_curated` | `inferred`), `confidence` (`high` | `medium` | `low`).

Rationale: Forum context is genuinely valuable for proposal understanding but is also genuinely lossy to link automatically. Tracking link source and confidence allows the dashboard to show forum context confidently when the link is reliable and to omit it when it isn't.

### 2.5 Extension tables

Extension tables hold source-specific data that does not generalize. Each is named for its source and joined to `proposal` (or another core entity) via foreign key. The presence of an extension row signals that the data applies; absence means it does not.

The v1 extension tables are:

- **`compound_proposal_metadata`**: `proposal_id`, `governor_address`, `eta` (queue execution time), `queued_at`, `executed_at`, `canceled_at`. Captures Compound-specific lifecycle timestamps that don't fit the unified `state_updated_at` model cleanly.

- **`aave_proposal_metadata`**: `proposal_id`, `voting_chain_id` (where votes were cast), `voting_machine_address`, `voting_strategy_address`, `creation_block`. Captures Aave v3's voting-machine architecture.

- **`aave_proposal_payload`**: One row per cross-chain payload. `id`, `proposal_id`, `payload_index`, `target_chain_id`, `payloads_controller_address`, `payload_id_on_chain`, `executed_at_destination`, `bridge_message_id` (nullable). Tracks the cross-chain execution graph.

- **`aragon_proposal_metadata`**: `proposal_id`, `app_address` (the Aragon Voting app instance), `voting_app_version`, `support_required_pct`, `min_accept_quorum_pct`, `executed_at`. Aragon's quorum and acceptance parameters.

- **`snapshot_proposal_metadata`**: `proposal_id`, `space_id`, `voting_type` (`single-choice` | `weighted` | `ranked-choice` | `quadratic` | `approval` | `basic`), `strategies` (JSONB — Snapshot's strategy configuration), `ipfs_hash`, `network` (the chain on which voting power is calculated). Snapshot's strategy data is genuinely free-form and lives in JSONB by design.

- **`dual_governance_state`**: `proposal_id`, `current_state` (the dual-governance state machine state), `last_transition_at`, `rage_quit_eth_amount` (nullable), `veto_signaling_started_at` (nullable), `veto_signaling_deactivated_at` (nullable). Tracks Lido's dual-governance state machine.

- **`snapshot_delegation`**: A separate delegation table for Snapshot's space-specific delegation graph, which doesn't always correspond to on-chain delegation. Fields parallel `delegation` but with `space_id` and `network` to capture Snapshot's scoping.

Adding a fourth DAO post-v1 typically means adding zero, one, or two new extension tables, not modifying core entities.

### 2.6 Raw event archive

Each source type writes its raw events to an append-only archive table. These tables are the source of truth from which derived state (proposal, vote, delegation) is reconstructed.

The archive tables are not directly queried by user-facing features. They exist for:

- **Auditability**: every piece of derived state can be traced back to the events it was computed from.
- **Rebuildability**: when interpretation logic is corrected, derived state is regenerated by replaying events. This is the operational story for handling bugs.
- **Forensics**: when investigating anomalies, the raw events are the unambiguous record.

Per-source archives are appropriate because event shapes differ substantially. Concrete tables:

- `event_archive_compound_governor`
- `event_archive_aave_v3`
- `event_archive_aragon`
- `event_archive_snapshot`
- `event_archive_dual_governance`

Each has a common header (`id`, `dao_source_id`, `block_number` or `event_timestamp`, `tx_hash` or `external_id`, `event_type`, `received_at`, `confirmed_at`) and a `payload` JSONB column for the event-specific data. The JSONB is appropriate here because the raw event format is the source's responsibility, not Kvorum's.

### 2.7 Storage strategy across systems

The model is implemented across three storage systems, each chosen for fit.

**Postgres (source of truth, all transactional state):**

- All core entities (`dao`, `dao_source`, `actor`, `proposal`, `proposal_action`, `proposal_choice`, `vote`, `vote_choice`, `delegation`, `voting_power_snapshot`, `forum_thread`, `proposal_forum_link`)
- All extension tables
- All raw event archive tables
- `pgvector` indexes on proposal description embeddings, forum thread embeddings, and vote rationale embeddings

The data volumes for the v1 DAOs comfortably fit in Postgres. Estimates: low thousands of proposals, low hundreds of thousands of votes, low hundreds of thousands of delegation events. Postgres handles this without strain.

**ClickHouse (analytical mirror, time-series queries):**

- `voting_power_history_flat(actor_id, dao_id, block_number, power, timestamp)` — flattened, denormalized, optimized for delegate trajectory queries
- `vote_events_flat` — denormalized join of vote, voter, proposal, dao, used for fast aggregations across millions of rows
- `delegation_flow_flat` — directed graph edges with timestamps, for delegation flow visualizations and concentration metrics over time

For v1 with three DAOs, ClickHouse is technically optional — the analytical queries run acceptably on Postgres. ClickHouse is set up nonetheless, with mirror writes from Postgres, so that scaling to additional DAOs post-v1 does not require rewriting analytical queries.

**Redis:**

- Job queues (BullMQ for AI synthesis tasks, ABI decoding, and other background work)
- Rate limiting state for the API
- (v1.1+) WebSocket and SSE subscription routing across API instances

**Not used:** MongoDB. The data is structured, the relationships matter, and the analytical access patterns benefit from joins. Adding Mongo would be technology theater.

### 2.8 Invariants

The following invariants are enforced by the model and must be preserved by all code paths that mutate state:

1. **Voting power at the voting-power block is immutable once set.** Once a proposal has entered the `active` state and `voting_power_snapshot` rows have been written for that proposal, those values are never updated. (The "voting-power block" — sometimes called the snapshot block in EVM governance literature — is the block at which a voter's power is frozen for the purpose of this specific vote.)
2. **Vote rows are append-only after final confirmation.** Once a vote is past reorg-confirmation depth, it is never modified or deleted. (Pre-confirmation, votes may be deleted if a reorg invalidates them; this is handled by the ingestion pipeline before promotion to confirmed state.)
3. **Delegation rows are append-only.** Every delegation event creates a new row. "Current delegation" is a derived view, never a stored value.
4. **Actor identities are mergeable, never deletable.** When two actors are identified as the same entity, a merge operation rewrites foreign keys and consolidates them into one. Direct deletion is forbidden.
5. **Source IDs are stable per `(dao_id, source_type)`.** Native source IDs are never reused. A Compound proposal with `source_id = 42` is permanently proposal 42 in Compound.
6. **External references use stable, source-derived identifiers.** Internal UUIDs are not exposed in URLs or API responses. The external identifier is always `(dao_slug, source_type, source_id)`.
7. **The raw event archive is the source of truth.** Derived state can be reconstructed from the archive. Any inconsistency between derived state and the archive is resolved by trusting the archive and rebuilding the derivation.

### 2.9 What this model does not yet address

Deferred to later spec sections:

- The exact ingestion pipeline that populates these entities (Section 3).
- The API representation of these entities, including pagination, filtering, and the public identifier scheme (Section 4).
- The AI features that operate on the textual portions of these entities (Section 5).
- The dashboard views that surface these entities to users (Section 6).
- Performance characteristics, indexing strategy, and operational concerns (Section 7).

Open questions that this section deliberately leaves to the decisions log:

- Whether to denormalize a `proposal.tally_summary` column (current totals per choice) for read performance, or always derive from `vote_choice`. Decision pending; will be made when API performance characteristics are known.
- How to model proposals that are amended or superseded by another proposal. Currently no DAO in v1 has this concept formally on-chain, but Lido's dual governance has resubmission semantics that may require modeling.
- Whether `actor` should have a separate `is_contract` flag with associated metadata. Multisigs and DAOs voting in other DAOs are first-class participants and may deserve explicit modeling beyond the address-as-actor abstraction.

---

_Section 2 ends here._

---

## 3. Data sources & ingestion

This section defines how Kvorum populates and maintains the state described in Section 2. The ingestion layer is responsible for turning heterogeneous external sources — EVM contracts on multiple chains, the Snapshot Hub GraphQL API, Discourse forum APIs — into the unified domain model, correctly and reliably, in the presence of reorgs, RPC failures, and rate limits.

The design priorities for this layer are, in order: **correctness** (the canonical state must always be derivable from raw events), **convergence** (live ingestion and backfill must produce the same state), and **operability** (failures must be visible, recoverable, and bounded in cost).

### 3.1 Pipeline overview

The ingestion pipeline is logically a pipeline of stages, each with a defined contract:

```
                    ┌──────────────────────┐
                    │  External sources    │
                    │  (RPC, GraphQL, API) │
                    └──────────┬───────────┘
                               │ raw events
                               ▼
                    ┌──────────────────────┐
                    │  Source adapters     │  one per source type
                    │  (chain-aware)       │  knows ABIs, schemas
                    └──────────┬───────────┘
                               │ normalized events
                               ▼
                    ┌──────────────────────┐
                    │  Event archive       │  append-only, all events
                    │  (per-source tables) │  with confirmation_status
                    └──────────┬───────────┘
                               │
                       ┌───────┴────────┐
                       │                │
                       ▼                ▼
              ┌─────────────────┐  ┌──────────────┐
              │ Reorg detector  │  │ Derivation   │
              │ writes reorg_   │  │ layer (only  │
              │ event on chain  │  │ confirmed)   │
              │ rewrites        │  └──────┬───────┘
              └─────────────────┘         │
                                          ▼
                               ┌──────────────────────┐
                               │  Core entities       │
                               │  (proposal, vote,    │
                               │   delegation, ...)   │
                               └──────────┬───────────┘
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │  Side effects        │  AI jobs, ClickHouse
                               │  (queues)            │  mirror, WS broadcasts
                               └──────────────────────┘
```

This separation is deliberate. The event archive is the system of record. All canonical state in the core entities is _derived_ from the archive — specifically, from events whose `confirmation_status` is `confirmed`. Bugs in derivation logic are recoverable by replaying the archive, and the archive itself is logically append-only (rows are written once; only the `confirmation_status` field transitions through a defined lifecycle).

Reorgs are first-class events. When the reorg detector observes that a previously-recorded block is no longer part of the canonical chain, it writes a `reorg_event` record and transitions affected event rows from `pending` to `orphaned`. The canonical post-reorg events arrive as new archive rows. The full reorg history is preserved.

### 3.2 Event lifecycle

Every external event passes through a defined lifecycle, recorded explicitly on the event row itself rather than via row movement between tables.

1. **Observed.** The source adapter has received a raw event. It is normalized and written to the event archive immediately, with `confirmation_status = 'pending'` and the observed `block_number` and `block_hash` populated. The event is not yet visible through the public API or dashboard (see Section 3.4 for the v1 visibility decision); it is recorded for confirmation processing and audit.
2. **Confirmed.** The event has aged past the source's reorg horizon and the canonical chain still contains the same `block_hash` at this `block_number`. The row's `confirmation_status` transitions to `confirmed`. The derivation layer is notified and projects the event into core entities.
3. **Orphaned.** A reorg has removed this event's block from the canonical chain. The row's `confirmation_status` transitions to `orphaned`. A `reorg_event` row is written linking this event to the reorg that invalidated it. No derived state changes are required because no derived state was created (events only project to core entities at confirmation).
4. **Re-observed (post-reorg, if applicable).** If the canonical post-reorg chain contains a semantically equivalent event, it arrives via live ingestion or polling and lands as a _new_ archive row (different `block_hash`) with its own lifecycle starting at `pending`. The old `orphaned` row remains in the archive forever as part of the audit trail.

The status field has three terminal values for any given row: `confirmed`, `orphaned`, or `pending` (the in-flight state). The data fields of a row — its payload, block number, block hash, transaction hash — are immutable from the moment of insertion. Only `confirmation_status` and `confirmed_at` / `orphaned_at` timestamps are written after the initial insert.

This model has several useful properties:

- **Truly append-only data.** Event payloads are never rewritten. Audit trail is complete by construction.
- **Reorg history is observable.** The `reorg_event` table is a queryable record of every reorg Kvorum observed, linked to the events it affected. Useful for debugging and for analytical content.
- **No separate pending buffer.** Pending events live in the archive alongside everything else; they are simply queried with a `confirmation_status` filter. One storage system, one source of truth.
- **Derivation is conservative.** Core entities reflect only confirmed events. A reorg that invalidates a pending event has no effect on derived state, because the event was never projected.
- **Pre-confirmation visibility is opt-in (post-v1).** The archive distinguishes pending from confirmed events via the `confirmation_status` field. v1 surfaces only confirmed events through the public API and dashboard; pending visibility is a planned v1.1 feature exposed via opt-in query parameters and subscription modes. See Section 3.4 for the full rationale and forward-compatibility commitments.

### 3.3 EVM source ingestion

The Compound Governor, Aave Governance v3, Aragon Voting, and Lido Dual Governance contracts are all EVM-based and share a common ingestion shape, abstracted by the `EVMEventIngester` component.

For each `dao_source` of an EVM type, the ingester maintains:

- A configured contract address (or addresses) per chain
- A set of event signatures (topic[0] hashes) to subscribe to
- A current head block (the highest block number processed)

Two ingestion modes run concurrently:

**Live ingestion** subscribes to the chain's WebSocket endpoint with `eth_subscribe('logs', filter)`. Each new log is normalized and written to the event archive immediately with `confirmation_status = 'pending'`. The ingester also subscribes to `newHeads` so it can track block confirmations and transition pending events to `confirmed` as they age past the reorg horizon. Reorg detection (block hash mismatch on the same number, or a drop in chain head) triggers the orphaning flow described in Section 3.4.

**Polling fallback** runs in parallel as a defense against missed events. Every N blocks, the ingester runs an `eth_getLogs` query covering the recently-finalized window and reconciles results against the archive. Any event present in the polling result but missing from the archive is inserted; this catches WebSocket disconnections and missed events. Idempotency on `(chain_id, tx_hash, log_index, block_hash)` ensures duplicates are harmless. (Note the inclusion of `block_hash` in the idempotency key — this is intentional, so that the same logical event observed under two different block hashes during a reorg produces two distinct archive rows rather than overwriting each other.)

This dual-path design is deliberately redundant. WebSockets are convenient but unreliable in practice; `eth_getLogs` is reliable but lacks low-latency. Running both gives Kvorum both properties.

### 3.4 Reorg handling

Reorg handling is the load-bearing correctness feature of EVM ingestion. Kvorum's approach is **append-only with explicit invalidation events**: the archive is never rewritten on reorg, and reorgs are themselves first-class records.

**The model.** When a reorg is detected, two things happen:

1. A `reorg_event` row is written, recording the reorg as an observable historical event.
2. The affected event archive rows have their `confirmation_status` transitioned from `pending` to `orphaned`. The data fields of those rows (payload, block hash, transaction hash) are not changed. The orphaned rows remain in the archive permanently, linked to the reorg event that invalidated them.

The canonical post-reorg chain produces new events through normal live ingestion. These land as new archive rows with their own `block_hash` (different from the orphaned rows' hashes) and follow the standard pending → confirmed lifecycle.

**Reorg horizon per chain.** Each chain has a configured reorg horizon — the number of confirmations required before an event is considered final. Defaults: Ethereum mainnet 12, Polygon 128, Arbitrum 40, Optimism 40, Avalanche 30, Base 40. These are conservative; the actual practical reorg depth on these chains is usually much shallower, but the cost of being conservative is small (a few minutes of additional ingestion latency) and the cost of being wrong is corrupted state.

**Reorg detection.** The ingester maintains a sliding window of recently-observed block hashes per chain (covering the reorg horizon). On every new block from the WebSocket subscription, it compares the new block's parent hash against the previously-recorded block at that height. A mismatch indicates a reorg. The ingester then:

1. Walks backwards from the divergence point to identify the full range of orphaned blocks.
2. Re-fetches the canonical block hashes for the divergence window via `eth_getBlockByNumber` to confirm.
3. Writes a `reorg_event` row with `chain_id`, `detected_at`, `divergence_block_number`, `orphaned_block_hashes` (array), `canonical_block_hashes` (array).
4. Updates affected archive rows: `confirmation_status = 'orphaned'`, `orphaned_at = now()`, `orphaned_by_reorg_event_id = <new reorg_event id>`.

**Confirmation transitions.** Events past the reorg horizon are promoted via a periodic job:

```
UPDATE event_archive_*
SET confirmation_status = 'confirmed', confirmed_at = now()
WHERE confirmation_status = 'pending'
  AND chain_id = $1
  AND block_number <= $latest_block - $reorg_horizon;
```

This is an idempotent, set-based operation. The derivation layer subscribes to confirmation transitions (via Postgres LISTEN/NOTIFY or polling) and projects newly-confirmed events into core entities.

**Derived state is built only from confirmed events.** This is the load-bearing simplification. A reorg that orphans pending events causes no downstream state changes, because no `vote`, `proposal`, or `delegation` row was ever created for those events. The derivation layer is a pure projection of `confirmation_status = 'confirmed'` rows from the archive into the core entity tables. Replaying the projection is straightforward: truncate core entities, then re-derive from confirmed archive rows.

**Pre-confirmation visibility — v1 decision.** (See KNOWN-001.) Kvorum v1 ships with **confirmed-only visibility**: the public API and dashboard expose only events whose `confirmation_status` is `confirmed`. Pending events are observed and recorded in the archive but are not surfaced through the public read path. The justification:

- It is the safest correctness story for initial launch. Any latent issue in pending-event handling — a reorg edge case, a misclassified event — is contained inside Kvorum's internal state and never visible to users.
- The added latency is bounded by the reorg horizon (≈2.5 minutes on Ethereum mainnet, ≈5 minutes on Polygon for Aave votes). For governance use cases, this is acceptable: votes happen over hours or days, not seconds.
- The audience for sub-minute pending visibility is narrow (researchers watching contentious votes in real-time), and the value proposition is unclear until users ask for it.

**Forward-compatibility commitments.** To keep the upgrade path to pending visibility cheap, v1 commits to the following:

- All API response payloads for entities with a confirmation lifecycle (votes, proposals, delegation events, voting power snapshots) include a `confirmed: boolean` field. In v1 this field is always `true`. Clients that ignore the field continue to work; clients that branch on it gain pending support automatically when it's enabled.
- The streaming protocols (WebSocket and SSE) themselves are deferred to v1.1 (KNOWN-014). When they ship, their event payloads will include a `confirmation_status` field with values `confirmed`, `pending`, or `orphaned` — anticipated in this spec but not yet implemented.
- The internal repository layer is designed with an `includePending: boolean` parameter (defaulting to `false`) on read methods. The query path supports both modes from day one; only the API and dashboard consume the default-`false` path in v1.

**v1.1 scope (planned, not committed).** The natural next increment is opt-in pending visibility via an `?include_pending=true` query parameter on relevant API endpoints, plus an opt-in WebSocket subscription mode. Dashboard support for displaying pending events with explicit visual treatment (faded styling, "preliminary" badges) is a further increment beyond that. Both are deferred to v1.1+, but the architecture supports them without schema or API breaking changes.

**Reorg analytics as a side benefit.** The `reorg_event` table is queryable: "what reorgs have occurred on Ethereum mainnet in the last 30 days, and what governance events did they affect?" This is the kind of operational visibility most chain analytics products silently lack. It is also content — a reorg log on the dashboard demonstrates Kvorum's correctness story and is engaging in its own right.

**Reorg detection test.** As part of milestone acceptance, the ingester is exercised against an Anvil-forked mainnet with a synthetic reorg injected at a known block. The test verifies that:

1. Pending events from the orphaned branch are transitioned to `orphaned` status.
2. A `reorg_event` row is written linking them to the reorg.
3. Canonical post-reorg events are inserted as new archive rows.
4. No core entity rows were created for the orphaned events (because they never confirmed).
5. Re-running the projection produces the same final state.

This test is part of CI.

### 3.5 Aave cross-chain stitching

Aave Governance v3 is the most complex ingestion path in v1 because a single proposal touches up to seven chains:

- **Ethereum mainnet** is the proposal origin. The `Governance` contract emits `ProposalCreated`, `ProposalQueued`, `ProposalExecuted`, and bridge messages to voting machines.
- **Polygon or Avalanche** is the voting chain. The `VotingMachine` contract receives a bridge message containing the proposal, snapshots voting power, and emits `VoteEmitted` for each vote and `VoteBridged` when results are sent back to mainnet.
- **Multiple destination chains** (Ethereum, Polygon, Avalanche, Arbitrum, Optimism, Base, Metis, BNB) host `PayloadsController` contracts that execute the actual on-chain payloads when the proposal is approved.

Kvorum stitches these together using the proposal ID as the correlation key:

1. The `ProposalCreated` event on mainnet creates the `proposal` row and `aave_proposal_metadata` extension row.
2. The mainnet `Governance` contract's `BridgeMessageSent` events identify which voting machine on which chain will handle voting; this updates `aave_proposal_metadata.voting_chain_id`.
3. Voting on the voting chain (Polygon or Avalanche) populates `vote` and `vote_choice` rows. Reorg horizons on the voting chain apply.
4. The `VoteBridged` event on the voting chain marks the end of voting; subsequent state transitions (queued, executed) are observed on mainnet.
5. Each `aave_proposal_payload` row tracks one cross-chain payload, ingested independently from each destination chain's `PayloadsController`. The `executed_at_destination` field is set when the destination chain confirms execution.

The stitching is the senior-engineering claim of Aave integration. A misaligned proposal ID, a missed bridge message, or an out-of-order arrival between chains produces incorrect state. Tests exercise each transition explicitly using historical proposals as fixtures, with assertions that the final stitched state matches the on-chain truth on every involved chain.

### 3.6 Snapshot.org ingestion

Snapshot is fundamentally different from EVM sources: it is an off-chain platform with a GraphQL API at `hub.snapshot.org/graphql`. There are no events to subscribe to and no reorgs to handle, but there are other concerns: API rate limits, eventual consistency across Snapshot's IPFS pinning, and a richer voting type system.

The Snapshot ingester runs as a separate worker, polling on a 60-second cadence per configured space (`compound.eth`, `aave.eth`, `lido-snapshot.eth`).

For each polling cycle:

1. **Proposals.** Query proposals updated since the last cycle's high-water mark, paginated by `created_gt` cursor. Each proposal is normalized and upserted into `proposal` plus `snapshot_proposal_metadata`. The IPFS hash is preserved for auditability.
2. **Votes.** For each proposal in `active` or `pending_close` state, query the votes since the last cycle. Vote choices are translated through the voting type:
   - `single-choice` and `basic`: one `vote_choice` row with the chosen index, `weight = 1.0`
   - `weighted`: N rows, each with the per-option weight (Snapshot returns these as a normalized vector summing to 1.0)
   - `ranked-choice`: N rows with `choice_index` as rank
   - `quadratic`: handled like weighted with the appropriate strategy interpretation
   - `approval`: N rows with `weight = 1.0` for each approved option
3. **Closed proposals.** Proposals that have transitioned to `closed` are queried once more to capture the final tally, then removed from the active polling set.

Snapshot does not provide block-level event semantics, so `vote.block_number` and `vote.tx_hash` are NULL for Snapshot votes. The `vote.cast_at` timestamp comes from Snapshot's `vote.created` field. Snapshot's source IDs (proposal hashes and vote hashes) are stable and used as `source_id`.

**Rate limiting.** Snapshot's public API allows 60 requests per minute per IP at the time of writing. Kvorum's polling load (three spaces, 60-second cadence, paginated queries) stays comfortably under this. An exponential backoff is implemented for rate-limit responses regardless.

**No raw event archive in the EVM sense.** Because Snapshot does not provide event-level granularity, the "archive" for Snapshot is the raw GraphQL response, stored in `event_archive_snapshot` as a JSONB payload. The same rebuild-from-archive guarantees apply: derived state is reconstructable from the archived responses.

### 3.7 Forum ingestion and proposal linking

DAO governance forums (Discourse instances at `gov.compound.finance`, `governance.aave.com`, `research.lido.fi`) are ingested via Discourse's JSON API.

**Crawling.** A scheduled worker crawls each forum's governance category (configurable per `dao`). The Discourse endpoints used:

- `/c/{category_slug}/{category_id}.json?page=N` — list of topics in a category, paginated
- `/t/{topic_id}.json` — full topic content with all posts

Crawling cadence: every 30 minutes for active categories, every 6 hours for full reconciliation.

**Forum content storage.** Each topic produces or updates a `forum_thread` row. The `raw_content` field is the concatenated body of all posts in the thread, normalized to plain text (HTML stripped, code blocks preserved). Updates to `last_activity_at` and `post_count` happen on each crawl.

**Proposal linking.** Linking forum threads to proposals is best-effort and uses three signals in order of confidence:

1. **High confidence — URL reference in proposal description.** When the proposal's `description` markdown contains a URL pointing to the forum thread, the link is created with `link_source = 'description_url'` and `confidence = 'high'`.
2. **Medium confidence — community-curated mapping.** Some DAOs use consistent forum-thread-to-proposal naming conventions (e.g., Aave's `[ARFC]` and `[AIP]` prefixes). DAO-specific extractors recognize these and create links with `link_source = 'community_curated'` and `confidence = 'medium'`.
3. **Low confidence — title and timing similarity.** When neither of the above produces a link, an embedding-based similarity pass may produce a candidate link. These are stored with `confidence = 'low'` and surfaced in the UI as "possibly related" rather than as a direct link.

The link-extraction logic is deterministic for the high and medium confidence paths and is run on every proposal ingestion. Low-confidence linking is asynchronous and is a candidate for the AI worker pipeline.

### 3.8 ABI decoding pipeline

ABI decoding is performed locally. Kvorum is already running EVM ingestion against full nodes; the tools needed to decode calldata are mostly already in hand. External block-explorer APIs are used only as an optional enrichment path, not as a runtime dependency.

When a `proposal_action` row is inserted with raw `calldata`, an ABI-decode job is enqueued. The decoder runs as a separate worker.

**Decoder logic, in order:**

1. **Function selector resolution.** The first four bytes of `calldata` are the function selector. The decoder consults two local sources:
   - **The bundled selector index.** A snapshot of the public 4byte.directory dataset, committed to the repo and refreshed on a weekly cadence by a maintenance job. Maps selectors to function signatures. This resolves the vast majority of common functions without any network call.
   - **Selector observations.** A `selector_index` table populated incrementally from every ABI Kvorum has ever loaded. New selectors discovered through verified ABIs are added here.

2. **Bundled ABI library.** Common contracts have known ABIs that ship with Kvorum: ERC20, ERC721, ERC1155, OpenZeppelin AccessControl, OpenZeppelin Governor (and Compound's Governor Bravo), Aave's `Governance`, `VotingMachine`, `PayloadsController`, Lido's `Voting` app and Dual Governance contracts, common multisig wallets (Safe), and the Lido and Aave token contracts. These are committed to the repo as JSON ABIs and loaded at startup. The library covers the contracts that >95% of governance proposal actions target.

3. **Proxy resolution.** Many DAO-controlled contracts are upgradeable proxies. When the target address has not yielded an ABI from the library, the decoder reads the EIP-1967 implementation slot via `eth_getStorageAt(target, 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)`. If a non-zero address is returned, the decoder recurses with the implementation address as the target. EIP-1822 (Universal Upgradeable Proxy Standard) and OpenZeppelin Transparent Proxy are similarly supported via their respective storage slots.

4. **Verified-ABI enrichment (optional).** For target contracts not resolved by the bundled library or proxy resolution, the decoder may consult block explorer APIs (Etherscan, Polygonscan, Arbiscan, etc.). This is an _optional_ enrichment path: it is run as a slow-path background job, not on the critical path, and the system functions correctly without it. Free-tier API keys are used where available; failures degrade silently. Successfully retrieved ABIs are added to the `abi_cache` table for future use.

5. **Heuristic decoders for known patterns.** For common function signatures that are universal — `transfer(address,uint256)`, `approve(address,uint256)`, `grantRole(bytes32,address)`, `setImplementation(address)`, etc. — the decoder uses built-in handlers that produce structured output without requiring a full ABI. This handles cases where the contract is unverified but performs standard operations.

6. **Failure path.** If none of the above resolve, the decoder stores the function selector in `proposal_action.function_signature` for at-a-glance identification, leaves `decoded_function` and `decoded_arguments` NULL, and re-enqueues the job with a 24-hour delay. Contracts are sometimes verified or upgraded after the fact; the retry catches this without manual intervention.

**ABI cache.** The `abi_cache(chain_id, address, abi JSONB, source, fetched_at, implementation_address)` table holds every ABI Kvorum has resolved for a given target. Cache entries survive indefinitely. ABIs do not change for a deployed contract, except via proxy upgrades, which are themselves observable events that invalidate the implementation pointer for the proxy.

**Output.** Successfully decoded actions populate `decoded_function` (the canonical function signature) and `decoded_arguments` (a JSONB object with named parameters). This output is the primary input to the calldata-vs-prose mismatch detector (Section 5).

**Why local-first.** The decision to keep decoding local is twofold. First, it keeps Kvorum's hot path independent of third-party services with rate limits and uptime concerns. Second, it is in keeping with the project's character: Kvorum is a read-only blockchain analytics platform; depending on a centralized API for the most basic decoding step would be ironic. The bundled ABI library covers >95% of governance calldata in practice; the long tail is handled gracefully via the optional enrichment path.

### 3.9 Voting power computation

Voting power at a given block is the most subtle ingestion concern. The naive answer ("read it from the contract") is correct but slow at scale; the optimization is to compute it from delegation events plus token balance events.

For Compound and Aave (Governor patterns), voting power is:

```
power(address, block) = self_balance(address, block)
                      + sum(delegated_in - delegated_out applied through block)
```

Two implementation paths:

**On-chain read path.** For correctness verification and edge cases, Kvorum can call `getPriorVotes(address, block)` (Compound) or `getVotingPowerAt(address, block, strategy)` (Aave) directly via the RPC. This is authoritative but requires an archive-node-equivalent RPC endpoint and is rate-limited. Used sparingly for verification.

**Derived path.** Kvorum maintains a derived view of voting power by processing `DelegateChanged` and `DelegateVotesChanged` events from the delegation history. This is fast and uses only data Kvorum already has. The derived path is the default; it is verified against the on-chain read path for a sample of (address, block) pairs per proposal as part of the snapshot job.

**Snapshot job.** When a proposal enters the `active` state, a job is enqueued to compute voting power for that proposal's `voting_power_block`:

1. Identify all addresses that have ever delegated to or self-delegated within this DAO (a query against `delegation`).
2. For each address, compute voting power at `voting_power_block` using the derived path.
3. Write `voting_power_snapshot` rows in a single transaction.
4. Sample 20 random addresses; verify against the on-chain read path. On mismatch, log an error, fall back to on-chain reads for the entire proposal, and emit a critical alert. (Mismatches indicate a bug in derivation; they are bugs to fix, not noise to tolerate.)

For Aave, voting power involves the strategy (AAVE + stkAAVE + aAAVE), and the snapshot block is on the _voting chain_, not mainnet. The same job structure applies; the strategy-specific aggregation is handled by an Aave-specific computation module.

**Snapshot voting power — v1 decision.** (See KNOWN-002.) For Snapshot proposals, voting power is determined by the proposal's `strategies` array (which can be arbitrary — token balance, ERC721 ownership, custom contracts, with-delegation aggregations, multichain sums). Snapshot v1 ships **trusting Snapshot's reported voting power**: the `vote.voting_power_reported` field is taken directly from Snapshot's API, which performs the strategy evaluation itself, and `voting_power_computed` and `voting_power_verified` remain unset. This is a real trust boundary — Kvorum has no independent verification that Snapshot's reported power is correct.

The justification for this v1 choice:

- The three v1 DAOs use roughly 3–4 distinct Snapshot strategies between them. Implementing them is tractable but adds approximately a week of focused work plus ongoing maintenance when strategies evolve.
- v1's core technical claim is the unified cross-DAO schema. Adding independent Snapshot verification stacks a second substantial claim that risks neither being well-executed.
- The audience that cares about this verification (sophisticated researchers, governance auditors) is a small subset of v1 users.

**Forward-compatibility commitments.** To keep the upgrade path cheap, v1 commits to schema that anticipates verification:

- The `vote` table includes both `voting_power_reported` (from the Governor contract for on-chain votes, from Snapshot's API for off-chain votes) and `voting_power_computed` (nullable; NULL in v1, populated by Kvorum's verifier in v1.1+).
- A `voting_power_verified` boolean field indicates whether Kvorum has independently verified the value. Always `false` in v1; set to `true` in v1.1+ when computed and reported agree within tolerance.
- A `voting_power_discrepancy` numeric field records the absolute difference when `verified` is `false` despite a computation being attempted. NULL when verification is not attempted.

**v1.1 scope (planned, not committed).** A Snapshot strategy resolver implementing the strategies used by Compound, Aave, and Lido Snapshot spaces, with a graceful fallback to trust-Snapshot semantics for any strategy not implemented. Verification populates the `voting_power_computed` and `voting_power_verified` fields. Discrepancies are surfaced both in the API and as their own analytical view ("Snapshot voting power discrepancies detected by Kvorum"). This is a strong differentiator and natural v1.1 launch beat.

For v1, trust here is bounded but acknowledged: Snapshot is the authoritative source for Snapshot votes by definition, until Kvorum can verify otherwise.

### 3.10 Backfill strategy

Backfill is the process of reconstructing historical state from before Kvorum's first deployment. It runs once per `dao_source`, then never again unless a manual rebuild is triggered.

**The unification claim.** Backfill and live ingestion run the _same code path_ — an `EVMEventIngester` configured with `(from_block, to_block)` rather than `(latest, latest)`. The backfill simply iterates the block range in chunks, calling the same normalization and archival logic. This is enforced architecturally, not by convention: there is no separate "backfill mode" in the ingester.

**Chunking.** EVM `eth_getLogs` calls are chunked by block range. Default chunk size is 10,000 blocks, with adaptive shrinking if the RPC rejects the request (typically due to result size limits). Chunks are processed sequentially per source to bound concurrent RPC load.

**Resumability.** Backfill progress is checkpointed to the `dao_source` row's `backfill_head_block` field after each successful chunk. A backfill that crashes resumes from the last checkpoint without re-processing.

**Idempotency.** Inserts into the event archive are idempotent on `(chain_id, tx_hash, log_index)`. Re-running a chunk produces no duplicates and is harmless. This is essential for resumability.

**Reorg horizon during backfill.** Because backfill operates on historical (deeply confirmed) blocks, events are written directly with `confirmation_status = 'confirmed'`. The pending lifecycle is bypassed entirely. The reorg horizon only applies to live ingestion at the chain head.

**Snapshot backfill.** For Snapshot, backfill paginates through the GraphQL API from genesis using `created_gt` cursors. Same shape, different transport.

**Forum backfill.** The Discourse API supports historical traversal of any topic by `topic_id`. Backfill enumerates topics in the configured categories and fetches each in full.

**Initial backfill duration.** Estimates for v1's three DAOs:

- Compound: ~400 proposals, ~10,000 votes, ~50,000 delegation events. Backfill in ~30 minutes.
- Aave: similar order of magnitude across Governance v2 and v3. ~1 hour.
- Lido: smaller proposal count (Aragon votes), but many delegation events. ~30 minutes.

These are bounded by RPC rate limits more than computation. Free-tier RPC providers are sufficient.

### 3.11 RPC infrastructure and failover

Every external network dependency in the ingestion layer is abstracted through a client with retry, fallback, and circuit-breaking behavior.

**Multi-provider failover for EVM RPC.** Each chain has a configured ordered list of RPC providers (e.g., for Ethereum mainnet: Alchemy primary, Ankr fallback, Cloudflare public RPC tertiary). The client attempts the primary on each request. On failure (timeout, 5xx, rate limit), it falls through the list. A circuit breaker per provider tracks failure rates and temporarily skips providers exceeding a failure threshold, retrying them periodically.

**Health checks.** Each RPC connection is health-checked every 30 seconds with `eth_blockNumber`. Stale or lagging providers (more than N blocks behind the leader) are deprioritized.

**WebSocket reconnection.** WebSocket subscriptions reconnect automatically with exponential backoff. On reconnection, the polling fallback (Section 3.3) catches any events missed during the disconnection.

**Snapshot Hub failover.** Snapshot's hub has known reliability issues. Kvorum supports a configured list of mirror hubs (`hub.snapshot.org`, `testnet.hub.snapshot.org` for testing). The same retry and circuit-breaker pattern applies.

**Discourse forum failover.** Forums are best-effort sources. Failures are logged but do not block proposal ingestion. Forum threads are reconciled on the next successful crawl.

### 3.12 Operational concerns

The non-glamorous things that determine whether the system actually runs.

**Dead-letter queue.** Every ingestion stage has a DLQ table: `ingestion_dlq(stage, source, payload, error, retries, first_seen_at, last_attempt_at)`. Events that fail processing after their retry budget is exhausted land here for human review. The dashboard exposes a count of DLQ entries per source as a key health indicator.

**Idempotency keys.** All write operations to the event archive are idempotent on the natural key (`chain_id, tx_hash, log_index` for EVM events; the source-specific ID for off-chain events). Re-processing the same event produces no duplicate state and no errors.

**Observability.**

- **Structured logging** at every stage transition, with consistent field names (`source`, `dao_id`, `event_type`, `block_number`).
- **Metrics** exposed in Prometheus format: ingestion lag per source (head_block_age in seconds), pending event count per chain (events awaiting confirmation), DLQ size, reorg event count, RPC error rate per provider, derivation throughput.
- **Alerts** configured against these metrics: ingestion lag exceeding 5 minutes for any source for more than 10 minutes, DLQ size exceeding 100, RPC error rate exceeding 10% for any provider sustained for 5 minutes.
- **Tracing** via OpenTelemetry for cross-service requests; the derivation layer's trace shows the full event-to-derived-state path.

**Cost discipline.**

- All RPC providers used in v1 have free tiers sufficient for the v1 load. Quotas are tracked in metrics; alerts fire at 80% utilization to allow proactive provider changes before quota exhaustion.
- Snapshot's public API is free with rate limits. Polling cadence is conservative.
- Discourse APIs are public and unmetered.
- Etherscan-family APIs are an _optional_ enrichment path for ABI decoding (Section 3.8). Free tiers with registered API keys are used where available, but the system functions without them. The bundled ABI library and on-chain proxy resolution handle the hot path locally.
- LLM costs (Section 5) are the only meaningful variable cost. They are bounded separately by the AI worker budget cap.

The ingestion layer's monthly cost in steady-state, after backfill, is dominated by the cost of the VPS or service hosting it — typically under €15/month all-in for v1 scale.

### 3.13 What this section does not address

Deferred to later sections:

- Health and readiness endpoints, deployment topology, and process orchestration (Section 7 — non-functional requirements).
- Specific RPC provider selection (operational, set in deployment configs per environment, not in the spec).
- The format and lifecycle of the AI synthesis jobs that consume the data (Section 5).
- The maintenance cadence and process for the bundled selector index and bundled ABI library (operational concern; updates ship with releases).

Known concerns originating in this section are recorded in **Section 9 — Known concerns & v1.1 roadmap**. The relevant entries are:

- KNOWN-001 (pending event visibility deferred to v1.1)
- KNOWN-002 (Snapshot voting power trusted, not verified, in v1; verification in v1.1)
- KNOWN-004 (event archive not exposed via API in v1)
- KNOWN-005 (low-confidence forum-proposal inferred linking deferred)
- KNOWN-006 (Snapshot voting power on-chain block reorg gap)
- KNOWN-008 (reorg horizon defaults are conservative; tune post-launch)
- KNOWN-009 (forum content integrity is not verified)
- KNOWN-010 (block explorer ABIs are trusted when used as enrichment)

Open questions not yet resolved:

- Whether self-hosted RPC nodes are worth specific support beyond the existing configurable URL list. Current resolution: the configurable, prioritized URL list with fallback already covers self-hosted use cases by allowing operators to point Kvorum at any RPC endpoint, including their own. No additional architecture is needed.

---

_Section 3 ends here._

---

## 4. API specification

This section defines Kvorum's public API: the contract that external developers consume. The API is the product surface for one of Kvorum's three target user segments (researchers and developers) and the integration point for Kvorum's own dashboard. Decisions made here have long lifetimes — URL structures, identifier formats, and resource shapes are extremely costly to change after launch — so this section is deliberately opinionated and explicit.

### 4.1 Style and protocol

**REST over HTTPS, JSON-encoded.** Kvorum's API is a conventional REST API. Resources are nouns, verbs are HTTP methods, identifiers are URL path components. JSON is the request and response format for all endpoints. Content negotiation is supported (`Accept: application/json` is the default and only supported representation in v1).

**Why not GraphQL.** GraphQL is appealing for analytics — flexible queries, typed schema, frontend-friendly. It is also more operationally complex (N+1 protection, query complexity limits, query whitelisting for caching) and it imposes more on consumers (a GraphQL client, a learning curve). For v1's access patterns, REST is sufficient and broadly accessible: cURL examples are immediate, every HTTP client supports it, and consumers can integrate without adopting a query language. GraphQL is not closed off — it is recorded as KNOWN-011 (v1.1+ consideration if developer demand materializes).

**Versioning is path-based.** Every endpoint is rooted at `/v1/`. Version 2 will live at `/v2/` when needed. Header-based versioning (`Accept: application/vnd.kvorum.v2+json`) is rejected as harder to debug, harder to share, and harder to cache. Path versioning is the boring, correct choice for public APIs.

**No streaming protocol in v1.** v1 ships REST endpoints only. Real-time consumption is via short-interval polling against the same REST endpoints; the dashboard polls active proposal pages on a 10-second interval, which is sufficient given v1's confirmed-only visibility model (KNOWN-001 already introduces ~3 minute latency between an event occurring and being surfaced, dwarfing polling intervals). Real-time push protocols (WebSocket and SSE) are deferred to v1.1, where they pair naturally with the introduction of pending event visibility — the combination of sub-confirmation latency and push delivery is the use case where streaming materially outperforms polling. (See KNOWN-014.)

### 4.2 Identifiers

Resource identifiers in URLs and response payloads use stable, source-derived values. Internal UUIDs are never exposed.

**DAOs** are identified by slug: `compound`, `aave`, `lido`. Slugs are URL-safe, lowercase, and stable for the lifetime of the DAO.

**Proposals** are identified by the triple `(dao_slug, source_type, source_id)`. The URL pattern is `/v1/daos/{dao_slug}/proposals/{source_type}/{source_id}`. Examples:

```
/v1/daos/compound/proposals/compound_governor/42
/v1/daos/aave/proposals/aave_governor_v3/137
/v1/daos/lido/proposals/aragon_voting/89
/v1/daos/lido/proposals/snapshot/0xa3f8...91c
```

This identifier is stable, descriptive, and unambiguous: a reader of the URL knows the DAO, the governance system, and the native ID. Snapshot proposal IDs are hashes; they are used as-is.

**Actors** are identified by their primary address, lowercased: `/v1/actors/0xabc...123`. ENS names and other display attributes appear in payloads but are not used as URL identifiers (they are not stable; a reverse-resolution mismatch would break links).

**Votes** are identified relative to their proposal: `/v1/daos/{dao_slug}/proposals/{source_type}/{source_id}/votes/{voter_address}`. There is at most one vote per voter per proposal in v1 (vote changes overwrite the previous vote in the source system).

**Delegations** do not have stable resource URLs. They are accessed as event lists scoped to a DAO and optionally an actor: `/v1/daos/{dao_slug}/delegations?delegator={address}`.

### 4.3 Authentication and API keys

**All API requests require an API key.** Anonymous requests are rejected with `401 Unauthorized`. The token-gating model is documented in Section 1.6: free for any developer, but registration is required.

**Header format.** API keys are sent in the standard `Authorization: Bearer {key}` header. Custom header schemes (`X-API-Key`, etc.) are not supported. Bearer is the convention for HTTP token auth; cURL and every HTTP client support it natively.

**Key format.** API keys are opaque strings of the form `kv_live_<32 url-safe characters>`. The `kv_live_` prefix is mandatory and identifies the key's purpose; future tier or scope distinctions can use additional prefixes (`kv_test_`, `kv_pro_`) without breaking consumers. Keys are case-sensitive.

**Key lifecycle.**

- **Creation.** A developer signs up via the public dashboard (Sign-In With Ethereum or email). Each developer can create multiple keys for organizational use (e.g., one per environment). On creation, the full key is shown once; only a hash and the last 4 characters are stored server-side. There is no recovery path — a lost key is rotated.
- **Listing.** A developer can list their keys, seeing for each: the prefix and last 4 characters (e.g., `kv_live_...A3f8`), creation timestamp, last-used timestamp, current month's request count, and label.
- **Rotation.** A developer can issue a new key and revoke the old one. The dashboard supports atomic rotation with a configurable grace period (the old key remains valid for up to 24 hours after rotation).
- **Revocation.** A developer can immediately invalidate any key they own. Revoked keys take effect within seconds across the API fleet.

**Key storage.** Server-side, only a salted hash of each key is persisted. The plaintext key exists only in the response to the creation request and on the developer's machine. Comparison on each request is hash-and-compare.

**No SIWE for the API itself.** Sign-In With Ethereum is used for the developer dashboard (account management, key creation) but the API itself is purely token-authenticated. SIWE on every API request is impractical and unnecessary.

### 4.4 Rate limiting

**Tiers.** v1 ships with two tiers; the architecture supports more without breaking changes.

| Tier                 | Requests/minute | Requests/day  |
| -------------------- | --------------- | ------------- |
| Anonymous            | (not allowed)   | (not allowed) |
| Authenticated (free) | 60              | 10,000        |

The free tier is generous enough for development, exploratory use, and personal dashboards (including dashboard polling at 10-second intervals on multiple active views). It is not generous enough for a high-volume integration; that is intentional and creates the natural upgrade path to a future paid tier.

**Future tiers (forward-compatible, not v1).** A `Pro` tier with higher limits, webhooks, streaming connection allowance, and SLA is anticipated. The architecture supports this via a `tier` column on the API key; no breaking changes are required to add it.

**Rate limit headers.** Every API response includes IETF draft rate-limit headers:

```
RateLimit-Limit: 60
RateLimit-Remaining: 47
RateLimit-Reset: 35
```

`RateLimit-Reset` is in seconds until the window resets. When a request would exceed the limit, the response is `429 Too Many Requests` with a `Retry-After` header in seconds.

**Per-IP rate limiting on the developer dashboard.** API key creation and SIWE auth endpoints are rate-limited by IP independently of the per-key limits, to prevent enumeration and brute-forcing.

### 4.5 Pagination, filtering, and sorting

**Pagination is cursor-based.** Offset pagination is rejected as broken under inserts: a new item arriving between pages can cause an item to be skipped or duplicated. Cursors are opaque base64-encoded tokens that encode the position in the result set plus the parameters of the original request.

List responses include a `pagination` object:

```json
{
  "data": [ ... ],
  "pagination": {
    "limit": 50,
    "next_cursor": "eyJ0eXBlIjoidGltZSIsInZhbHVlIjoiMjAyNi0wNS0wMVQxMjowMDowMFoifQ==",
    "has_more": true
  }
}
```

The next page is fetched with `?cursor={next_cursor}`. The cursor encodes the original request's filter and sort parameters; passing a cursor with conflicting query parameters returns `400 Bad Request`. The cursor is opaque and clients should not parse it.

**Default and maximum page sizes.**

- Default `limit`: 50.
- Maximum `limit`: 200.
- Requests with `limit` exceeding the maximum are clamped to the maximum (no error).

**Filtering.** Filters are applied via query parameters, named after the field they filter. Multiple values for a single filter use comma-separated lists; multiple filters combine with AND.

```
/v1/daos/compound/proposals?state=active,queued
/v1/daos/aave/proposals?proposer=0xabc...123&state=executed
```

Filter parameters are documented per endpoint in the OpenAPI specification. Unknown filter parameters return `400 Bad Request` (strict parsing, no silent ignore).

**Sorting.** Sorting is via the `sort` parameter, accepting a comma-separated list of field names. Prefixing a field with `-` reverses the order:

```
/v1/daos/compound/proposals?sort=-voting_starts_at
```

Each endpoint documents its sortable fields. Sorting on non-indexed fields is rejected with `400 Bad Request` rather than allowed-but-slow.

### 4.6 Resource catalog

The v1 API exposes two categories of resources: entity and analytical. Streaming resources (WebSocket and SSE) are deferred to v1.1; see KNOWN-014.

#### 4.6.1 Entity resources

Direct read access to the domain model from Section 2. All entity resources are read-only in v1; there are no `POST`, `PUT`, `DELETE` operations on entity data.

**DAOs.**

- `GET /v1/daos` — list all DAOs Kvorum tracks
- `GET /v1/daos/{slug}` — fetch a single DAO with its source configurations
- `GET /v1/daos/{slug}/sources` — list the DAO's `dao_source` rows (Aragon + Snapshot + Dual Governance for Lido, etc.)

**Proposals.**

- `GET /v1/daos/{slug}/proposals` — list proposals for a DAO; filterable by `state`, `source_type`, `proposer`, `binding`, `voting_starts_at_min`, `voting_starts_at_max`. Sortable by `voting_starts_at`, `voting_ends_at`, `created_at`, `state_updated_at`.
- `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}` — fetch a single proposal with its actions, choices, and metadata.
- `GET /v1/proposals` — cross-DAO proposal list (the analytical view). Filterable by `dao` (multi-value), `state`, `binding`, time bounds.

**Votes.**

- `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}/votes` — list votes on a proposal; filterable by `voter`, `primary_choice`. Sortable by `cast_at`, `voting_power_reported`.
- `GET /v1/daos/{slug}/proposals/{source_type}/{source_id}/votes/{voter_address}` — fetch a single voter's vote on a proposal, including all choice components.

**Delegations.**

- `GET /v1/daos/{slug}/delegations` — list delegation events; filterable by `delegator`, `delegate`, time bounds. Returns the append-only event log, not the derived "current state."
- `GET /v1/daos/{slug}/delegates/{delegate_address}/current` — current delegators of a given delegate, derived from the delegation log.
- `GET /v1/daos/{slug}/actors/{address}/delegation` — current delegate of a given address.

**Actors.**

- `GET /v1/actors/{address}` — fetch an actor with their display name, bio, and known address mappings.
- `GET /v1/actors/{address}/votes` — votes cast by this actor across all DAOs (cross-DAO query).
- `GET /v1/actors/{address}/proposals` — proposals authored by this actor across all DAOs.

**Forum threads.**

- `GET /v1/daos/{slug}/forum-threads` — list forum threads for a DAO; filterable by `linked_to_proposal` (boolean).
- `GET /v1/daos/{slug}/forum-threads/{external_id}` — fetch a single forum thread with its summary and linked proposals.

#### 4.6.2 Analytical resources

Pre-computed analytical views. These are first-class API endpoints, not "compute on every request" — they are materialized on a schedule or on-demand and cached. The exact materialization strategy is an implementation detail; the API contract is what matters here.

**Concentration.**

- `GET /v1/daos/{slug}/analytics/concentration?bucket=daily&from=&to=` — voting power concentration over time. Returns the Gini coefficient, top-1 / top-5 / top-10 / top-20 voting power share, and effective number of delegates per time bucket.

**Delegation flow.**

- `GET /v1/daos/{slug}/analytics/delegation-flow?from=&to=` — the directed graph of delegation as it stood across the time window. Returns nodes (actors, with their voting power) and edges (delegations, with their weight and timestamps). For visualization in the dashboard's delegation flow view.

**Delegate alignment.**

- `GET /v1/daos/{slug}/analytics/delegate-alignment?delegate={address}` — the alignment matrix for a delegate against other delegates and against major blocs. Returns alignment scores (% of votes that match) for each comparison.

**Cross-DAO delegate behavior.**

- `GET /v1/actors/{address}/analytics/cross-dao` — for an actor active in multiple DAOs, summary of their participation, alignment, and voting power trajectory across DAOs.

**Proposal pass-rate analytics.**

- `GET /v1/daos/{slug}/analytics/proposal-pass-rate?proposal_type=&from=&to=` — historical pass rate by proposal type, time window, or other dimensions.

These analytical endpoints are versioned and documented like any other endpoint. New analytical views can be added without breaking changes; existing ones are stable within a major API version.

### 4.7 Response shapes

Response envelopes are consistent across all endpoints.

**Single resource:**

```json
{
  "data": { ... resource ... }
}
```

**List of resources:**

```json
{
  "data": [ ... ],
  "pagination": { "limit": 50, "next_cursor": "...", "has_more": true }
}
```

**Resource fields.** Every resource includes a stable identifier path, the entity's domain fields, and a `_meta` object with cross-cutting metadata:

```json
{
  "data": {
    "dao_slug": "compound",
    "source_type": "compound_governor",
    "source_id": "42",
    "title": "...",
    "description": "...",
    "state": "executed",
    "voting_starts_at": "2026-04-12T00:00:00Z",
    "voting_ends_at": "2026-04-19T00:00:00Z",
    "voting_power_block": 19854210,
    "binding": true,
    "proposer": {
      "address": "0xabc...123",
      "display_name": "delegate.eth"
    },
    "actions": [ ... ],
    "tally": { "for": "1234567...", "against": "234567...", "abstain": "0" },
    "_meta": {
      "confirmed": true,
      "last_updated_at": "2026-04-19T00:00:00Z",
      "links": {
        "self": "/v1/daos/compound/proposals/compound_governor/42",
        "votes": "/v1/daos/compound/proposals/compound_governor/42/votes",
        "forum": "/v1/daos/compound/forum-threads/12345"
      }
    }
  }
}
```

**Address fields are always lowercase strings.** Big numeric values (voting power, balances, wei amounts) are always strings to avoid JavaScript precision loss. Timestamps are always ISO 8601 with `Z` (UTC), to second precision.

**Embedded actor information.** Where an entity references an actor (`proposer`, `voter`, `delegate`), the response includes the canonical address plus the display name, but not the full actor profile. To fetch full actor details, follow the `/v1/actors/{address}` link.

### 4.8 Error model

Errors follow RFC 7807 (Problem Details for HTTP APIs).

**Content type.** Error responses are returned with `Content-Type: application/problem+json`.

**Standard fields.**

```json
{
  "type": "https://kvorum.example/errors/proposal-not-found",
  "title": "Proposal not found",
  "status": 404,
  "detail": "No proposal found for dao=compound, source_type=compound_governor, source_id=99999",
  "instance": "/v1/daos/compound/proposals/compound_governor/99999"
}
```

**Status code conventions.**

| Status | Meaning                                                                      | Example                                  |
| ------ | ---------------------------------------------------------------------------- | ---------------------------------------- |
| 400    | Bad request — invalid query parameters, malformed cursor, validation failure | Unknown filter parameter                 |
| 401    | Unauthorized — missing or invalid API key                                    | No `Authorization` header                |
| 403    | Forbidden — key valid but not authorized for the operation                   | (Reserved for future tier restrictions)  |
| 404    | Not found — resource does not exist                                          | Unknown proposal ID                      |
| 409    | Conflict — request conflicts with current state                              | (Reserved for future write endpoints)    |
| 422    | Unprocessable entity — semantically invalid request                          | Cursor with conflicting query parameters |
| 429    | Too many requests — rate limit exceeded                                      | Includes `Retry-After`                   |
| 500    | Internal server error — unexpected failure                                   | Generic; details suppressed              |
| 503    | Service unavailable — degraded mode (e.g., ingestion lagging severely)       | Includes `Retry-After`                   |

**Error type URIs.** The `type` field is a stable URI under `https://kvorum.example/errors/`. Each error type has documentation at that URI explaining the error and likely remediation. Type URIs are versioned; once published, they are not changed.

**Validation errors include details.** For 400/422 responses, the response includes a `violations` array:

```json
{
  "type": "https://kvorum.example/errors/validation",
  "title": "Validation failed",
  "status": 400,
  "violations": [
    { "field": "limit", "message": "must be between 1 and 200" },
    { "field": "sort", "message": "unknown sort field 'foo'" }
  ]
}
```

### 4.9 Caching and conditional requests

All entity GET endpoints support HTTP caching:

- `Cache-Control` headers indicate cacheability and TTL. Confirmed resources are cacheable for minutes to hours depending on the endpoint; analytical resources are cacheable for the duration of their materialization interval.
- `ETag` headers are returned for resources that support conditional requests.
- Clients sending `If-None-Match` with a matching ETag receive `304 Not Modified` with no body.

For dashboard polling and similar repeat-fetch patterns, ETag-based conditional requests are the recommended efficiency mechanism: a 10-second poll on an unchanged resource returns `304 Not Modified` with negligible bandwidth and server cost.

### 4.10 OpenAPI specification

A machine-readable OpenAPI 3.1 specification is generated from the NestJS controllers (using `@nestjs/swagger`). It is served at:

- `/v1/openapi.json` — the spec itself
- `/v1/docs` — interactive Swagger UI

The OpenAPI spec is the canonical source of truth for endpoint shapes. It is regenerated on every deployment and includes:

- Every endpoint with parameters, request bodies, and response schemas
- Type definitions for all response shapes
- Authentication scheme description
- Error response schemas
- Examples for non-trivial endpoints

The OpenAPI spec is committed to the repository (`docs/openapi.json`) on each release tag, providing a stable historical record of the API at each version.

### 4.11 What this section does not address

Deferred to later sections:

- The dashboard views that consume these endpoints (Section 6).
- Performance characteristics, caching infrastructure, and operational concerns (Section 7).
- Specific AI-feature endpoints (proposal summary retrieval, NL query interface) — surfaced in Section 5.

Known concerns originating in this section, recorded in the registry:

- KNOWN-011 (GraphQL endpoint deferred)
- KNOWN-012 (webhooks deferred)
- KNOWN-013 (bulk export endpoints deferred)
- KNOWN-014 (streaming protocols deferred to v1.1)

Open questions:

- Whether to expose the `actor_address` mapping table directly (e.g., `GET /v1/actors/{address}/aliases`) or only embed it in actor responses. Leaning toward embedding for v1; standalone endpoint can be added later if needed.
- Whether analytical endpoints accept arbitrary time windows or only pre-defined ones (`?bucket=daily|weekly|monthly`). Leaning toward arbitrary with a server-side maximum range cap (e.g., 5 years), with pre-defined bucket sizes only.
- Whether to support batch endpoints (`POST /v1/proposals/batch` with an array of identifiers) for fetching many resources in one request. Useful for dashboard performance but adds complexity. Deferred as a likely v1.1 enhancement if dashboard performance demands it.

---

_Section 4 ends here._

---

## 5. AI features specification

This section defines the AI-driven features in Kvorum v1: what they do, how they are built, how they are exposed, what they cost, and how they fail. Kvorum's positioning claims AI as "a feature, not a wrapper" — this section is where that claim is made operational.

The design priorities for AI features, in order: **provenance** (every AI output is traceable to its model, prompt, and input), **visibility** (the source content is always available alongside the output), and **bounded cost** (every feature has a per-month spending cap with hard enforcement).

### 5.1 The four v1 AI features

Kvorum v1 ships four AI-driven features. Each is described in its own subsection (5.5–5.8). Briefly:

1. **Proposal summarizer** (5.5) — produces a TL;DR plus structured action extraction for every binding proposal. Replaces the "skim the description" step for users.
2. **Calldata-vs-prose mismatch detector** (5.6) — compares decoded on-chain actions against the proposal's description, flags discrepancies. The flagship feature; differentiating capability.
3. **Forum thread synthesizer** (5.7) — pulls Discourse forum discussion for active proposals, produces "for / against / unresolved" synthesis.
4. **Proposal embedding and similarity search** (5.8) — embeds proposal descriptions into a vector space, supports "show me similar proposals" queries.

A natural-language query interface and additional features are deferred to v1.1+ (see KNOWN-015).

### 5.2 Trust posture

Every AI output Kvorum produces is treated as supplementary to the underlying source content, not a replacement for it. Three commitments:

**Provenance.** Every AI output includes structured metadata identifying:

- the model that produced it (e.g., `claude-haiku-4-5-20251001`)
- the prompt template version (`v1.2`)
- the input content hash (`sha256:abc...`)
- the timestamp of generation
- the cost in USD (rounded to four decimals)

This metadata is persisted alongside the output and exposed in API responses so consumers can reason about staleness, regenerate when needed, and reproduce any output.

**Visibility.** The source content from which an AI output was produced is always available through the API — the proposal's full description, the forum thread's raw posts, the decoded action calldata. AI output is presented in addition to source content, not as a replacement. The dashboard makes this discoverable: every AI-generated panel has a "view source" affordance.

**Labeling.** AI-generated content is consistently labeled in API responses (a `_meta.ai_generated: true` field) and in the dashboard (visual treatment that distinguishes AI output from indexed facts). Users do not have to wonder whether they are reading a summary or a quoted description.

This trust posture is non-negotiable. The AI features serve users; they do not displace the user's judgment.

### 5.3 Shared infrastructure

All AI features share a common infrastructure layer, implemented as a NestJS module (`libs/ai`).

**LLM client abstraction.** A typed client interface that hides provider details:

```typescript
interface LLMClient {
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}
```

The `CompletionRequest<T>` includes the prompt, the model, the schema (a Zod schema for structured output), and execution mode (`sync` | `batch`). The `CompletionResult<T>` includes the parsed-and-validated output of type `T`, the cost, and the provenance metadata.

The v1 implementation backs this onto Anthropic's API for completions and OpenAI's `text-embedding-3-small` for embeddings. The abstraction allows provider switching without changing feature code.

**Structured outputs with schema validation.** Free-form LLM output is rejected at design time. Every completion request specifies a Zod schema that the response must conform to. The implementation uses Anthropic's tool-use mechanism to constrain output structure, and validates the parsed result against the schema. Schema violations are treated as failures — the request is retried once, then the job is sent to the dead-letter queue for review. This eliminates "LLM returned malformed JSON and crashed the worker" as a failure class.

**Prompt templating.** Prompts are versioned templates stored in the `libs/ai/prompts/` directory, one file per template. A template includes:

```
---
name: proposal_summarizer
version: v1.0
model: claude-haiku-4-5-20251001
schema: ProposalSummarySchema
description: >
  Produces a TL;DR and structured extraction for a governance proposal.
---

You are an analyst summarizing a DAO governance proposal. The proposal is from {{dao_name}}.

<proposal_description>
{{description}}
</proposal_description>

<decoded_actions>
{{decoded_actions_json}}
</decoded_actions>

Produce:
1. A 2-3 sentence TL;DR of what this proposal does.
2. ...
```

Templates are version-controlled. When a template changes, the version bumps; new outputs reference the new version, old outputs remain associated with their original version. This keeps provenance intact across template revisions.

**Batch API usage.** Anthropic's Message Batches API processes async requests at 50% of synchronous cost. The `LLMClient` accepts `mode: 'batch'` requests, which are queued and processed in the next batch run (every 4 hours by default). Suitable for non-time-critical features (proposal summarization, historical forum synthesis). Time-critical features (mismatch detection on active proposals) use synchronous mode.

**Caching by content hash.** Every AI output is cached by the SHA-256 of its input content (proposal description, forum thread content, etc.). Cache hits are guaranteed to reflect the input that produced them — if the input changes, the hash changes, the cache misses, a new output is generated. This is a correctness property, not just a cost optimization: stale outputs are structurally impossible.

The cache is a Postgres table:

```
ai_output(
  id, feature_name, prompt_version, model, input_hash,
  output JSONB, cost_usd, generated_at,
  source_provenance JSONB
)
```

Lookup is by `(feature_name, prompt_version, input_hash)`. Outputs are immutable; regeneration produces a new row.

**Job queue.** AI work runs through BullMQ (on Redis), separated from the API and ingestion services as the `ai-worker` app. Jobs are typed by feature name and carry the input content hash plus the entity reference. Failed jobs retry with exponential backoff up to 3 attempts, then land in the dead-letter queue.

**Cost tracking.** Every completion and embedding call writes a row to `ai_cost_log(timestamp, feature_name, model, input_tokens, output_tokens, cost_usd, dao_id, entity_reference)`. This table powers per-feature, per-DAO, and per-time-window cost analysis. It also powers the budget cap.

**Hard budget cap.** Each feature has a configured monthly USD ceiling. A periodic job (every 5 minutes) computes cumulative spend per feature for the current calendar month from `ai_cost_log`. When a feature's spend exceeds 90% of its cap, an alert fires. When spend exceeds 100%, the feature is automatically disabled — new jobs of that feature are rejected at enqueue time, the worker stops processing them, and the dashboard surfaces a status banner. The cap resets monthly. Manual override (raising the cap) is a configuration change, deliberately requiring intent.

The default v1 caps:

| Feature             | Monthly cap (USD) | Rationale                                                           |
| ------------------- | ----------------- | ------------------------------------------------------------------- |
| Proposal summarizer | $5                | Low volume, batch-priced Haiku, content-hash cached                 |
| Mismatch detector   | $20               | Sonnet for quality, sync for active proposals, more expensive       |
| Forum synthesizer   | $15               | Discourse threads can be long (10k+ tokens); refresh cadence active |
| Embeddings          | $1                | text-embedding-3-small is cheap; one-time per content hash          |
| **Total**           | **$41/month**     | At full cap; typical spend will be ~30% of cap                      |

Caps are configured in environment variables and can be raised by the operator when needed. They are intentionally tight — the operator should know if the system is hitting them.

### 5.4 Output exposure in the API

AI outputs are exposed in two ways: embedded in entity responses and accessible via dedicated endpoints.

**Embedded in entity responses.** When a proposal has been summarized, the summary appears as a field on the proposal entity:

```json
{
  "data": {
    "dao_slug": "compound",
    "source_type": "compound_governor",
    "source_id": "42",
    "title": "...",
    "description": "...",
    "ai_summary": {
      "tldr": "Increase the reserve factor for cUSDC from 10% to 15%.",
      "proposal_type": "parameter_change",
      "affected_contracts": ["0xc3d688..."],
      "_meta": {
        "ai_generated": true,
        "model": "claude-haiku-4-5-20251001",
        "prompt_version": "v1.0",
        "input_hash": "sha256:abc...",
        "generated_at": "2026-04-12T08:30:00Z"
      }
    },
    "ai_mismatch_flag": null
  }
}
```

When a feature has not yet produced output for an entity (e.g., very new proposal not yet processed, or feature hit budget cap), the field is `null`. Clients handle null gracefully.

**Dedicated endpoints.** AI outputs also have direct URLs for fetching, regenerating, and querying:

- `GET /v1/daos/{slug}/proposals/{type}/{id}/ai/summary` — fetch the current summary, including full provenance.
- `GET /v1/daos/{slug}/proposals/{type}/{id}/ai/mismatch` — fetch the mismatch detector's full output (the embedded `ai_mismatch_flag` is a summary; this endpoint returns the structured analysis).
- `GET /v1/daos/{slug}/proposals/{type}/{id}/similar` — invoke similarity search; returns ranked similar proposals.
- `GET /v1/daos/{slug}/forum-threads/{external_id}/ai/synthesis` — fetch the forum thread synthesis.

Regeneration (forcing a new run) is not exposed in v1's public API. It is available as an internal admin operation. v1.1 may expose it as an authenticated endpoint with rate limits.

### 5.5 Proposal summarizer

**Purpose.** Produce a concise summary and structured extraction for every binding proposal, replacing the "skim a 5,000-word description" step for users.

**Trigger.** A proposal entering the `pending` or `active` state, with `binding = true`, enqueues a summarization job. Snapshot non-binding signaling proposals are summarized too, with a separate prompt template tuned for signaling content.

**Input.** The proposal's `description` (full markdown) plus the decoded `proposal_action` rows (when available; the summarizer runs even when actions are not yet decoded, but quality is higher when they are).

**Output schema.**

```typescript
const ProposalSummarySchema = z.object({
  tldr: z.string().max(400),
  proposal_type: z.enum([
    'parameter_change',
    'treasury_allocation',
    'contract_upgrade',
    'protocol_addition',
    'protocol_deprecation',
    'governance_change',
    'signaling',
    'other',
  ]),
  proposal_type_confidence: z.enum(['high', 'medium', 'low']),
  affected_contracts: z.array(z.string()),
  key_changes: z
    .array(
      z.object({
        description: z.string(),
        significance: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(5),
  beneficiaries: z.array(z.string()).optional(),
  funding_amount_usd: z.string().nullable(),
  notable_concerns: z.array(z.string()).optional(),
});
```

**Model.** `claude-haiku-4-5-20251001`. The task is summarization, not deep reasoning; Haiku is sufficient and substantially cheaper.

**Mode.** Batch. Summaries are not time-critical — proposals are visible in the API and dashboard the moment they're indexed; the summary appears within the next batch cycle (≤4 hours). For very urgent proposals (those entering `active` state with imminent voting deadlines), a synchronous fallback path is used.

**Caching.** By `sha256(description + decoded_actions_json)`. If the description changes (rare but possible for some governance systems), a new summary is generated; the old one remains associated with its original input hash.

**Estimated cost per proposal.** Roughly 8,000 input tokens × 500 output tokens × Haiku batch pricing. ≈$0.005 per summary. At ~50–100 new proposals/month across the v1 DAOs, ≤$0.50/month — well under the $5 cap.

### 5.6 Calldata-vs-prose mismatch detector

This is the flagship feature. It is the strongest argument for the AI investment in Kvorum and the most likely feature to be cited in a launch post or quoted in coverage.

**Purpose.** Detect cases where a proposal's prose description does not match the actual on-chain actions in its calldata. This catches honest mistakes (rate of 5% in description, 50% in calldata — a typo with serious consequences), confused proposers (description references the wrong contract), and in the worst case, malicious proposals trying to slip past delegates who skim descriptions.

**Trigger.** A proposal with `binding = true` whose `proposal_action` rows have all been successfully decoded (i.e., `decoded_function` populated). The detector requires decoded calldata to function; partially-decoded proposals are queued and re-evaluated when decoding completes. Snapshot proposals are not subject to this detector (no on-chain calldata).

**Input.** The proposal's `description`, the full set of `proposal_action` rows with decoded values, and metadata about the target contracts (token symbols where applicable, role names from AccessControl ABIs, etc.).

**Output schema.**

```typescript
const MismatchAnalysisSchema = z.object({
  overall_assessment: z.enum([
    'consistent',
    'minor_discrepancy',
    'material_discrepancy',
    'severe_discrepancy',
  ]),
  confidence: z.enum(['high', 'medium', 'low']),
  description_actions: z.array(
    z.object({
      claim: z.string(),
      location: z.string(), // brief reference to where in the description
    }),
  ),
  calldata_actions: z.array(
    z.object({
      action_index: z.number(),
      summary: z.string(),
      significance: z.enum(['high', 'medium', 'low']),
    }),
  ),
  discrepancies: z.array(
    z.object({
      type: z.enum([
        'value_mismatch',
        'omitted_in_description',
        'extra_in_description',
        'misleading_phrasing',
        'target_mismatch',
      ]),
      description: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      description_excerpt: z.string().nullable(),
      related_action_indices: z.array(z.number()),
    }),
  ),
  reasoning: z.string().max(2000),
});
```

The output is intentionally rich. Operators (the primary user segment) need to _understand_ the analysis, not just see a flag. The `reasoning` field is the model's explanation — it is shown to users in the dashboard, with the model name and prompt version visible.

**Distinguishing real mismatches from cosmetic differences.** The prompt is engineered to ignore:

- Routine emissions (e.g., a fee transfer that the description doesn't mention because it's standard for this contract type)
- Reformatting (the description says "5%", the calldata uses 5e16; these match)
- Legitimate omissions (the description focuses on the strategic change; the calldata includes routine state-machine updates)

And to flag:

- Numeric discrepancies (description says "5%", calldata sets 50%)
- Target discrepancies (description says "the cUSDC market", calldata targets cWBTC)
- Material omissions (description doesn't mention a transfer to a new address)
- Misleading phrasing (description characterizes a parameter change in language that doesn't match its actual direction)

This requires real prompt engineering work. The prompt is iterated against a corpus of historical proposals (some genuinely consistent, some with known discrepancies) until the false-positive rate is below 5% and the false-negative rate on the seeded discrepancies is acceptable. This is acceptance-test work for the feature.

**Model.** `claude-sonnet-4-6` for v1. Mismatch detection is deeper reasoning than summarization; Sonnet has consistently produced significantly better analyses than Haiku in this kind of task. Opus would be better still but is overkill at the cost. The model used is part of the output's provenance, so future migrations are auditable.

**Mode.** Synchronous for proposals in `active` state (operators want to see this fast); batch for historical backfill.

**Caching.** By `sha256(description + concat(decoded_actions))`. Backed by the same `ai_output` table.

**Estimated cost per proposal.** Roughly 12,000 input tokens × 1,500 output tokens × Sonnet pricing. ≈$0.05 per analysis. Synchronous mode does not benefit from batch pricing. At ~50–100 binding proposals/month, ≈$5–10/month — comfortably within the $20 cap.

**Failure modes and their handling.**

- **Decoded calldata unavailable.** Detector waits; entity returns `ai_mismatch_flag: null` until decoding completes.
- **Model produces low-confidence output.** Output is still stored (with `confidence: low`) and exposed in the API, but the dashboard does not surface a flag — the user can view the analysis if they navigate to the detailed page.
- **Schema validation fails.** Job retries once; on second failure, lands in DLQ. Operator notified.
- **Budget cap hit.** New mismatch jobs rejected; existing outputs remain in cache and continue to serve API requests. Status banner appears in dashboard.

**Surfacing.** When `overall_assessment` is `material_discrepancy` or `severe_discrepancy`, the proposal entity carries an `ai_mismatch_flag` field with a brief summary; the dashboard displays a prominent visual indicator. For `consistent` and `minor_discrepancy`, the flag is `null` (information available via the dedicated endpoint). The threshold is conservative: only flag what genuinely deserves attention.

### 5.7 Forum thread synthesizer

**Purpose.** Pull Discourse forum discussion for proposals and produce a structured synthesis: "main arguments for, main arguments against, unresolved concerns, notable participants." Replaces the "scroll through 200 forum posts" step.

**Trigger.** A `forum_thread` row that is linked (via `proposal_forum_link` with `confidence` of `high` or `medium`) to a proposal in `pending` or `active` state. The synthesis is refreshed periodically as the thread accumulates posts (every 6 hours during the active voting window; once on close).

**Input.** The thread's `raw_content` (concatenated post bodies), the linked proposal's `title`, and the DAO context.

**Output schema.**

```typescript
const ForumSynthesisSchema = z.object({
  arguments_for: z
    .array(
      z.object({
        summary: z.string(),
        supporting_participants: z.array(z.string()).max(5),
      }),
    )
    .max(7),
  arguments_against: z
    .array(
      z.object({
        summary: z.string(),
        supporting_participants: z.array(z.string()).max(5),
      }),
    )
    .max(7),
  unresolved_concerns: z
    .array(
      z.object({
        summary: z.string(),
        raised_by: z.array(z.string()).max(3),
      }),
    )
    .max(5),
  notable_participants: z
    .array(
      z.object({
        handle: z.string(),
        role_summary: z.string(),
      }),
    )
    .max(10),
  sentiment: z.enum(['favorable', 'mixed', 'unfavorable', 'contentious']),
  thread_health: z.enum(['constructive', 'mixed', 'unproductive']),
});
```

**Model.** `claude-haiku-4-5-20251001` for short threads (under 30,000 tokens of content); `claude-sonnet-4-6` for long contentious threads where nuance matters. The decision is automatic based on token count and a coarse heuristic for contentiousness (sentiment polarity in the first 5,000 tokens). The model used is part of the provenance.

**Mode.** Batch by default. Synchronous when an operator explicitly requests refresh via the dashboard.

**Caching.** By `sha256(raw_content)`. When new posts arrive in a thread, the hash changes, and a new synthesis is generated. Old syntheses remain in cache associated with their input hash; the API exposes only the most recent.

**Estimated cost per synthesis.** Roughly 15,000 input tokens × 1,000 output tokens. Haiku batch: ≈$0.005. Sonnet sync (rare): ≈$0.06. At ~30 active threads × 4 refreshes during voting + 100 historical threads/month, ≈$2–4/month within the $15 cap.

**Failure modes.**

- **Thread not yet linked to a proposal.** Synthesis is not generated; thread is processed only when linked.
- **Thread content is non-English.** v1 ships English-only synthesis. Non-English threads are not synthesized; the field is `null` with a `_meta.skipped_reason: "non_english"` indicator. Multi-language support is deferred (KNOWN-016).
- **Forum API failures during ingestion.** Synthesis runs on whatever content is available at synthesis time; the next refresh picks up missed content.

### 5.8 Proposal embedding and similarity search

**Purpose.** Enable "show me similar past proposals" queries — for any given proposal, find historically similar proposals across all DAOs. Useful for proposers researching prior art and for analysts contextualizing a current proposal.

**Trigger.** A proposal entering any state above `pending` (so a proposal that is canceled before voting still gets embedded; useful for the historical record) enqueues an embedding job.

**Input.** A composed text consisting of the proposal's `title` (if available), `description`, and a one-line summary of decoded actions. The composition is deterministic and versioned along with the prompt template.

**Output.** A 1,536-dimensional vector (the OpenAI `text-embedding-3-small` output) stored in the `proposal_embedding` table:

```
proposal_embedding(
  proposal_id, embedding_version, input_hash,
  embedding vector(1536), generated_at, cost_usd
)
```

Indexed via `pgvector` with `ivfflat` for cosine similarity queries.

**Similarity search.** When a user requests "similar to proposal X," Kvorum:

1. Looks up X's embedding.
2. Runs a cosine similarity query against the rest of the corpus, optionally filtered by DAO, time range, or proposal type.
3. Returns the top N results ranked by similarity score, alongside basic proposal metadata.

The default scope is "across all DAOs" — this is the cross-DAO analytical capability the API claims; it materializes here.

**Model.** `text-embedding-3-small` (OpenAI). Anthropic does not offer an embedding model as of v1; the LLM client abstraction has a separate `embed()` method that backs onto OpenAI specifically. Should Anthropic offer one in the future, migration is contained to the client implementation.

**Caching.** By input hash. Re-embedding a proposal whose composed input has not changed is a cache hit (no API call).

**Estimated cost.** ~$0.02 per million tokens × ~5,000 tokens per proposal = ~$0.0001 per proposal. Embedding the entire historical corpus across the three DAOs (~1,500 proposals) is a one-time cost of ~$0.15. Ongoing: trivially under the $1 cap.

**Failure modes.**

- **OpenAI API unavailable.** Job retries with backoff; persistent failure lands in DLQ. The feature degrades gracefully — proposal entity returns no `similar` link, dashboard hides the panel.

### 5.9 What this section does not address

Deferred to later sections:

- The dashboard surfaces that consume AI outputs (Section 6).
- Operational concerns: AI worker scaling, queue backlog handling, cost-attribution dashboards (Section 7).

Known concerns originating in this section, recorded in the registry:

- KNOWN-015 (natural-language query interface deferred)
- KNOWN-016 (multi-language synthesis deferred)
- KNOWN-017 (AI feature regeneration not exposed in v1 API)

Open questions:

- Whether the mismatch detector should run on Snapshot proposals despite the absence of on-chain calldata. There is still value in checking whether the description matches what the proposal _purports_ to do (a self-consistency check). Probably worthwhile but adds prompt engineering work; deferred to v1.1+ unless an early signal supports prioritization.
- Whether to expose AI provenance metadata (model, prompt version) in the dashboard UI directly or only on demand. Disclosing it openly is more honest; hiding it is cleaner UX. Leaning toward disclosure with a small, unobtrusive treatment.
- Whether the embedding composition (what text gets embedded) should evolve over the lifetime of the project. If yes, embedding versioning needs more careful handling (re-embedding the historical corpus on every composition change is real cost). Leaning toward a stable composition for v1, change-controlled via ADR if revised.

---

_Section 5 ends here._

---

## 6. Dashboard specification

This section specifies Kvorum's user-facing dashboard: the pages, the components, the cross-cutting design principles, and the behavior commitments. The dashboard is one of two product surfaces (the other being the API); it is the surface that most users will encounter first and the one that carries Kvorum's identity.

This section is the _specification_ for the dashboard, not the design itself. The visual design is captured in a parallel Figma file referenced in the spec lifecycle. The spec defines what each page is for, what data it shows, what interactions it supports, and what behaviors it commits to. Pixel-level layout, color values, typography choices, and animation specifics belong to the Figma file and may evolve without spec changes.

### 6.1 Design principles

Five principles guide every dashboard decision. They override one-off design choices when they conflict.

**Legibility over comprehensiveness.** A user reading any page should immediately understand what they are looking at, what is happening, and what to do next. If a view requires a legend, three caveats, or a footnote to interpret correctly, it is failing. This principle implies dropping data we cannot present clearly, even when it is technically available.

**Source visibility.** Every assertion the dashboard makes is traceable to its source. Every AI-generated summary is one click from the original content. Every analytical metric is one click from the underlying entities that compose it. Every voting power figure shows its `voting_power_block`. This is the operational form of Kvorum's trust posture.

**Operator-first when in tension.** When a design choice trades operator clarity for casual-browser polish, operators win. Concretely: dense data displays are preferred over breathing-room layouts on dashboards; technical accuracy is preferred over simplification; cross-references between governance tracks (Lido especially) are preserved rather than collapsed.

**Honest about uncertainty.** When data is preliminary, the dashboard says so. When AI output has low confidence, the dashboard says so. When a discrepancy is detected, the dashboard does not present it as a fact but as an analysis. The visual treatment for these states is consistent across pages.

**No dark patterns, no engagement maximization.** Kvorum does not optimize for time-on-site, return visits, or any metric that conflicts with a user getting their answer and leaving. There are no email-capture popups, no notification-permission prompts, no content drips. Users come for governance answers; the dashboard helps them find answers and gets out of the way.

### 6.2 Information architecture

The dashboard has fifteen distinct page types, organized into five navigational regions.

**Region: cross-DAO views** (entry points)

- **Homepage** (6.4) — `/` — curated cross-DAO activity feed with prominent navigation
- **All proposals** (6.5) — `/proposals` — filterable proposals across all DAOs
- **Cross-DAO actor page** (6.10) — `/actors/{address}` — actor profile across all DAOs

**Region: per-DAO views** (the core navigation tree)

- **DAO landing** (6.6) — `/daos/{slug}` — overview of one DAO, links to deeper views
- **DAO health dashboard** (6.7) — `/daos/{slug}/health` — operator-grade analytics
- **DAO proposals list** (6.8) — `/daos/{slug}/proposals` — filterable proposals for one DAO
- **Proposal detail** (6.9) — `/daos/{slug}/proposals/{type}/{id}` — full view of a single proposal
- **Delegate scorecard** (6.11) — `/daos/{slug}/delegates/{address}` — delegate analytics for one DAO

**Region: forum context**

- **Forum thread** (6.12) — `/daos/{slug}/forum/{external_id}` — synthesized thread view

**Region: developer surface** (only authenticated section)

- **Developer dashboard** (6.13) — `/developer` — API keys, usage metrics, documentation links
- **Authentication pages** (6.14) — `/login`, `/signup`, `/forgot-password`, `/reset-password`

**Region: error and edge-case pages** (system surfaces)

- **Error pages** (6.15) — 404, 500, 503, planned-maintenance pages

**Plus** static documentation pages (about, API docs, status, methodology) — these are not specified here in detail; they are described in Section 6.21 as out of scope.

The primary navigation, present on every page, exposes: Home, Proposals, DAOs (dropdown listing the three v1 DAOs), Developer (link to the developer dashboard), API Docs (external link). DAO-level pages also surface a secondary navigation within the DAO context: Overview, Health, Proposals, Delegates.

### 6.3 Cross-page components

Components used across multiple pages, specified at the conceptual level. Pixel-level rendering lives in the Figma file.

**Mismatch indicator.** A visual treatment applied to any proposal where the calldata-vs-prose mismatch detector has flagged a `material_discrepancy` or `severe_discrepancy`. The indicator includes:

- A clear visual marker (color and icon)
- A short label: "Discrepancy detected"
- A tooltip on hover summarizing the type of discrepancy
- A link/click target that navigates to the full mismatch analysis

`Minor_discrepancy` and `consistent` outcomes do not surface the indicator on list views. They are visible only on the proposal detail page. The threshold is conservative because false positives damage trust more than false negatives miss opportunity.

**Confirmation indicator.** A subtle visual treatment that distinguishes confirmed from pending data. In v1, all data shown on the dashboard is confirmed (KNOWN-001), so the indicator is not visible by default. The treatment is reserved for v1.1 when pending visibility ships.

**AI output panel.** A standardized container for AI-generated content. Every AI panel includes:

- A clear label indicating AI generation ("Summary by Kvorum" with a small AI icon)
- The output content
- A "View source" affordance linking to the original content
- A small disclosure of provenance (model name, generation time) accessible on click but not visually heavy

This component is reused across the proposal detail page (summary, mismatch analysis), the forum thread page (synthesis), and elsewhere. Its consistent treatment is what implements the trust posture (Section 5.2) at the UI layer.

**Voting power figure.** Whenever a numeric voting power is displayed (in tallies, scorecards, delegation views), the display includes:

- The number, formatted with appropriate units (M, B for millions/billions)
- The reference block (e.g., "as of block 19854210")
- For hover/click: the underlying actor's full voting power composition (delegated-in, self-delegated, total)

**Delegate identity.** Wherever a delegate or voter is referenced, the display shows:

- The display name (ENS preferred, delegate-platform name fallback, address shortened as last resort)
- The address (always available, copyable)
- A link to the delegate scorecard within the current DAO context

**Time freshness indicator.** A small "last updated N seconds ago" indicator visible on pages with polled data. Absence of this indicator signals static data (loaded on navigation, not polling).

**Empty state, loading state, error state.** Three standardized treatments applied consistently across pages. Empty states include guidance ("No proposals match these filters; try widening your search"). Loading states use a skeleton pattern, not spinners. Error states surface the error in user terms with a retry affordance.

### 6.4 Homepage

**Path:** `/`
**Primary user:** First-time visitor (any segment); returning user looking for "what's happening now"

**Purpose.** Provide an entry point that both surfaces immediate value and orients users to Kvorum's structure. The homepage answers "what is Kvorum?" implicitly through what it shows, not explicitly through marketing copy.

**Key sections, top to bottom:**

1. **Brief tagline + cross-DAO quick stats.** "Governance intelligence for DeFi DAOs." Below: live counters — N proposals tracked across N DAOs, N votes recorded, N forum threads synthesized. Plain numbers, no charts.

2. **Active proposals across all DAOs.** A horizontally-scrollable card list of proposals currently in `active` state, sorted by voting end time ascending (closest deadlines first). Each card shows: DAO badge, title, source type, voting close time, current tally bar, mismatch indicator if applicable, AI-generated TL;DR.

3. **Recent mismatch flags.** A separate, prominent section listing proposals that have been flagged by the mismatch detector. Shows: proposal title, DAO, severity, brief excerpt of the discrepancy. This section establishes Kvorum's flagship feature visually.

4. **DAO health snapshot.** Three cards (one per v1 DAO) showing key health indicators: proposal pass rate over the last 90 days, voting power concentration (top-10 share), participation rate. Click-through to the full DAO health dashboard.

5. **Recent activity feed.** Chronological list of the last 30 governance events across all DAOs: proposals created, votes passing thresholds, executions, notable delegations. A "news ticker" of governance.

**Interactions:**

- Clicking any proposal card → proposal detail page
- Clicking any DAO badge or DAO card → DAO landing page
- Clicking a mismatch flag → proposal detail page, scrolled to the mismatch analysis section

**Polling:** Sections 2 and 5 (active proposals, activity feed) poll every 30 seconds. Sections 1, 3, and 4 are static on page load.

**Empty state:** Should not occur for the v1 DAOs (always at least some recent activity). If somehow empty, show a brief explanation and link to the all-proposals page with no filters.

### 6.5 All proposals (cross-DAO)

**Path:** `/proposals`
**Primary user:** Researcher, journalist, delegate browsing across DAOs

**Purpose.** A single filterable, sortable view of every proposal across every DAO Kvorum tracks. The cross-DAO analytical capability made browseable.

**Layout:** A list view with persistent filter sidebar.

**Filters:**

- DAO (multi-select)
- State (multi-select; defaults to "active" + "succeeded" + "executed")
- Source type (multi-select)
- Binding / signaling toggle
- Date range (proposal created)
- Has mismatch flag (toggle)
- Has linked forum thread (toggle)

**Sort options:** Voting close time, voting start time, creation date, vote count, voting power participating. Default sort: voting close time descending (most recent activity first).

**Each row shows:** DAO badge, proposal title (truncated to two lines), source type, state, voting close time (relative: "ends in 3 days" or "ended 2 weeks ago"), tally summary (small horizontal bar), mismatch indicator if applicable.

**Pagination:** Infinite scroll using the cursor-based API pagination. 50 items per page; subsequent pages load on scroll.

**URL state:** All filters and sort options are encoded in the URL query string. Sharing a URL shares the filtered view exactly.

### 6.6 DAO landing page

**Path:** `/daos/{slug}`
**Primary user:** Anyone exploring a specific DAO

**Purpose.** Orient users to a DAO's governance: what it is, what's happening now, where to go for deeper views.

**Key sections:**

1. **DAO header.** Name, logo, brief description, primary token, governance summary (short prose).
2. **Active proposals.** Grid of currently-active proposals for this DAO, with full cards (similar to homepage but DAO-scoped).
3. **Recent activity.** Chronological feed of recent governance events for this DAO.
4. **Health snapshot.** Mini version of the DAO health dashboard's headline metrics, with click-through to the full dashboard.
5. **Top delegates.** Five delegates by current voting power, with click-through to their scorecards.
6. **Governance tracks.** For DAOs with multiple `dao_source` rows (Lido), an explicit panel showing the parallel tracks. See Section 6.17.

**Navigation aid:** Secondary navigation persistent at the top: Overview (current page), Health, Proposals, Delegates.

### 6.7 DAO health dashboard

**Path:** `/daos/{slug}/health`
**Primary user:** Protocol/DAO operator (the primary user segment)

**Purpose.** The operator's instrument panel. A single view that answers: how is this DAO's governance behaving, and what should I be paying attention to?

**Key sections:**

1. **Concentration.** A time-series chart of voting power concentration over the last 12 months. Shows: Gini coefficient line and a stacked area chart of top-1, top-5, top-10, top-20 voting power share. Below the chart: current values plus 90-day delta. Hover surfaces precise values per point. Time range selector (90 days / 1 year / all time).

2. **Delegation flow.** A directed graph visualization of delegation relationships, showing the top 50 delegate-delegator pairs by voting power. Nodes are sized by voting power; edges by delegated amount. Time scrubber: see how delegation has evolved over the past year.

3. **Participation trends.** A time-series chart showing, per proposal: number of unique voters, total voting power participating, percentage of theoretical maximum participation. Highlights anomalous proposals (unusually low or high participation).

4. **Proposal pipeline.** A visual breakdown of recent proposals by type, outcome, and time-to-execution. Shows pass rate by proposal type over the last 12 months.

5. **Flag summary.** All recent mismatch flags for this DAO, with severity and a brief excerpt. Empty state ("No discrepancies detected in the last 90 days") is itself a useful signal.

6. **Anomaly indicators.** A section reserved for cross-cutting concerns: sudden delegation spikes, voting-power concentration changes, abnormal proposal velocity. v1 implements simple statistical thresholds (KNOWN-018: full anomaly detection deferred to v1.1).

**Polling:** None. Health metrics are computed analytically (Section 4.6.2 endpoints) on the server with materialization intervals appropriate to the metric (concentration recomputed daily; flags recomputed hourly). Page loads fresh on navigation.

**Operator-specific framing:** The page header includes "Stewarding {DAO name}? This view is built for you." with a brief explanation of how to read the metrics. No login required to see this — it is a public page that happens to be designed for a specific use case.

### 6.8 DAO proposals list

**Path:** `/daos/{slug}/proposals`
**Primary user:** Anyone reviewing this DAO's proposals

**Purpose.** The DAO-scoped equivalent of the cross-DAO proposals list (6.5). Same component, narrower scope, additional DAO-specific filters where relevant.

**Differences from cross-DAO list:**

- DAO filter is fixed (the URL specifies the DAO)
- For DAOs with multiple sources, an additional source filter ("show me only Snapshot proposals," "show me only Aragon votes")
- Default sort emphasizes the DAO's recent activity

### 6.9 Proposal detail page

**Path:** `/daos/{slug}/proposals/{source_type}/{source_id}`
**Primary user:** Anyone wanting a complete picture of a single proposal

**Purpose.** The deep view. Every piece of information Kvorum has about a proposal, organized for clarity. This is the page most likely to be linked from external sources, embedded, and screenshotted.

**Layout:** Single-column with anchored sub-navigation. The sub-navigation lists: Summary, Description, Actions, Tally, Voters, Forum, Similar.

**Section: Header.** DAO badge, proposal title, source type, source ID, state with timestamp, prominent mismatch indicator if applicable, "view on {source}" link (e.g., link to Tally for Compound proposals, Snapshot for Snapshot proposals).

**Section: Summary (AI-generated).** The AI summary panel (per Section 6.3). TL;DR plus structured fields (proposal type, affected contracts, key changes, beneficiaries, funding amount). Provenance disclosed on demand.

**Section: Description.** The full proposal description, rendered as markdown. Scrollable. This is the source of truth; the summary is supplementary.

**Section: Mismatch analysis (AI-generated).** Only present when the detector has produced output, regardless of severity. For `consistent` proposals: a brief "No discrepancies detected" treatment. For `material` and `severe`: prominent display with the full structured analysis (description claims, calldata actions, specific discrepancies with severity, the model's reasoning). For `minor`: collapsed by default with a clear expansion affordance. Provenance always disclosed.

**Section: Actions.** The decoded `proposal_action` rows. Each action shows: target address (with display name where known), function called, decoded arguments in human-readable form, raw calldata available on demand. For cross-chain payloads (Aave), grouped by destination chain.

**Section: Tally.** Current vote tally as a horizontal bar chart with For/Against/Abstain (or the proposal-specific choices). Below: numeric values, percentage of voting power participating, percentage of theoretical maximum, quorum status. For active proposals, polls every 10 seconds and displays the freshness indicator.

**Section: Voters.** Sortable, filterable table of votes cast. Columns: voter (display name + address), choice (with color coding), voting power, percentage of total, vote rationale (when provided), vote time. Default sort: voting power descending. Filter by choice. Pagination: 50 votes per page, more on demand.

**Section: Forum.** When a forum thread is linked (high or medium confidence), shows the AI synthesis (per Section 6.3) plus a link to the full forum thread page. When no thread is linked: brief explanation, no synthesis shown.

**Section: Similar proposals.** A list of up to 10 historically similar proposals (from the embedding similarity search), across all DAOs, with similarity scores. Each item shows: DAO badge, title, outcome, time. Clicking navigates to that proposal's detail page.

**Polling:** The Tally section polls every 10 seconds while the proposal is in `active` state. All other sections are static on page load.

### 6.10 Cross-DAO actor page

**Path:** `/actors/{address}`
**Primary user:** Researcher analyzing an actor's behavior across DAOs; delegate looking at peers

**Purpose.** Show an actor's complete governance footprint across every DAO Kvorum tracks. The "this person is active in three DAOs — what do they do everywhere?" view.

**Key sections:**

1. **Identity header.** Display name, address, ENS, links to Twitter/forum profiles where known, a brief auto-generated bio summarizing their activity ("Active delegate in Compound and Aave; participated in 47 proposals across 2 years").

2. **Cross-DAO summary table.** One row per DAO this actor participates in. Columns: DAO, current voting power, all-time votes cast, participation rate, link to delegate scorecard within that DAO.

3. **Cross-DAO alignment.** When the actor is a delegate in multiple DAOs, an alignment heatmap showing how their voting patterns compare across DAOs (do they vote pro-treasury everywhere? Pro-decentralization everywhere?).

4. **Recent activity.** Chronological feed of their votes and delegations across all DAOs.

5. **Authored proposals.** When the actor is a proposer, the list of proposals they've authored across all DAOs.

### 6.11 Delegate scorecard

**Path:** `/daos/{slug}/delegates/{address}`
**Primary user:** Delegate (self-review or peer-review); token holder selecting a delegate

**Purpose.** Comprehensive view of a single delegate within a single DAO.

**Key sections:**

1. **Header.** Delegate display name, address, current voting power for this DAO, voting power trajectory sparkline (last 12 months), participation rate, link to cross-DAO actor page.

2. **Voting power trajectory.** Time-series chart showing the delegate's voting power over time, with annotations for delegation events that materially changed it.

3. **Participation.** A calendar-grid visualization of every proposal this DAO has had, with each cell showing: did this delegate vote, and if so, which choice. Visual at-a-glance: are they reliable, are they a fair-weather voter, do they abstain a lot.

4. **Alignment.** A heatmap showing this delegate's voting alignment with other significant delegates in this DAO, computed from the analytical endpoint (Section 4.6.2). Hover reveals the specific shared/divergent votes.

5. **Vote history.** Table of every vote this delegate has cast, with choice, rationale (when provided), proposal title (linkable), and proposal outcome. Sortable, filterable, paginated.

6. **Notable divergences.** When the delegate has voted against the majority outcome, those votes are highlighted in their own subsection — these are the votes that say the most about the delegate's stance.

### 6.12 Forum thread page

**Path:** `/daos/{slug}/forum/{external_id}`
**Primary user:** Anyone wanting to understand discussion around a proposal

**Purpose.** Show a single forum thread with its synthesis, and link back to the proposal it discusses.

**Key sections:**

1. **Header.** Thread title, source URL (link to the original Discourse instance), number of posts, last activity time, linked proposals (with confidence indicator).

2. **Synthesis (AI-generated).** Full forum synthesis output: arguments for, arguments against, unresolved concerns, notable participants, sentiment indicator. Provenance disclosed.

3. **Raw thread.** The full thread content rendered as posts in chronological order. This is the source content; users who want to verify the synthesis can read here.

### 6.13 Developer dashboard

**Path:** `/developer`
**Primary user:** Developer using the Kvorum API
**Authentication:** Required (Sign-In With Ethereum or email)

**Purpose.** API key management and usage visibility. The only authenticated section of the dashboard.

**Key sections:**

1. **API keys.** List of the developer's keys (showing prefix and last 4 characters per Section 4.3), creation date, last-used date, current month's request count, label. Actions: create new key, rotate, revoke.

2. **Usage.** Charts of request volume over the last 30 days, broken down by endpoint family. Current month's quota status with a progress bar.

3. **Rate limit status.** Current rate limit consumption (per-minute and per-day) with reset times.

4. **Quick links.** API documentation, OpenAPI spec download, status page, support contact.

### 6.14 Authentication pages

**Paths:** `/login`, `/signup`, `/forgot-password`, `/reset-password?token={token}`
**Primary user:** Developer wanting to access the developer dashboard

**Purpose.** Gateway to the only authenticated section of Kvorum (the developer dashboard at 6.13). The main dashboard is fully browseable without authentication; these pages exist solely to support API key management.

**Authentication methods, in order of preference:**

1. **Sign-In With Ethereum (SIWE).** The primary method, expected to be used by the majority of Kvorum's audience. The login page presents a "Connect wallet" affordance; the user signs an EIP-4361 message; on success a session is established. Address-based identity, no password to forget.

2. **Email and password.** A secondary method for users without an active Ethereum wallet (some governance researchers, journalists). Standard email/password registration with email verification. Password requirements: minimum 12 characters, no maximum, no character-class requirements, checked against breach corpora at registration.

Social login (Google, GitHub, etc.) is not supported. The reasoning: it adds third-party dependencies, introduces privacy concerns about data sharing with social platforms, and is not aligned with the Web3-native character of Kvorum's audience. SIWE serves the same convenience function for the primary audience without these costs.

**Login page (`/login`):**

- Two prominent options: "Connect wallet" (SIWE) and "Continue with email"
- Email path: email + password fields, "Forgot password?" link, "Don't have an account? Sign up" link
- After successful auth: redirect to `/developer` (or to the original requested URL if the user was redirected to login)
- Failed login: clear error, no information leakage about whether the email exists
- Rate limited per IP (Section 4.4)

**Signup page (`/signup`):**

- SIWE path: connect wallet → optional email for recovery and notifications → done
- Email path: email + password + password confirmation → email verification link sent → on click, account is activated
- Email verification is required for the email path (prevents fake-email signups). SIWE path does not require email verification (the wallet is the identity).
- Rate limited per IP

**Forgot password (`/forgot-password`):**

- Single email input
- On submit: if the email matches an account, a reset token is generated and a reset link is sent. Same response either way (no information leakage about whether the email exists)
- Reset tokens are single-use, expire after 24 hours, are invalidated on use
- Using a reset token invalidates all existing sessions for that account (forces re-login)
- SIWE accounts cannot use this flow — they have no password to reset. The page detects when the email belongs to a SIWE-only account and shows a clear message ("This account uses Sign-In With Ethereum; sign in with your wallet")

**Reset password (`/reset-password?token=...`):**

- Validates the token; if invalid or expired, redirects to `/forgot-password` with an error message
- New password + confirmation
- On submit: password is updated, all sessions invalidated, user is logged in to a fresh session, redirected to `/developer`

**Sessions.** Server-side session storage in Redis. Session cookies are HttpOnly, Secure, SameSite=Strict. Default session lifetime is 30 days; sessions extend on activity. The developer dashboard exposes a "Sign out everywhere" affordance.

**Account deletion.** Available from within the developer dashboard, not from the auth pages. Deletion is permanent and immediate; API keys are revoked, the account is removed, the email (if any) is hashed for re-registration prevention. (KNOWN-020 records this is implemented but not extensively tested in v1.)

### 6.15 Error and edge-case pages

System pages handling abnormal conditions. These deserve real care: they are the pages users see when something goes wrong, and the difference between a confusing dead-end and a graceful redirect determines whether a user trusts the product.

**404 — Page not found.**

Path: any unmatched URL.

The 404 page is not generic. It detects what the user was likely trying to reach and provides specific guidance:

- URL pattern matches `/daos/{unknown_slug}` → "Kvorum tracks Compound, Aave, and Lido. The DAO `{slug}` is not currently tracked." Plus a link to the homepage.
- URL pattern matches `/daos/{known_slug}/proposals/{unknown_id}` → "This proposal doesn't exist in Kvorum's index of {DAO}. It may not be from a governance source we track." Plus a link to the DAO's proposal list.
- URL pattern matches `/actors/{address}` for an address with no recorded activity → "Kvorum has no governance activity recorded for this address." Plus a link to search.
- Truly unmatched URLs → generic "Page not found" with primary navigation.

In all cases, the page returns HTTP 404 (not a soft-redirect to the homepage). The status code matters for SEO, link-checking tools, and developer expectations.

**500 — Server error.**

Path: any URL when the server encounters an unhandled exception.

A user-friendly error page that:

- Says clearly that something went wrong on Kvorum's side
- Includes a unique error reference (UUID) the user can include if reporting the problem
- Does not expose stack traces, internal paths, or any debugging information
- Does not auto-redirect (the user may want to come back to this URL)

The error reference is logged server-side with full context for debugging.

**503 — Service degraded.**

Path: any URL when Kvorum is operating in a degraded state. Triggered when ingestion is severely lagging, or when the database is read-only for maintenance.

Distinct from 500 because users _should_ see this — silently serving stale data without telling them is a violation of the trust posture (Section 6.1). The 503 page:

- Explains specifically what is degraded ("Vote ingestion is currently lagging by N minutes" or "Kvorum is in read-only mode for scheduled maintenance")
- Returns HTTP 503 with a `Retry-After` header
- Links to the status page for current operational state
- Does not block read operations against historical data; the badge is shown on affected views, but pages still load

**Maintenance page.**

Path: any URL during planned downtime windows.

Activated by an operator-controlled flag. Shows the scheduled end time of the maintenance and a link to the status page. Returns HTTP 503 with `Retry-After`.

**Common treatment.** All error pages share the dashboard's primary navigation (so users can navigate away to a working page) and a search/help affordance. They use the same visual language as the rest of the dashboard, scaled down — error pages should not feel like a different application.

### 6.16 Real-time behavior

The dashboard's real-time behavior is constrained by v1's polling-based approach (KNOWN-014).

**Pages with polling:** Homepage active proposals section (30s), homepage activity feed (30s), proposal detail tally section while active (10s).

**Pages without polling:** Everything else. Pages refresh on user navigation.

**Polling implementation principles:**

- All polled requests use `If-None-Match` with the prior response's ETag, returning `304 Not Modified` when nothing has changed. Polling cost is minimal in steady state.
- Polled responses update in place without animations or transitions (animations imply real-time push and would feel uncanny on a 10-second cadence).
- The "last updated N seconds ago" indicator is visible on polled sections, communicating freshness honestly.
- When polling fails (network error, server error), the indicator transitions to "last updated N minutes ago — retrying" rather than disappearing. The user's view is never silently stale.

When v1.1 introduces streaming protocols (KNOWN-014) and pending visibility (KNOWN-001), the polling implementation transitions to streaming with minimal UI changes — the freshness indicator becomes "live" rather than a timestamp.

### 6.17 Lido dual-track treatment

This subsection addresses KNOWN-007 directly: Lido's hybrid governance system has implications for how voting power is shown.

Lido has three governance sources: Aragon Voting (binding LDO-holder votes), Snapshot (`lido-snapshot.eth` for signaling, primarily but not exclusively LDO-weighted), and Dual Governance (stETH-holder veto power on the Aragon timelock). These are not interchangeable. "Voting power in Lido" means different things in each context.

The dashboard does not collapse this complexity. The Lido DAO landing page (6.6) prominently surfaces the three tracks with brief explanations. The Lido health dashboard (6.7) displays metrics per track where they are meaningfully different (concentration is computed separately for LDO and for stETH; participation is computed per proposal). Cross-references between tracks are surfaced where they exist (a Snapshot signaling vote that precedes an Aragon binding vote is linked).

The proposal detail page (6.9) for any Lido proposal makes the source explicit in the header — `Source: aragon_voting` or `Source: snapshot` — and the tally section uses the appropriate voting power semantics for that source. There is no unified "Lido voting power" figure presented anywhere in the dashboard, because no such figure exists.

For users who find this confusing: the design philosophy is that legibility serves users better than false simplicity. A Lido operator already knows the system has multiple tracks; collapsing them would make the dashboard wrong.

### 6.18 AI output presentation

This subsection elaborates on the trust posture commitments in Section 5.2 as they manifest in the dashboard.

**Visual differentiation.** AI-generated panels use a consistent visual treatment that distinguishes them from indexed-fact panels. The treatment is restrained — a subtle border, a small icon, a single-line label "Summary by Kvorum" or similar — not heavy-handed. The goal is clarity, not theatrical disclaimer.

**Provenance disclosure.** Every AI panel has a small provenance affordance (icon plus "Generated by Kvorum" label) that, on click, reveals the model name, prompt template version, generation time, and a link to the input content. This is intentionally low-friction for the curious and out of the way for the casual reader.

**Confidence treatment.** When AI outputs include confidence levels (the mismatch detector explicitly does), the dashboard surfaces them honestly:

- High-confidence outputs are presented at full visual weight
- Medium-confidence outputs include a small "medium confidence" tag
- Low-confidence outputs are not surfaced on summary views (homepage, list views) at all; they are visible on the detail page with a clear "low confidence" indicator and a recommendation to review the source content directly

**Regeneration affordance.** Not present in v1. The output the user sees is the most recent cached output for that input. Future versions may add a "regenerate" button (KNOWN-017).

**Failure states.** When an AI output is unavailable (job not yet complete, budget cap hit, model failure), the panel displays a clear empty state explaining why. Pretending the AI feature doesn't exist would be dishonest; showing an error without context would be confusing.

### 6.19 Accessibility and responsiveness

**Accessibility commitments for v1:**

- Semantic HTML throughout. Lists are `<ul>`, navigation is `<nav>`, buttons are `<button>`.
- All interactive elements are keyboard-accessible. Focus states are visible.
- Color is never the sole carrier of information. Mismatch indicators include both color and an icon. Vote tally bars include numeric labels.
- Charts include accessible alternatives: every chart has an associated table view accessible via a "View as table" affordance.
- Text contrast meets WCAG AA against background; primary text exceeds AAA where feasible.
- All images and icons have meaningful `alt` attributes; decorative imagery has `alt=""`.

**Responsiveness:** The dashboard is responsive down to mobile widths. The mobile experience prioritizes the proposal detail page (the most-shared link) and the homepage feed; the DAO health dashboard and delegation flow visualization are explicitly desktop-first (KNOWN-019: refined mobile treatment for analytical pages deferred to v1.1).

The minimum supported viewport for full functionality is 1280×720 desktop; below that, the experience is preserved for navigation and reading but charts and dense tables degrade gracefully (toggle to summary cards, horizontal scroll where unavoidable).

### 6.20 Admin tooling

Kvorum's admin surface is intentionally minimal in v1. There is no custom web-based backoffice. Operational tasks are split between two tools, each chosen for fit:

- **User management and operational commands → a CLI (`kvorum-admin`).** Configuration changes, backfill triggers, actor merges, DLQ resolution, AI feature controls, key administration, account banning. Authenticated by SSH/host access.
- **Monitoring and observability → Grafana + Prometheus.** Standard, industrial-strength tooling consuming the metrics Kvorum already emits (Section 3.12). Dashboards for ingestion lag, AI cost, reorg activity, API request volume, error rates, queue depth.

The reasoning: building a custom backoffice is a substantial engineering effort that displaces work on the actual product. Off-the-shelf monitoring is mature and free; SSH-authenticated CLI is the lowest-overhead path for the rare operational tasks. v1 has one operator (the developer); the additional ceremony of a web admin UI is not justified.

#### 6.20.1 CLI surface (`kvorum-admin`)

A single binary, run on the host or in a container with access to Kvorum's database and Redis. Authenticated by SSH access — there is no separate auth layer because access to the CLI implies access to the underlying infrastructure.

The command surface is organized by domain:

```
kvorum-admin dao add <slug> --name <name> --token <address> --chain <id>
kvorum-admin dao source add <dao_slug> --type <type> --config <json>
kvorum-admin dao source update <dao_source_id> --config <json>

kvorum-admin backfill start <dao_source_id> [--from-block N] [--to-block N]
kvorum-admin backfill status <dao_source_id>
kvorum-admin backfill cancel <dao_source_id>

kvorum-admin derive replay <dao_source_id> [--from-block N]
kvorum-admin derive verify <proposal_external_id>

kvorum-admin actor merge <primary_actor_id> <secondary_actor_id>
kvorum-admin actor address add <actor_id> <address> --source <source>

kvorum-admin dlq list [--feature <name>] [--limit N]
kvorum-admin dlq retry <dlq_id>
kvorum-admin dlq accept <dlq_id> --reason <reason>

kvorum-admin ai disable <feature>
kvorum-admin ai enable <feature>
kvorum-admin ai cap set <feature> <usd>
kvorum-admin ai regenerate <feature> <entity_reference>

kvorum-admin user list [--filter <expr>]
kvorum-admin user ban <user_id> --reason <reason>
kvorum-admin user delete <user_id>

kvorum-admin keys list [--user <id>]
kvorum-admin keys revoke <key_id>
kvorum-admin keys ban-ip <ip>

kvorum-admin reorg list [--chain <id>] [--since <iso>]

kvorum-admin status
kvorum-admin maintenance enable --until <iso> --message <text>
kvorum-admin maintenance disable
```

**Output discipline.** Every command supports `--format json` for scripting and defaults to a human-readable table format for interactive use. Errors return non-zero exit codes with structured stderr output.

**Audit log.** Every command run is recorded to an `admin_audit` table with: command, arguments, executing user (from SSH/sudo context), timestamp, outcome, error details if any. The audit log is immutable; entries cannot be deleted. The CLI itself includes a `kvorum-admin audit list` command for review.

**Safety affordances.**

- Destructive commands (`actor merge`, `dao source delete`, `derive replay`, `user delete`) require an explicit `--confirm` flag
- Production environments require an additional `--production` flag for destructive commands
- A `--dry-run` flag is supported on all mutating commands; it shows what would happen without making changes
- The CLI refuses to run if the database is in a known-inconsistent state (e.g., during an active backfill)

**Documentation.** The CLI's commands are documented in `docs/admin/` within the repository. Each command has a manual page accessible via `kvorum-admin help <command>` describing arguments, environment requirements, and example invocations.

#### 6.20.2 Monitoring stack (Grafana + Prometheus)

Operational visibility is provided by standard tooling consuming the metrics and logs that Kvorum's services already emit (Section 3.12 specifies Prometheus-format metrics, structured logging, and OpenTelemetry tracing).

**Components:**

- **Prometheus** scrapes Kvorum's services for metrics. Retention configured for 90 days at the deployment level.
- **Grafana** provides dashboards on top of Prometheus. Authentication via the deployment's existing SSO or basic-auth; not exposed to the public internet.
- **Loki** (or equivalent) ingests Kvorum's structured logs, queryable from Grafana alongside metrics.
- **Alertmanager** (Prometheus's companion) handles alerting rules and routing.

The specific stack is a deployment choice — the spec commits to _the shape_ (a Prometheus-compatible monitoring stack), not to specific vendors. Operators using Kvorum can substitute Datadog, Honeycomb, or similar without spec changes; Kvorum's metrics emission is the contract.

**Dashboards committed to ship in v1:**

1. **Ingestion health** — head-block age per source, pending event count, DLQ size, RPC error rate per provider, reorg event count over time. Highlights any source falling behind.
2. **AI cost and feature health** — daily and monthly spend per feature with cap utilization, queue depth per AI feature, success/failure rate, p95 generation latency.
3. **API health** — request volume by endpoint, p50/p95/p99 latency, error rate by status code, rate-limit-hit rate per API key tier.
4. **System health** — host CPU, memory, disk; Postgres connection count, query latency, replication lag if applicable; Redis memory; ClickHouse query throughput.

These dashboards are committed to the repository as Grafana JSON exports under `infra/grafana-dashboards/`. They are version-controlled like any other code.

**Alerting rules committed to ship in v1:**

- Ingestion lag exceeding 5 minutes for any source for more than 10 minutes (severity: warning)
- DLQ size exceeding 100 (severity: warning)
- DLQ size exceeding 1000 (severity: critical)
- AI feature monthly cap exceeding 90% (severity: warning) and 100% (severity: critical, feature is auto-disabled per Section 5.3)
- API error rate exceeding 5% sustained for 5 minutes (severity: warning)
- Database query p95 latency exceeding 1 second sustained for 10 minutes (severity: warning)
- Reorg event of depth greater than the configured horizon (severity: critical, indicates the horizon needs revisiting per KNOWN-008)

Routing of alerts (PagerDuty, Slack, email) is a deployment configuration; the rules themselves are repo-controlled.

#### 6.20.3 No custom web admin UI in v1

A custom web admin UI is not part of v1 scope. The two-tool approach (CLI + Grafana) is sufficient for the v1 operational profile: a single operator handling rare manual tasks via CLI and observing system health via standard dashboards.

A future web admin UI may be considered if specific operational pain emerges that neither tool addresses well — for example, DLQ inspection and resolution workflows that benefit from graphical presentation, or approval gates for destructive operations involving a second operator. v1.1 does not commit to building one; it remains an open option contingent on real demand. (See KNOWN-021.)

### 6.21 What this section does not address

Out of scope for the spec:

- Pixel-level layouts, color values, exact typography, animations and micro-interactions, and component implementation details — captured in the Figma design file and React component library.
- Static documentation pages (about, methodology explanations, FAQ) — necessary but not subject to detailed spec; they ship as standard markdown-driven pages.
- Marketing-site material (landing pages, case studies, tutorials) — separate concern from the dashboard product surface.
- The status page (operational health for the Kvorum service) — referenced in the developer dashboard but specified in Section 7 (non-functional requirements).

Known concerns originating in this section, recorded in the registry:

- KNOWN-018 (full governance anomaly detection deferred)
- KNOWN-019 (mobile treatment for analytical pages deferred)
- KNOWN-020 (account deletion implemented but not extensively tested in v1)
- KNOWN-021 (custom web admin UI deferred indefinitely; CLI + Grafana stack ships in v1)

Open questions:

- Whether the homepage's mismatch flag section should be prominent when no flags exist (showing "no discrepancies detected" as a positive signal) or hidden (cleaner). Leaning toward visible — empty-state honesty is part of the trust posture.
- Whether to show "trending" or "engagement-weighted" sort options anywhere, or rigorously avoid them. Trending sorts can be gamed and are inconsistent with the no-engagement-maximization principle. Leaning toward not having them in v1; revisit only if user research strongly supports the demand.
- Whether the homepage's auto-generated DAO health snapshot should default to a metric that is positive (suggests a healthy DAO) or one that is most informative (which may be unflattering for some DAOs). Leaning toward most-informative, with no editorial bias toward DAOs.
- Whether email-based signup should support email change post-registration. Leaning toward not in v1 (email is the recovery channel, changing it requires verification of both addresses, scope creep). Available via account deletion + re-registration.

---

_Section 6 ends here._

---

## 7. Non-functional requirements

This section specifies what Kvorum is committed to delivering operationally: performance, availability, observability, security, cost. The numbers in this section are deliberately defensible against the resources at hand — a single-developer project with modest infrastructure — rather than aspirational. Targets that cannot be met with current capacity are not committed.

The design priorities for non-functional requirements, in order: **honest commitments** (every target must be achievable with v1's resources), **graceful degradation** (when something goes wrong, the system fails into a useful state, not silently into a broken one), and **operational sustainability** (the system must be runnable by one person without becoming a second job).

### 7.1 Service inventory and deployment topology

Kvorum v1 deploys six service classes plus three supporting infrastructure components. All run on a single Hetzner CX32 (or equivalent ~4 vCPU, 8 GB RAM) host via Docker Compose.

**Kvorum services:**

- **`api`** — NestJS application serving the public REST API. One process, configurable replica count (default 1 for v1).
- **`dashboard`** — Next.js application serving the user-facing dashboard. SSR-enabled, runs as a container alongside the API.
- **`indexer`** — NestJS worker running EVM source ingesters, Snapshot polling, and forum crawling. One process per `dao_source`, multiplexed within a single container.
- **`ai-worker`** — NestJS worker running the AI feature pipeline (summarization, mismatch detection, forum synthesis, embeddings). Consumes from BullMQ.
- **`derivation`** — NestJS worker running the projection from event archive to core entities. Listens for confirmed events; runs the snapshot job for voting power; runs ABI decoding.
- **`scheduler`** — NestJS process running cron-based jobs: confirmation promotion sweep (every 30 seconds), forum crawl (every 30 minutes), backup triggers (daily), maintenance cleanups.

**Supporting infrastructure:**

- **Postgres 16** — primary data store. All entities, archive, AI cache. Single instance with daily backups (Section 7.5).
- **Redis 7** — job queues (BullMQ), rate limit state, ephemeral session storage.
- **ClickHouse** — analytical mirror. Single instance.

**Monitoring stack (Section 6.20.2):**

- **Prometheus** — metrics scraping, 90-day retention.
- **Grafana** — dashboards and alerting UI.
- **Loki** — log aggregation.
- **Alertmanager** — alert routing.

All services and infrastructure run in a single Docker Compose project. Networking is bridge-mode internal, with only the dashboard, API, and Grafana exposed via reverse proxy (Caddy) on the public interface. TLS is terminated at the reverse proxy.

The choice of single-host deployment is deliberate. v1's scale (Section 7.7) does not justify multi-host complexity; multi-host adds operational surface (orchestration, networking, secret distribution, host health monitoring) that is not earned by the load. The deployment is structured to _lift and shift_ to multi-host orchestration (Kubernetes, Nomad) when the load demands it, without rewriting service code: services are stateless except where state is delegated to Postgres/Redis/ClickHouse, configuration is via environment variables, and inter-service communication is over the network.

**Deployment artifact.** A versioned `docker-compose.production.yml` in the repository, with environment-specific overrides via `.env` files (gitignored). Image tags are pinned to specific git SHAs; no `latest` tags in production.

### 7.2 Performance targets

Targets apply to the steady state of v1 operation, not to the period during initial backfill or active maintenance.

**API response latency:**

- Read endpoints (entity GETs, list queries with filters): p50 < 100ms, p95 < 500ms, p99 < 1500ms
- Analytical endpoints (concentration, delegation flow, etc.): p50 < 300ms, p95 < 1500ms, p99 < 5000ms
- Write endpoints (developer dashboard operations): not subject to specific targets in v1; expected to be infrequent and bounded

These targets assume warm caches and indexed queries. Cold-start queries against rarely-accessed historical data may exceed these; the API marks such responses with a `Cache-Control: no-cache` and accepts the latency cost.

**Dashboard load times:**

- Time to first contentful paint: < 1.5s on a typical broadband connection
- Time to interactive: < 3s
- Polled tally updates apply within 200ms of receiving the response

Pages that depend on AI output (proposal detail's summary section) may show a "summary not yet available" state without blocking the rest of the page.

**Ingestion lag (Section 3.12):**

- Steady-state lag between source event occurring and event appearing as confirmed in Kvorum: bounded by the configured reorg horizon plus < 60 seconds of processing latency
- Concretely for Ethereum mainnet: ~3 minutes total (12 confirmations × ~12s plus processing)
- Backfill throughput: > 1000 events per minute per source on the configured RPC tier

**AI generation latency:**

- Synchronous mismatch detection on active proposals: p95 < 30 seconds from job enqueue to result available
- Batch summarization: result available within 4 hours of proposal entering active state (the next batch cycle)
- Forum synthesis: result available within 6 hours of thread linking (the configured refresh cadence)

**ETag-driven polling:**

- 304 Not Modified responses for unchanged resources: < 50ms p95

Targets are validated by automated load tests run as part of CI for the steady-state cases. Cold-start and degraded-mode latencies are not bounded by automated testing in v1.

### 7.3 Availability and degraded modes

**Uptime target.** v1 commits to **99% monthly availability** for the API and dashboard, measured as 5-minute polling success from an external monitoring point. 99% is approximately 7 hours of downtime per month. This is honest for a single-operator project; promising more would commit Kvorum to coverage that one person cannot sustain.

The target excludes:

- Scheduled maintenance windows announced > 24 hours in advance via the status page
- Incidents caused by upstream dependencies the operator cannot mitigate (RPC provider outages affecting all redundant providers, Snapshot API outages, forum API outages)
- Force majeure events affecting the host provider

**Degraded modes.** Kvorum's failure modes are designed so that partial failures degrade the user experience rather than producing a hard outage:

- **One RPC provider down:** automatic failover to the next-priority provider. No user-visible impact. Alert fires (Section 7.4).
- **All RPC providers for a chain down:** ingestion stalls for that chain; existing data continues to serve from Postgres. Status banner appears. Severe alert fires.
- **Snapshot API down:** Snapshot proposals stop updating; existing proposals continue to serve. Status banner. Alert fires.
- **Forum API down:** Forum data stops refreshing; AI synthesis runs against last-known content. Low-priority alert.
- **AI worker failing:** AI features show "summary not yet available" or "synthesis pending"; entity data continues to serve. Cap-related auto-disables are clearly labeled in the UI. Alert fires.
- **ClickHouse down:** analytical endpoints return 503 with `Retry-After`; entity endpoints continue to serve from Postgres. Status banner on dashboard's analytical pages. Severe alert fires.
- **Postgres down:** API returns 503 across the board. Dashboard shows the 503 page (Section 6.15). Critical alert; all-hands recovery.
- **Redis down:** rate limiting falls open (request rejection on connection failure rather than silent allow), API key validation continues against Postgres. Background jobs queue in memory until Redis recovers. Severe alert.

The degraded-mode behavior is part of the trust posture: users are told what is wrong rather than seeing inexplicably stale or missing data.

### 7.4 Observability

The observability contract is specified in Section 3.12 (operational concerns) and Section 6.20.2 (monitoring stack). This subsection ties them together.

**Metrics (Prometheus format, scraped by Prometheus, displayed in Grafana):**

Each Kvorum service exposes a `/metrics` endpoint with structured Prometheus metrics. The metrics surface is part of the deployment contract — adding or renaming metrics is a breaking change for downstream dashboards and alerts.

**Committed metric families for v1:**

- `kvorum_ingestion_*` — head block age, pending event count, archive write rate, reorg event count
- `kvorum_derivation_*` — projection lag, snapshot job duration, ABI decode success rate
- `kvorum_ai_*` — generation latency, cache hit rate, cost (USD), feature enabled status
- `kvorum_api_*` — request count, latency histogram, error rate by status code
- `kvorum_rate_limit_*` — request count by tier, rejected request count
- `kvorum_dlq_*` — entry count by stage and source
- `kvorum_db_*` — query latency, connection pool usage

A complete enumeration of metric names with their labels is committed to the repository (`docs/metrics.md`) and treated as a stable contract within a major version.

**Logs (structured JSON, ingested by Loki):**

All Kvorum services log to stdout in structured JSON. Required fields: `timestamp`, `level`, `service`, `request_id` (where applicable), `message`. Optional fields: `dao_id`, `proposal_external_id`, `actor_id`, `error`, custom feature-specific fields.

Log retention: 30 days at the Loki layer. Longer-term retention (audit logs, security events) is preserved separately in Postgres tables and not subject to Loki's retention policy.

**Traces (OpenTelemetry, optional):**

Distributed tracing via OpenTelemetry is supported but not required to be enabled in v1. When enabled, traces flow to Tempo or an equivalent OTLP-compatible backend. The trace context is propagated across service boundaries via standard W3C Trace Context headers.

**Alerts:**

The seven alerting rules committed in Section 6.20.2 are the v1 baseline. Routing (PagerDuty, Slack, email) is deployment-configured. Alert fatigue is actively managed: rules with high false-positive rates are tuned or removed, not ignored.

### 7.5 Backup and disaster recovery

**Backup strategy:**

- **Postgres:** Daily logical backups via `pg_dump --format=custom`, taken at 02:00 UTC, written to S3-compatible storage off-host (Hetzner Object Storage or Backblaze B2). Continuous WAL archiving via `wal-g` for point-in-time recovery to within 1 hour. Backups retained for 30 days (daily) and 12 months (monthly snapshots of the first daily backup of each month).
- **ClickHouse:** Daily snapshots of analytical tables, written to the same off-host storage. Retention: 14 days. Loss of ClickHouse beyond the snapshot is recoverable by replaying from Postgres (the source of truth); the snapshots only reduce recovery time.
- **Redis:** Not backed up. Job queues, rate limit state, and sessions are ephemeral by design. A Redis loss requires re-running active jobs (recoverable from the source events in Postgres) and forces logged-in users to re-authenticate.
- **Configuration:** All deployment configuration is in the git repository. The host's `.env` files are _not_ in the repository, but their contents are documented in a runbook stored in a secure location (not the repository).

**Recovery objectives:**

- **Recovery Point Objective (RPO):** ≤ 1 hour. With WAL archiving, point-in-time recovery to within 1 hour of any incident is supported. Daily logical backups provide a reliable fallback if WAL replay fails.
- **Recovery Time Objective (RTO):** ≤ 4 hours from a fresh host. The recovery procedure is: provision a new host, run the deployment scripts, restore Postgres from the latest logical backup, replay WAL to the desired point, restart services. The procedure is documented as a runbook and exercised at least once per quarter.

**Disaster recovery testing:**

A quarterly DR drill restores backups to a separate environment, verifies data integrity (sample queries against known data), and confirms the procedure works as documented. Drill outcomes are logged in `docs/dr-drills.md`. Failed drills trigger immediate fixes; the runbook is updated with each iteration.

### 7.6 Security

**TLS:** All public-facing traffic is TLS 1.3 with strong cipher suites. TLS termination at the Caddy reverse proxy. Certificates issued and renewed automatically via Let's Encrypt.

**Secrets management:**

- Secrets (database credentials, API keys for upstream services, signing keys) are provided to services via environment variables, sourced from `.env` files on the host with restrictive permissions (mode 0600, owned by the deployment user).
- No secrets are committed to the git repository at any time. Pre-commit hooks scan for accidental secret commits using `gitleaks` or equivalent. CI fails on any detected secret.
- Secret rotation is documented: how to rotate database passwords, API keys, signing keys, with downtime expectations.

**Dependency hygiene:**

- Dependabot (or Renovate) automatically opens PRs for dependency updates. Security updates are merged within 7 days of release; non-security updates within 30 days.
- CI runs `npm audit` (or equivalent) on every PR. High-severity advisories fail the build.
- Container base images are pinned to specific digests, not tags. Base images are rebuilt monthly to pick up upstream security patches.

**Authentication and session security:**

- Developer dashboard sessions use HttpOnly, Secure, SameSite=Strict cookies (Section 6.14).
- API keys are stored as salted hashes (Section 4.3); the plaintext key is shown to the user once and never persisted.
- Failed login attempts are rate-limited per IP (Section 4.4).
- Password storage uses bcrypt with cost factor 12 (or argon2id where the platform supports it).

**Input validation:**

- All API inputs are validated against Zod schemas at the controller boundary; invalid inputs return 400 (Section 4.8).
- SQL queries use parameterized statements throughout (Prisma's default). No raw query interpolation.
- Output is contextually escaped (React's default for the dashboard, JSON serialization for the API). HTML rendered from external content (proposal descriptions, forum posts) is sanitized via a strict allowlist.

**What v1 does not commit to:**

- SOC 2 or other compliance audits
- Third-party penetration testing
- Bug bounty program
- 24/7 security on-call

These are appropriate for a funded organization; they are not appropriate commitments for a single-developer v1. (KNOWN-022.)

### 7.7 Capacity planning and scaling path

**v1 expected scale:**

- ~3,000 indexed proposals across all v1 DAOs (cumulative)
- ~300,000 indexed votes (cumulative)
- ~100,000 indexed delegation events (cumulative)
- ~50–100 new proposals per month
- ~5,000–15,000 new vote events per month
- ~100,000 API requests per day in steady state
- ~500 concurrent dashboard sessions at peak
- ~10–20 active developer accounts (post-launch growth)

**Bottlenecks and mitigation:**

- **Postgres write throughput during backfill** — mitigated by chunking (Section 3.10) and bounded by the RPC tier
- **ClickHouse query throughput** — irrelevant at v1 scale; acceptable single-instance capacity is orders of magnitude greater than the workload
- **AI worker throughput** — bounded by per-feature budget caps (Section 5.3), which are themselves the cost ceiling
- **RPC provider rate limits** — mitigated by multi-provider failover (Section 3.11) with circuit breakers
- **Memory pressure on the indexer** — bounded by chunked processing; no full-history-in-memory operations

**Scaling path beyond v1:**

The deployment is structured so that horizontal scaling is achievable without rewriting service code. The progression:

1. **v1 (now):** Single host, Docker Compose, all services co-located. Comfortable up to ~10x the v1 expected scale.
2. **v1.x growth (if needed):** Move Postgres to a dedicated host or managed service (Neon, Supabase). Move Redis to a managed service (Upstash). Kvorum services remain on the application host.
3. **v2 horizontal (if and when):** Migrate the application services to a container orchestrator (Kubernetes, Nomad, Fly.io) with multiple replicas. Add Redis Streams for cross-instance coordination of WebSocket subscriptions and BullMQ.

The migration from v1 to v1.x is straightforward: connection strings change, Compose service definitions are removed for the moved components. The migration to v2 is more involved but non-blocking — v1 ships without it.

### 7.8 Cost ceiling and budget enforcement

**Total monthly operational cost ceiling: €60.** Realistic typical spend: ~€25/month.

Breakdown:

| Component                             | Monthly cost (typical) | Monthly ceiling |
| ------------------------------------- | ---------------------- | --------------- |
| Hetzner CX32 host                     | €10                    | €10             |
| Hetzner Object Storage (backups)      | €4                     | €5              |
| LLM costs (Section 5)                 | €11 (~$12)             | €40 (~$41)      |
| RPC providers (free tiers)            | €0                     | €0              |
| Domain registration                   | €1                     | €1              |
| Email (transactional, SES or similar) | €0–2                   | €5              |
| Monitoring (self-hosted)              | €0                     | €0              |
| TLS certificates (Let's Encrypt)      | €0                     | €0              |
| **Total**                             | **€26**                | **€61**         |

**Cost monitoring:**

- A monthly cost-attribution report is generated by a scheduled job, drawing from the `ai_cost_log` table and from external billing APIs where they are stable (Hetzner, AWS).
- The report is emailed to the operator and surfaces: total spend, spend by category, deviation from the typical estimate.
- The LLM cost cap (Section 5.3) is enforced automatically; other costs are observable but not capped programmatically (the host cost is fixed; backup storage is bounded by retention policy).

**Cost ceiling escalation:**

If the typical monthly cost approaches the ceiling, the operator has three actions in order: tune the LLM caps downward, audit feature usage for inefficiencies, or raise the ceiling deliberately as a documented decision (an ADR). Silent ceiling breaches are a process failure, not an operational one.

### 7.9 Data handling and privacy

**Personal data Kvorum holds:**

1. **Developer accounts** — for users of the developer dashboard:
   - Email address (email-path users only)
   - Bcrypt-hashed password (email-path users only)
   - Wallet address (SIWE users only)
   - API keys (salted-hashed) and key metadata (creation time, last-used time, label)
   - Optional: account labels and notes set by the user
2. **Logs and metrics:**
   - IP addresses in API access logs, retained for 30 days, then aggregated to per-day counts
   - User-Agent strings in API access logs, retained for 30 days
3. **Audit log:**
   - Admin command history (Section 6.20.1) including the executing operator's identity
4. **Public on-chain and off-chain governance data:**
   - Wallet addresses of voters, delegators, delegates, proposers — these are public by virtue of being on-chain or on Snapshot. Kvorum does not enrich these with non-public personal data (real names, IPs, etc.) beyond what users have publicly self-attested via delegate platforms.

**Privacy commitments:**

- **Privacy policy** published at `/privacy`, listing every category of data Kvorum holds, its purpose, retention period, and the user's rights.
- **No third-party trackers.** No Google Analytics, no Facebook Pixel, no advertising trackers. Self-hosted privacy-respecting analytics (Plausible or equivalent) for usage statistics, configured to not log IP addresses or set cookies.
- **Data deletion on request.** A user can delete their developer account via the developer dashboard (Section 6.14) or via emailed request. Deletion is processed within 7 days. Public on-chain governance data is _not_ deletable — Kvorum cannot remove what the chain itself records.
- **Data export on request.** Users can request a JSON export of their account data via emailed request. Processed within 14 days.
- **GDPR posture.** Kvorum's data processing is in scope for GDPR (the operator is EU-resident). The legal basis for processing is contract (developer accounts) and legitimate interest (governance data analytics). Users have the rights to access, rectification, erasure, and objection. The operator is the data controller; there is no separate DPO for v1 (not required at this scale).

**What v1 does not commit to:**

- DPIA (Data Protection Impact Assessment) — not required at v1's scale and risk profile
- Data residency guarantees beyond Hetzner's EU-located data centers
- Encryption at rest beyond what Postgres and the host provide by default

### 7.10 Release and rollback process

**Trunk-based development.**

- All work happens on short-lived feature branches off `main`.
- PRs are reviewed by the developer themselves (with help from automated checks). At single-operator scale, peer review is not available; rigorous CI is the substitute.
- CI runs on every PR: lint, typecheck, unit tests, integration tests against ephemeral Postgres + Redis + ClickHouse instances, security scans (`npm audit`, `gitleaks`).
- Merge to `main` triggers automated build and deployment.

**Deployment flow:**

1. Merge to `main` triggers GitHub Actions workflow.
2. Workflow builds Docker images for each Kvorum service, tagged with the git SHA.
3. Images are pushed to a container registry (GitHub Container Registry or equivalent).
4. Workflow runs database migrations against production via a gated step. Migration failure halts the deployment.
5. Workflow updates the production `docker-compose.production.yml` with new image tags and runs `docker compose up -d` over SSH to the host. Rolling restart is automatic for the API and dashboard (via Caddy's connection draining).
6. Smoke tests run against the production endpoint. Failures trigger an automatic rollback.
7. Deployment success is recorded in the deployment log and announced via the configured channel (Slack, etc.).

**Rollback:**

- Rollback is a redeploy of the previous git SHA via the same workflow. Docker images for previous SHAs are retained in the registry for 30 days.
- Database migrations are designed to be backward-compatible within a major version: new columns are nullable, new tables are additive, removed columns are deprecated for at least one release before removal.
- True rollback of a database migration is rare and treated as an incident: the procedure is documented in a runbook but not part of the normal release process.

**Release frequency:**

- v1 expects 1–3 releases per week during active development, dropping to 1 per month or less in steady-state operation.
- Release notes are auto-generated from PR titles and merge commit messages, published to `/changelog` and the GitHub releases page.

**No staging environment for v1:**

The cost of a staging environment (a second host, ongoing data sync, divergence from production, cognitive overhead of "did I check it on staging?") is high; the value at single-operator scale is marginal. v1 deploys from `main` to production after CI passes, monitors for issues, and rolls back fast. CI runs against production-like fixtures (real Postgres schema, real RPC mocks, real Snapshot fixture data), making production deployments as predictable as staging would be.

(KNOWN-023: a staging environment may be added if pre-production validation needs grow.)

### 7.11 Status page

**Self-hosted Uptime Kuma**, running as a container in the same deployment, publicly accessible at `status.kvorum.example`.

The status page reports:

- Current operational status of: API, dashboard, ingestion (per source), AI features, monitoring, backup system
- Recent incidents with severity, start time, end time, and a short post-mortem summary
- Scheduled maintenance announcements
- Historical uptime over the last 30 / 90 / 365 days against the 99% target

The status page is updated automatically based on health checks for system status; incidents and maintenance notifications are managed manually by the operator.

The status page is deliberately on a different host or hosting path than the main dashboard, so that an outage of the main system does not also take down the status page. Hosting the status page on Hetzner Object Storage (static HTML) or a separate Hetzner cloud instance is preferred over co-hosting.

### 7.12 What this section does not address

Out of scope for the spec:

- Specific deployment scripts (committed to `infra/` in the repository, but not in the spec).
- Specific container images and their build processes (Dockerfiles in the repository).
- Specific Grafana dashboard JSON (committed to `infra/grafana-dashboards/`).
- Specific incident response procedures beyond the runbook references — those are operator's craft, not spec.

Known concerns originating in this section, recorded in the registry:

- KNOWN-022 (security commitments at v1 scale do not include third-party audits, penetration testing, or bug bounties)
- KNOWN-023 (no staging environment in v1; deploy-from-main with rapid rollback is the chosen tradeoff)

Open questions:

- Whether the email transactional service should be self-hosted (Postfix on the same host) or third-party (SES, Postmark). Self-hosting is cheaper but operationally fragile; third-party is more reliable but adds a vendor. Leaning toward third-party (SES) for v1 reliability; revisit if cost becomes meaningful.
- Whether Sentry (or equivalent) should be used for error reporting in addition to Loki logs. Sentry's grouping and notification ergonomics are valuable for finding new errors fast; the spec is silent on this and the implementation may opt in.
- Whether to set up separate OpenTelemetry tracing collection in v1 or wait until needed. Tracing is genuinely useful when debugging cross-service request paths; not load-bearing at v1 scale. Leaning toward defer.

---

_Section 7 ends here._

---

## 8. Open questions & decisions log

This section serves three purposes:

1. **A consolidated index of open questions** still pending across the spec. Individual sections list their own open questions inline; this section gathers them in one place so a reader can see at a glance what is still undecided.
2. **A decision log** recording the material design decisions reflected in v1.0 of the spec, including the alternatives considered and the reasoning. Distinct from the registry of known limitations (Section 9): the registry records _what we have not done and why_; the decision log records _what we have done and why_.
3. **The ADR (Architecture Decision Record) process** for amending the spec after v1.0 freeze.

This section is meta — it is about the spec, not about Kvorum itself. It exists because the value of a specification compounds when its decisions are traceable, not just observable.

### 8.1 Open questions across the spec

Open questions flagged in individual sections, consolidated for navigation. Each entry links back to the section that raised it. These are unresolved at the time of v1.0 drafting; the operator may close them during implementation, or they may persist into v1.1.

**From Section 2 (Domain model):**

- Whether to denormalize a `proposal.tally_summary` column for read performance, or always derive from `vote_choice`. _Will be resolved when API performance characteristics are known._
- How to model proposals that are amended or superseded by another proposal. _Currently no DAO in v1 has this concept formally on-chain; revisit if Lido's dual governance forces our hand._
- Whether `actor` should have a separate `is_contract` flag with associated metadata. _Multisigs and DAOs voting in other DAOs are first-class participants; deserve consideration in implementation._

**From Section 4 (API specification):**

- Whether to expose the `actor_address` mapping table directly via a dedicated endpoint, or only embed it in actor responses. _Leaning toward embedding for v1; standalone endpoint can be added later if needed._
- Whether analytical endpoints should accept arbitrary time windows or only pre-defined ones. _Leaning toward arbitrary with a server-side maximum range cap, with pre-defined bucket sizes only._
- Whether to support batch endpoints for fetching many resources in one request. _Deferred as a likely v1.1 enhancement if dashboard performance demands it._

**From Section 5 (AI features specification):**

- Whether the mismatch detector should run on Snapshot proposals despite the absence of on-chain calldata. _Probably worthwhile but adds prompt engineering work; deferred to v1.1+ unless an early signal supports prioritization._
- Whether to expose AI provenance metadata in the dashboard UI directly or only on demand. _Leaning toward disclosure with a small, unobtrusive treatment._
- Whether the embedding composition (what text gets embedded) should evolve over the lifetime of the project. _Leaning toward a stable composition for v1, change-controlled via ADR if revised._

**From Section 6 (Dashboard specification):**

- Whether the homepage's mismatch flag section should be prominent when no flags exist. _Leaning toward visible — empty-state honesty is part of the trust posture._
- Whether to show "trending" or "engagement-weighted" sort options anywhere. _Leaning toward not having them in v1; revisit only if user research strongly supports the demand._
- Whether the homepage's auto-generated DAO health snapshot should default to a metric that is positive or one that is most informative. _Leaning toward most-informative, with no editorial bias toward DAOs._
- Whether email-based signup should support email change post-registration. _Leaning toward not in v1._

**From Section 7 (Non-functional requirements):**

- Whether the email transactional service should be self-hosted or third-party. _Leaning toward third-party (SES) for v1 reliability._
- Whether Sentry (or equivalent) should be used for error reporting in addition to Loki logs. _The implementation may opt in._
- Whether to set up separate OpenTelemetry tracing collection in v1 or wait until needed. _Leaning toward defer._

These questions are not blockers for v1 — they are calibration choices that can be made during implementation or deferred. When closed, the resolution is recorded as a decision record (Section 8.3) or as an ADR (post-freeze, Section 8.4).

### 8.2 Decision records — purpose and format

A **decision record** captures a single material design decision: what was chosen, what alternatives were considered, why this choice was made, and what consequences follow. Decision records are short — typically half a page each — and they exist to answer the question "why did we do it this way?" for future readers.

Two distinctions matter:

**Decision records (DRs) vs. Architecture Decision Records (ADRs).**

In this spec:

- **DRs** are written _during drafting_ and document decisions _reflected in v1.0 of the spec_. They are historical context: they explain why the spec says what it says.
- **ADRs** are written _after v1.0 freeze_ and _amend_ the spec. They document decisions to change something the spec previously said.

The two use the same format. The distinction is timing and role: DRs document, ADRs amend.

**Decision records vs. known concerns (Section 9).**

- **DRs and ADRs** record _positive_ decisions: "we chose X." They are about the path taken.
- **Known concerns (KNOWN-NNN)** record _deferred_ or _accepted_ limitations: "we have not done Y, here's why, here's when." They are about the paths not yet taken.

A single design conversation can produce both — for example, the decision to defer pending event visibility produced both DR-001 (the choice and reasoning) and KNOWN-001 (the registry entry tracking the gap until v1.1 resolves it).

**The format:**

```markdown
#### DR-NNN — [Short title]

- **Status**: Accepted (v1.0) | Superseded by DR-MMM | Deprecated
- **Date**: YYYY-MM-DD
- **Spec sections affected**: [section numbers]
- **Related**: [other DR/ADR/KNOWN IDs]

**Context.** What problem are we solving? What constraints apply?

**Decision.** What did we choose? Stated as briefly as possible.

**Alternatives considered.** What did we reject, and why?

**Consequences.** What follows from this choice? What does it cost? What does it enable?
```

Records are numbered sequentially (`DR-001`, `DR-002`, ... `ADR-001`, `ADR-002`, ...) within each prefix. Numbers are never reused. Records are immutable once accepted; superseding a record creates a new one that references the old one, but the old record's text does not change.

### 8.3 v1.0 decision records

The decision records below capture the material decisions made during v1.0 drafting. They are not exhaustive — every spec contains hundreds of small choices that don't merit a record. The threshold for inclusion is: _if a future reader asks "why this and not that?", the answer should not be obvious from the spec alone, and the choice has consequences that constrain future work_.

#### DR-001 — Free public dashboard, free token-gated API

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 1.6, 4.3
- **Related**: KNOWN-012

**Context.** Kvorum's distribution model is a foundational choice: how do users access the product, what gates exist, and what does the gating cost in adoption.

**Decision.** Dashboard is free and fully browseable without authentication. API is free but requires registration to obtain a token; anonymous API requests are rejected.

**Alternatives considered.**

- _Free everything, no auth on API_ — maximizes adoption but eliminates abuse prevention, per-user rate limiting, and usage analytics.
- _Free dashboard, paid API_ — cleaner monetization but requires payment infrastructure, billing, tier management. Inappropriate for v1's portfolio-stage scope.
- _Paid everything_ — unsuitable for the open-data positioning.

**Consequences.** API has signup friction (one-time, low). Architecture supports future paid tiers via a `tier` column on the API key without breaking changes. Webhooks and higher rate limits become natural paid-tier features.

#### DR-002 — REST over GraphQL for the public API

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 4.1
- **Related**: KNOWN-011

**Context.** GraphQL would suit governance analytics well (flexible queries, typed schema, frontend-friendly cross-DAO joins). REST is the conventional choice for public APIs.

**Decision.** REST over HTTPS, JSON-encoded, path-versioned at `/v1/`.

**Alternatives considered.**

- _GraphQL primary_ — operational complexity (N+1 protection, complexity limits, query whitelisting for caching) and adoption friction (clients need a GraphQL library) outweigh the flexibility benefit at v1's scale.
- _Both REST and GraphQL_ — doubles the surface to maintain.

**Consequences.** Lower friction for casual developers (cURL-friendly examples). Larger surface area for analytical queries (must add endpoints for new analytical views). GraphQL may be added in v1.1+ if developer demand materializes.

#### DR-003 — Cursor-based pagination, not offset-based

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 4.5

**Context.** Pagination scheme affects every list endpoint and is hard to change after launch.

**Decision.** Opaque cursor tokens encoding position plus the parameters of the original request. No offset-based pagination.

**Alternatives considered.**

- _Offset/limit pagination_ — broken under concurrent inserts; new items arriving between pages cause skipped or duplicated rows. Convenience for "page 7" navigation does not justify the correctness gap.
- _Keyset-only pagination without opaque tokens_ — exposes implementation details (the keyset values) in URLs, complicating future schema evolution.

**Consequences.** Clients cannot jump to arbitrary pages. List responses include `next_cursor` and `has_more`. Cursor format is opaque and can evolve internally without breaking clients.

#### DR-004 — Path-based API versioning

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 4.1

**Context.** Versioning strategy affects URL stability and operational debuggability.

**Decision.** Every endpoint rooted at `/v1/`. Future versions live at `/v2/`, etc.

**Alternatives considered.**

- _Header-based versioning_ (`Accept: application/vnd.kvorum.v2+json`) — cleaner conceptually but harder to debug, harder to share via URL, breaks naive HTTP caching.
- _Date-based versioning_ (`Kvorum-API-Version: 2026-05-01`) — fine-grained but operationally heavy; unsuitable for the stable contracts a free API expects.

**Consequences.** Major version changes are URL changes; minor and patch evolutions of v1 stay at `/v1/`. Multiple versions can coexist during deprecation windows.

#### DR-005 — Confirmed-only event visibility in v1

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 3.4
- **Related**: KNOWN-001, DR-009

**Context.** Whether the public API and dashboard surface events that have been observed but not yet passed the chain's reorg horizon.

**Decision.** v1 surfaces only confirmed events. Pending events are recorded in the archive but not exposed publicly. v1.1 adds opt-in pending visibility.

**Alternatives considered.**

- _Always show pending_ — exposes users to events that may be reorged away, requiring careful UX treatment that adds scope to the dashboard.
- _Opt-in pending in v1_ — adds API surface and dashboard treatment that is not required for v1's core value proposition.

**Consequences.** New events appear with a latency floor of the reorg horizon (~3 minutes for Ethereum mainnet). This makes streaming protocols (DR-009) less valuable in v1, justifying their deferral. Forward-compatibility is preserved through the `confirmed: boolean` field on entity responses.

#### DR-006 — Append-only event archive with explicit reorg events

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 3.1, 3.2, 3.4

**Context.** Reorg handling is the load-bearing correctness feature of EVM ingestion. The naive approach uses a Redis-backed pending buffer that is mutated on reorg.

**Decision.** Event payloads are written to the archive immediately and never mutated. Confirmation status (`pending` / `confirmed` / `orphaned`) transitions on the row. Reorgs are first-class records in a `reorg_event` table linking to the events they orphaned.

**Alternatives considered.**

- _Pending buffer in Redis, promote to Postgres on confirmation_ — original design. Two storage systems, mutation on reorg, no observable reorg history.
- _No archive at all, only derived state_ — loses auditability, makes derivation bugs unrecoverable.

**Consequences.** Truly append-only data structure. Reorg history is queryable. One storage system holds all event data. Slightly larger archive (orphaned rows kept forever), trivial at v1's scale. Idempotency keys must include `block_hash` to allow same-logical-event-different-block scenarios.

#### DR-007 — Local-first ABI decoding

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 3.8

**Context.** ABI decoding for proposal calldata requires the function signature and the contract's ABI. The naive approach treats Etherscan as a runtime dependency.

**Decision.** Bundled selector index (4byte.directory snapshot) plus bundled ABI library covers >95% of governance calldata. EIP-1967 implementation slot reading covers proxy resolution. Block explorer APIs are an _optional_ enrichment path for the long tail.

**Alternatives considered.**

- _Etherscan as primary_ — runtime dependency on third-party rate-limited service; ironic for a read-only blockchain analytics platform.
- _On-chain only, no enrichment_ — leaves the long tail unresolved indefinitely.

**Consequences.** Hot path is local. Failure modes from external services do not block governance work. Bundled assets need periodic refresh (weekly cron job). The bundled ABI library must be maintained as new contracts are tracked.

#### DR-008 — Snapshot voting power trusted in v1; verification deferred

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 2.4.7, 3.9
- **Related**: KNOWN-002

**Context.** Snapshot's API reports voting power for off-chain votes computed from the proposal's strategy configuration. Kvorum could trust these values or independently recompute them.

**Decision.** v1 trusts Snapshot's reported voting power. v1.1 introduces an independent strategy resolver. Schema in v1 anticipates verification via the `voting_power_reported` / `voting_power_computed` / `voting_power_verified` triplet.

**Alternatives considered.**

- _Recompute Snapshot voting power in v1_ — meaningful engineering effort (~1 week per the strategies used by the v1 DAOs) plus ongoing maintenance. Stacks a second substantial technical claim against v1's core unification claim.
- _Never recompute_ — leaves a real correctness gap, especially for Lido where Snapshot is the primary governance venue.

**Consequences.** v1 ships with a trust boundary explicitly disclosed in the dashboard's AI provenance treatment. v1.1 verification is a strong differentiator and natural launch beat. Schema cost in v1 is four columns on `vote`, three of them NULL until v1.1.

#### DR-009 — Streaming protocols deferred to v1.1

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 4.1, 4.6
- **Related**: KNOWN-014, DR-005

**Context.** Originally the spec included WebSocket and SSE endpoints as part of v1. With pending event visibility deferred (DR-005), the case for streaming weakens substantially.

**Decision.** v1 ships REST endpoints only. Real-time consumption is via short-interval polling. WebSocket and SSE are deferred to v1.1 where they pair naturally with pending event visibility.

**Alternatives considered.**

- _Ship WebSocket in v1 alongside confirmed-only events_ — implementation cost (5–8 days plus operational complexity) without proportional value, given the reorg horizon already introduces minutes of latency.
- _Ship SSE only in v1, WebSocket later_ — splits the streaming work without simplifying it.

**Consequences.** v1 deployment is simpler (no Redis pub/sub for cross-instance fan-out). Polling at 10-second intervals is the v1 real-time mechanism. Forward-compatibility is preserved through the `confirmed` field on REST responses.

#### DR-010 — Three v1 DAOs: Compound, Aave, Lido

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-02
- **Spec sections affected**: 1.4, 2.1

**Context.** The choice of v1 DAOs determines the unification claim's strength: are we proving the schema across genuinely heterogeneous governance, or just across structurally similar ones?

**Decision.** Compound (canonical Governor Bravo), Aave (Governance v3 with cross-chain execution), and Lido (Aragon + Snapshot + Dual Governance hybrid). Three structurally distinct governance models.

**Alternatives considered.**

- _Compound + Uniswap + Arbitrum_ — three Governor Bravo variants. Less variety; weaker unification claim.
- _Compound + Uniswap + Optimism_ — heavy L2 governance focus. Concentrated in one governance pattern.
- _Add a fourth DAO_ — increases scope without additional architectural validation.

**Consequences.** v1's unification claim is genuinely tested. Lido's hybrid model is the hardest case and validates the `dao_source` abstraction. Adding a fourth DAO post-v1 typically means adding zero-to-two extension tables, not changing core entities.

#### DR-011 — Lido dual-track explicit in the dashboard

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 6.15, 6.17
- **Related**: KNOWN-007

**Context.** Lido's three governance sources (Aragon binding, Snapshot signaling, Dual Governance veto) have different voting power semantics. "Voting power in Lido" means different things in different contexts.

**Decision.** The dashboard does not collapse Lido's tracks. The DAO landing page surfaces the three tracks explicitly. The proposal detail page makes the source explicit in the header. There is no unified "Lido voting power" figure presented anywhere.

**Alternatives considered.**

- _Primary view with tabs_ — simpler for casual browsers but misleading; voting power across tracks is not interchangeable.
- _Pick one "primary" source and show only it_ — wrong for Lido; all three are real.

**Consequences.** Lido's pages are noticeably more complex than Compound's or Aave's. The complexity is justified by the trust posture (legibility over false simplicity). Operators of other dual-governance DAOs (when added post-v1) get the same treatment.

#### DR-012 — AI as feature, not wrapper

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 1.5, 5.1, 5.2

**Context.** Many products use LLMs as marketing decoration ("AI-powered!") rather than as load-bearing functionality. The spec's positioning claim was "AI as feature, not wrapper."

**Decision.** Four AI features in v1, each with a defined purpose, output schema, cost ceiling, and trust posture: proposal summarizer, calldata-vs-prose mismatch detector, forum thread synthesizer, proposal embeddings. Every AI output carries provenance metadata; source content is always available alongside the output; AI-generated content is consistently labeled.

**Alternatives considered.**

- _No AI features in v1_ — defensible but loses a meaningful differentiator. The mismatch detector specifically is a capability no other governance tool offers.
- _More AI features (e.g., NL query, recommendations)_ — increases scope without improving v1's core technical claim. Deferred to v1.1+.
- _AI without provenance disclosure_ — quicker to implement but undermines the trust posture and operator-first positioning.

**Consequences.** AI infrastructure is real engineering work (LLM client, prompt templates, structured output validation, cost tracking, budget caps). The mismatch detector is the flagship feature and gets prominent dashboard treatment. Total monthly LLM cost ceiling is $41 (~€40), with typical spend ~30% of cap.

#### DR-013 — Flagship feature: calldata-vs-prose mismatch detector

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 5.6, 6.3, 6.4, 6.9

**Context.** Of the four AI features, one needs to be the flagship — the feature that justifies the AI investment narratively and is most likely to be cited in launch material.

**Decision.** The calldata-vs-prose mismatch detector. Sonnet for quality, sync mode for active proposals, prominent dashboard surfacing on homepage / list views / proposal detail. Conservative threshold (only `material` and `severe` discrepancies surface on summary views).

**Alternatives considered.**

- _Proposal summarizer as flagship_ — useful but unremarkable; every aggregator could add summarization.
- _Forum synthesis as flagship_ — valuable but content quality varies wildly; less defensible launch claim.
- _Embedding similarity as flagship_ — interesting but invisible (no obvious UI surface).

**Consequences.** Mismatch detector gets the largest budget cap ($20/month) and Sonnet (more expensive than Haiku). Conservative threshold mitigates damage from false positives. Detector output requires ABI decoding to be complete, creating a dependency chain.

#### DR-014 — Single-host Docker Compose deployment for v1

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 7.1

**Context.** Deployment topology choice affects operational complexity, resilience, and cost.

**Decision.** All Kvorum services plus supporting infrastructure (Postgres, Redis, ClickHouse) plus monitoring stack (Grafana, Prometheus, Loki) run on a single Hetzner CX32 (~€10/month) via Docker Compose.

**Alternatives considered.**

- _Multi-host with active-passive failover_ — eliminates single point of failure, doubles cost, doubles operational surface.
- _Container orchestrator (Kubernetes, Nomad)_ — appropriate for scale Kvorum does not have. Premature optimization.
- _Managed services (Neon for Postgres, Upstash for Redis, Fly.io for app)_ — defensible and a likely v1.x evolution. Not needed for v1; adds vendor dependencies and cost.

**Consequences.** Single point of failure: host outage = full outage. Eats into 99% uptime budget if it happens. The deployment is structured to lift-and-shift to multi-host without rewriting service code (stateless services, env-var configuration, network-only inter-service communication). Migration path documented in Section 7.7.

#### DR-015 — CLI plus Grafana for admin; no custom web admin UI

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 6.20
- **Related**: KNOWN-021

**Context.** Operational tasks (configuration, backfill triggers, DLQ resolution, user management, monitoring) require some admin surface.

**Decision.** Two tools: a CLI (`kvorum-admin`) for user management and operational commands, authenticated by SSH/host access; Grafana + Prometheus for monitoring and observability. No custom web admin UI.

**Alternatives considered.**

- _Custom web admin UI_ — substantial engineering effort (auth, RBAC, design, security review). Displaces work from the actual product.
- _CLI only, no monitoring stack_ — leaves observability as a manual exercise. Industrial-strength monitoring is free off-the-shelf; not adopting it is the wrong choice.
- _Build everything custom_ — speculatively useful, expensively delivered.

**Consequences.** Admin surface is bounded and pragmatic. Off-the-shelf tooling provides sophisticated observability for free. v1 deployment includes Grafana, Prometheus, Loki, Alertmanager (eleven moving pieces total on one host, comfortable on CX32). Future web admin UI is genuinely deferred — built only if specific operational pain emerges.

#### DR-016 — 99% uptime target, not higher

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 7.3

**Context.** Uptime targets must be defensible. A target that cannot be sustained is theater.

**Decision.** 99% monthly availability for the API and dashboard. Approximately 7 hours of downtime per month, allowing for normal incident response cadence.

**Alternatives considered.**

- _99.9% (~43 minutes/month)_ — requires fast on-call response to any incident; not sustainable for a single operator without paging infrastructure.
- _99.95% or higher_ — requires infrastructure redundancy (multi-host, automated failover) that v1 does not justify.
- _No uptime target_ — defensible for a free product but undermines operator-first positioning.

**Consequences.** Operator can take vacations. Slow recovery from rare incidents is within budget. Higher targets remain available if multi-host deployment becomes warranted (Section 7.7's scaling path).

#### DR-017 — €60/month operational cost ceiling

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 7.8

**Context.** Cost discipline must be a real commitment, not aspirational.

**Decision.** Total monthly operational cost ceiling: €60. Realistic typical spend: ~€25/month. Composed of host (€10), backup storage (€5), LLM costs ($41 ceiling, ~$12 typical), domain (€1), email (€5), and free-tier services for everything else.

**Alternatives considered.**

- _No cost ceiling_ — risks unbounded growth, especially in LLM costs.
- _Tighter ceiling (€30)_ — possible but requires more aggressive LLM caps and may force forgoing useful features.
- _Looser ceiling (€100+)_ — defensible if Kvorum becomes funded, but not for a v1 portfolio project.

**Consequences.** LLM caps in Section 5.3 are tight ($41 total). Cost monitoring is automated; ceiling breaches are a process failure. Headroom exists if needed (~€34 between typical spend and ceiling).

#### DR-018 — No staging environment in v1

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 7.10
- **Related**: KNOWN-023

**Context.** Pre-production validation has real value but real cost. Single-operator projects make different tradeoffs than team-of-engineers projects.

**Decision.** Deploy from `main` to production after CI passes. No separate staging environment. CI runs against production-like fixtures (real schema, RPC mocks, Snapshot fixtures). Rapid rollback (~minutes) is the recovery mechanism.

**Alternatives considered.**

- _Full staging environment mirroring production_ — doubles host cost, adds data divergence overhead, single operator must maintain two environments.
- _Preview environments per-PR_ — appealing but high operational complexity for limited benefit.

**Consequences.** Production is the test environment. CI rigor compensates: production deployments must be predictable from CI alone. Rollback procedures are rehearsed and fast. Adding staging later is a pure scaling decision when development practices warrant.

#### DR-019 — KNOWN registry as single source of truth for deferred decisions

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: 9

**Context.** Deferred decisions and accepted limitations were initially scattered across individual sections. A consolidated registry was added during drafting.

**Decision.** All known concerns, deferred decisions, and trust boundaries are recorded in Section 9 with stable `KNOWN-NNN` identifiers. Inline references in earlier sections point to the registry; the registry is canonical.

**Alternatives considered.**

- _Inline-only_ — convenient for section readers but easy to lose track of the global picture.
- _Separate document_ — splits the spec; references would need to bridge across files.

**Consequences.** Code comments, ADRs, and external references can use stable `KNOWN-NNN` IDs. The total scope of deferred work is visible at a glance. v1.1 commitments are explicit, allowing realistic planning.

#### DR-020 — Spec lifecycle: drafting → freeze → ADRs

- **Status**: Accepted (v1.0)
- **Date**: 2026-05-03
- **Spec sections affected**: Spec lifecycle (top of document), 8.5

**Context.** Specifications without lifecycle discipline either ossify (refusing to acknowledge change) or dissolve (changes happen ad-hoc and traceability is lost).

**Decision.** Three phases: drafting (current), v1.0 frozen (after sign-off, immutable), and post-freeze evolution via numbered ADRs. ADRs reference and amend specific spec sections; the spec itself is not edited post-freeze.

**Alternatives considered.**

- _Living document forever_ — loses the ability to point to a stable v1.0 reference.
- _Heavy review process_ — appropriate for organizations with multiple stakeholders; overkill for a single-operator project.

**Consequences.** v1.0 is a stable artifact. Future readers can read v1.0 plus the chronological ADRs to understand the current canonical design. ADR discipline is light-process (no formal review board) but real (every meaningful change is recorded).

### 8.4 ADR process post-freeze

Once the spec is tagged as `v1.0`, it becomes immutable. Subsequent changes are delivered as ADRs.

**ADR location.** ADRs live in `docs/adr/` in the repository, one Markdown file per ADR, named `NNNN-short-title.md`. Numbering continues from the v1.0 DRs (the first post-freeze ADR is ADR-021 if 20 DRs shipped in v1.0, or starts at ADR-001 in a fresh sequence — _to be decided at freeze time_).

**ADR template.** Same format as DRs (Section 8.2): Status, Date, Spec sections affected, Related, Context, Decision, Alternatives considered, Consequences.

**Status values for ADRs:**

- _Proposed_ — under consideration; not yet implemented.
- _Accepted_ — agreed upon and reflected in the system.
- _Superseded by ADR-NNN_ — replaced by a later decision; the original ADR is preserved for historical context.
- _Deprecated_ — no longer relevant; not implemented.

**Process for new ADRs:**

1. Create the ADR file with status `Proposed`.
2. Discuss as needed (PR review, async discussion, or solo reflection at single-operator scale).
3. When agreed, update status to `Accepted` and merge.
4. Implement the change in code; reference the ADR in the relevant commit messages.
5. Update Section 9 (Known concerns registry) if the ADR resolves or modifies a `KNOWN-NNN` entry.

**ADR numbering across versions.** Recommended: ADRs continue the global sequence (ADR-021, ADR-022, ...) regardless of which version they ship in. Each ADR records the version it ships in. This makes references stable across time (an ADR-NNN reference always points to the same record) and allows multiple version-affecting changes to be in flight simultaneously without numbering conflicts.

**ADR registry.** A `docs/adr/README.md` file lists all ADRs in chronological order with their status and one-line summary, kept updated as ADRs are added. This is the canonical index.

### 8.5 Cross-references between this section and others

This section is meta — it does not describe Kvorum but the spec describing Kvorum. As a result, it references many other sections. The references that matter:

- **Spec lifecycle (top of document)** — establishes the three-phase model that Section 8 operationalizes.
- **Section 9 (Known concerns)** — the complementary registry. DRs/ADRs and known concerns work together: DRs/ADRs record decisions, known concerns record limitations.
- **Per-section "Open questions" subsections** — Section 8.1 consolidates these.
- **Every spec section** — DRs in 8.4 reference specific spec sections to make the link from "decision" to "what the spec says" explicit.

When a future ADR amends the spec, it references both the spec section it modifies _and_ any prior ADRs/DRs it relates to. The graph of decisions is navigable in either direction.

### 8.6 What this section does not address

This section is itself meta and so has fewer "deferred" items than other sections. The remaining open items:

- Whether to maintain a _changelog_ document separate from the ADRs that summarizes user-visible changes per release. The release notes from Section 7.10 (auto-generated from PR titles) serve this purpose for casual users; ADRs serve it for developers wanting depth. A separate human-curated changelog may add value but is not committed for v1.
- Whether to publish ADRs as part of the public website (`/decisions`) or keep them in the repository only. Internal-only is the v1 default; publishing them externally would be a transparency commitment with its own ongoing tax.

---

_Section 8 ends here._

---

## 9. Known concerns & v1.1 roadmap

This section is the canonical registry of every known concern, deferred decision, accepted limitation, and trust boundary in Kvorum v1. Its purpose is to ensure that nothing important is lost between specification and implementation, between v1.0 and later versions, or between the original author's understanding and a future maintainer's.

Each entry has a stable identifier (`KNOWN-NNN`) which may be referenced from code comments, ADRs, issue trackers, or other parts of the spec. Identifiers are never reused; if a concern is fully resolved in a later version, its entry is updated with the resolution but the ID remains.

The registry is ordered roughly by severity descending, then by concern category. Entries in the same severity tier are not ranked relative to each other.

### 9.1 Severity definitions

- **Material**: a concern that meaningfully affects what users can do, what claims Kvorum can make about correctness or coverage, or how Kvorum is operated. Resolution is a discrete piece of work with a target version.
- **Minor**: a concern that is genuinely deferred or accepted, but does not materially undermine v1's purpose or claims. Resolution may be planned or may be left as a permanent acceptance.

There is no `critical` tier in the v1 registry. A critical concern would block v1 launch by definition.

### 9.2 Categories

- **Correctness**: the data or computation may diverge from the authoritative source.
- **Coverage**: there is governance activity Kvorum does not capture or model.
- **Usability**: the surface exposed to users does not yet support a known use case.
- **Operational**: a constraint or trust assumption in how Kvorum is run.

### 9.3 Registry

#### KNOWN-001 — Pending events not visible in v1

- **Severity**: material
- **Category**: usability
- **Spec sections**: 3.2, 3.4
- **Description**: Kvorum v1 surfaces only events whose `confirmation_status` is `confirmed`. Pending events are recorded in the archive but not exposed through the public API or dashboard. This means a vote cast on Compound is not visible to API consumers until it has aged past the chain's reorg horizon (≈2.5 minutes for Ethereum mainnet, longer for Polygon/Avalanche).
- **Rationale for v1**: Conservative correctness story for initial launch; pending logic edge cases are contained inside Kvorum until they are well-tested.
- **Resolution**: v1.1 ships opt-in pending visibility, paired with the introduction of streaming protocols (WebSocket and SSE) where it materially helps. The relevant additions: `?include_pending=true` on REST endpoints, and pending events delivered through the new streaming endpoints. Forward-compatibility schema (`confirmed: boolean` field on REST responses) is in place from v1 to make REST changes purely additive. (See also KNOWN-014.)
- **Target version**: v1.1

#### KNOWN-002 — Snapshot voting power is trusted, not independently verified

- **Severity**: material
- **Category**: correctness
- **Spec sections**: 2.4.7, 3.9
- **Description**: For Snapshot proposals, voting power values are taken directly from Snapshot's API. Kvorum does not independently compute these values against the on-chain state, so it cannot detect divergence between what Snapshot reports and what the strategy formulas would actually produce. This is a non-trivial trust assumption for Lido especially, where Snapshot is the primary governance venue.
- **Rationale for v1**: Implementing the Snapshot strategy resolver for the strategies used by Compound, Aave, and Lido is approximately a week of focused work plus ongoing maintenance when strategies evolve. Stacking this with v1's other technical claims risks neither being well-executed.
- **Resolution**: v1.1 ships a Snapshot strategy resolver for the strategies used by the v1 DAOs, with graceful fallback to trust-Snapshot semantics for unimplemented strategies. The `vote.voting_power_reported` / `voting_power_computed` / `voting_power_verified` / `voting_power_discrepancy` fields are reserved in the v1 schema for this purpose. v1.1 will surface verification discrepancies as their own analytical view.
- **Target version**: v1.1

#### KNOWN-003 — Emergency governance actions not modeled

- **Severity**: material
- **Category**: coverage
- **Spec sections**: 1.7
- **Description**: Aave's Guardian and Emergency Executor roles, Lido's emergency mechanisms, Compound's pause guardian, and equivalent admin/emergency paths in other DAOs can affect governance but do not flow through the normal `ProposalCreated` lifecycle. v1 does not model these. Operators (Kvorum's primary user segment) lose visibility into a category of governance-adjacent activity that is rare but high-stakes.
- **Rationale for v1**: Each emergency mechanism has its own contract surface and event semantics. Modeling them properly is non-trivial and orthogonal to v1's core technical claims.
- **Resolution**: v1.1 introduces a `governance_intervention` entity, separate from `proposal`, that captures admin pauses, multisig overrides, timelock bypasses, and other governance-adjacent actions. The entity is linkable to a `proposal` when an intervention affects a specific proposal (e.g., a Guardian cancels a queued proposal).
- **Target version**: v1.1

#### KNOWN-004 — Event archive not exposed as an API resource

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 3.13
- **Description**: The reorg-aware event archive — including the `reorg_event` log — is internal to Kvorum in v1. Researchers and journalists who would benefit from raw event access ("show me every reorg that affected a vote") cannot access it via the public API.
- **Rationale for v1**: The archive schema is the most likely part of Kvorum to evolve as new sources are added or interpretation logic improves. Committing publicly to a schema before it has stabilized would force API breaking changes or dual-write maintenance.
- **Resolution**: v1.1+ exposes a read-only events endpoint once the schema is settled and the operational picture (especially around reorg events) is well-understood. Likely shape: `GET /daos/{slug}/events?source_type=&block_range=&confirmation_status=`.
- **Target version**: v1.1 or later

#### KNOWN-005 — Low-confidence forum-to-proposal linking is deferred

- **Severity**: minor
- **Category**: coverage
- **Spec sections**: 3.7
- **Description**: Forum threads are linked to proposals via three signals: URL references in the proposal description (high confidence), community-curated naming conventions (medium confidence), and inferred linking via title/timing similarity (low confidence). The first two ship in v1; the third is deferred. As a result, some proposals will have available forum discussions that Kvorum does not surface.
- **Rationale for v1**: Inferred linking requires the AI worker pipeline (embeddings, similarity scoring) to be mature, and even then risks producing false matches that mislead users.
- **Resolution**: v1.1+ adds inferred linking as a separate confidence tier, surfaced in the UI as "possibly related" rather than as a direct link. Implementation depends on the AI worker pipeline maturing (Section 5).
- **Target version**: v1.1+

#### KNOWN-006 — Snapshot voting power and on-chain reorgs

- **Severity**: minor
- **Category**: correctness
- **Spec sections**: 3.6
- **Description**: Snapshot proposals reference an on-chain block (the `snapshot` field in Snapshot's API) at which voting power is computed. Snapshot reads state at that block once at proposal creation time and does not re-evaluate. If that on-chain block is later reorged out of the canonical chain, Snapshot's reported voting power values are based on state from a chain branch that no longer exists.
- **Rationale**: In practice, Snapshot's chosen reference blocks are well past the reorg horizon by the time proposals are evaluated. The chains Snapshot reads from (mainly Ethereum mainnet) have not had a deep reorg in years.
- **Resolution**: Document the trust boundary; no active resolution planned. If Snapshot's behavior changes or a relevant reorg occurs, revisit. KNOWN-002's verification mechanism would surface the discrepancy if it ever materialized.
- **Target version**: Permanent acceptance

#### KNOWN-007 — Lido dual-token governance UX clarity

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 2 (data model handles it; UX is Section 6's concern)
- **Description**: Lido has two distinct token populations that participate in governance differently: LDO holders vote on binding proposals via Aragon, while stETH holders signal via Snapshot and have veto power via Dual Governance. The data model handles this through separate `dao_source` rows, but the user-facing implication — that "voting power in Lido" means different things in different contexts — needs careful UX treatment.
- **Resolution**: Addressed in Section 6.17 (Lido dual-track treatment). The dashboard does not collapse Lido's three governance tracks; the DAO landing page surfaces them explicitly and proposal pages make the source explicit. There is no unified "Lido voting power" figure presented anywhere. The data model in Section 2 supports this through separate `dao_source` rows. Resolved in v1.0; no outstanding work.
- **Target version**: v1.0 (resolved)

#### KNOWN-008 — Reorg horizon defaults are conservative, not measured

- **Severity**: minor
- **Category**: operational
- **Spec sections**: 3.4
- **Description**: The reorg horizons used by v1 (12 / 128 / 40 / 40 / 30 / 40 confirmations for Ethereum / Polygon / Arbitrum / Optimism / Avalanche / Base) are conservative defaults chosen from public guidance, not measurements of Kvorum's specific operational experience. They likely produce unnecessary latency on chains where deep reorgs are rare in practice.
- **Resolution**: Post-launch, monitor actual reorg depths observed by Kvorum's `reorg_event` log. After 30 days of operational data, tune horizons per chain if the data supports it. Any change is a configuration update, not a schema or code change.
- **Target version**: Operational tuning post-launch

#### KNOWN-009 — Forum content integrity is not verified

- **Severity**: minor
- **Category**: operational (trust boundary)
- **Spec sections**: 3.7
- **Description**: Discourse forum content is ingested as-is from the forum's public API. Kvorum does not detect or react to silently-edited posts, deleted posts, or moderator interventions. AI-synthesized summaries are computed against the forum content at the time of ingestion and are not re-synthesized when forum content changes (unless the change happens to trigger a re-crawl within the configured cadence).
- **Resolution**: Document the trust boundary. Forum content is a secondary input to Kvorum's analyses; the primary inputs (on-chain events, Snapshot votes) carry their own integrity guarantees. No active resolution planned for v1.
- **Target version**: Permanent acceptance

#### KNOWN-010 — Block explorer ABIs are trusted when used

- **Severity**: minor
- **Category**: operational (trust boundary)
- **Spec sections**: 3.8
- **Description**: When the bundled ABI library and on-chain proxy resolution do not yield an ABI for a target contract, the optional enrichment path consults block explorer APIs (Etherscan family). The returned ABI is cached and used for decoding without independent verification. A compromised or malicious explorer could in principle return an ABI that misdecodes calldata, leading to incorrect `decoded_function` and `decoded_arguments` values.
- **Resolution**: The risk is bounded because (a) the bundled library covers the vast majority of governance calldata, so explorer enrichment is rarely on the hot path, and (b) decoded values are presented alongside raw calldata, not as a replacement for it — discrepancies would be observable to a careful user. No active resolution planned.
- **Target version**: Permanent acceptance

#### KNOWN-011 — GraphQL endpoint not provided in v1

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 4.1
- **Description**: Kvorum v1 ships REST only. GraphQL is appealing for analytics use cases (flexible queries, typed schema, frontend-friendly) but adds operational complexity (N+1 protection, query complexity limits, query whitelisting for caching) and imposes a learning curve and library dependency on consumers. v1's access patterns are well-defined enough that REST is sufficient.
- **Resolution**: Reconsider for v1.1+ if developer demand materializes. The shape of any GraphQL endpoint should reflect actual queries developers want, not speculative flexibility. Implementation would coexist with REST, not replace it.
- **Target version**: v1.1+ (conditional on demand)

#### KNOWN-012 — Webhooks not provided in v1

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 1.7, 4.6.3
- **Description**: Real-time push to consumer-controlled URLs (webhooks) is not provided in v1. v1 supports only REST polling for real-time consumption (KNOWN-014 also defers WebSocket and SSE). Webhooks would simplify integration for consumers building on serverless or batch-oriented infrastructure and are a natural fit for the future paid tier described in Section 4.4.
- **Resolution**: Targeted as a v1.1 feature, likely as a paid-tier capability. Implementation requires webhook delivery infrastructure (queue, retries, dead-letter handling, signature verification, replay protection), which is meaningful work but well-understood.
- **Target version**: v1.1

#### KNOWN-013 — Bulk export endpoints not provided in v1

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 4.6
- **Description**: v1 has no endpoints for downloading large slices of data in single requests (e.g., "all Compound votes as CSV", "all proposals as a JSON array"). Researchers and analysts would benefit from these — pulling thousands of proposals via paginated API is workable but tedious. v1's pagination is sufficient for most consumers but creates friction for academic and one-off analytical workflows.
- **Resolution**: Add export endpoints in v1.1+ once the access patterns of real users are known. Likely shape: `GET /v1/daos/{slug}/exports/votes?format=csv&from=&to=` returning a streaming response, possibly asynchronous (export job + signed URL) for very large extracts.
- **Target version**: v1.1+

#### KNOWN-014 — Streaming protocols (WebSocket, SSE) deferred to v1.1

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 4.1, 4.6
- **Description**: v1 ships REST endpoints only. Real-time consumption is via short-interval polling (typically 10 seconds for active dashboard views), which is sufficient given v1's confirmed-only visibility model — the ~3 minute reorg-confirmation latency (KNOWN-001) already dwarfs polling intervals, so push delivery offers no meaningful improvement. WebSocket and SSE are deferred to v1.1, where they pair naturally with the introduction of pending event visibility (KNOWN-001's resolution).
- **Rationale for v1**: Streaming infrastructure is real engineering work — connection lifecycle, auth, channel routing, broadcast fan-out across instances via Redis pub/sub, heartbeats, reconnection handling, and meaningful integration testing. The work is approximately 5–8 days plus ongoing operational complexity. With pending visibility deferred, the case for streaming weakens substantially: polling at 10-second intervals introduces less latency than the reorg horizon already does. Bundling streaming with pending visibility in v1.1 is the right packaging.
- **Resolution**: v1.1 introduces a WebSocket endpoint at `/v1/ws` and SSE streams under `/v1/streams/...`. The shape of these is described in earlier draft material from this spec and is anticipated to remain similar: token-authenticated, channel-based subscriptions, JSON message format, heartbeats. v1.1 also introduces concurrent-connection rate limit tiers (anticipated in Section 4.4) and the `confirmation_status` field on streamed event payloads.
- **Target version**: v1.1

#### KNOWN-015 — Natural-language query interface deferred

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 5.1
- **Description**: A natural-language query interface — translating user prompts like "show me delegates who voted against the foundation more than 30% of the time" into SQL or analytical API calls — is not provided in v1. The capability is appealing for the researcher and operator user segments but introduces non-trivial risk: LLM-generated SQL must be sandboxed (read-only role, statement timeout, schema-aware constraint checking), and the model can hallucinate column names or aggregate queries with poor performance characteristics.
- **Rationale for v1**: The infrastructure to do this safely is meaningful work and the actual user demand is unproven. Better to ship the structured API and analytical endpoints first and observe how users compose queries before investing in NL translation.
- **Resolution**: v1.1+ may add an NL query endpoint with strict safety constraints: read-only execution, schema whitelisting, complexity limits, and provenance metadata indicating the SQL produced from the user's prompt. Implementation depends on observed v1 usage patterns.
- **Target version**: v1.1+ (conditional on demand)

#### KNOWN-016 — Multi-language forum synthesis deferred

- **Severity**: minor
- **Category**: coverage
- **Spec sections**: 5.7
- **Description**: The forum synthesizer in v1 produces output for English-language threads only. Discourse forums for the v1 DAOs are predominantly English, but some discussion does occur in other languages (notably Chinese in some Aave threads). Non-English content is currently skipped with a metadata flag rather than synthesized.
- **Rationale for v1**: Multilingual prompt engineering and quality validation is real work, and the v1 DAOs' content is overwhelmingly English. Skipping rather than synthesizing-poorly is the honest choice for v1.
- **Resolution**: v1.1+ adds detection of thread language and language-appropriate synthesis. Output schema gains a `language` field. The dashboard presents non-English syntheses with a translation affordance.
- **Target version**: v1.1+

#### KNOWN-017 — AI feature regeneration not exposed in v1 API

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 5.4
- **Description**: v1 does not expose endpoints for forcing regeneration of AI outputs (e.g., re-running the summarizer on a proposal whose description has not changed). Regeneration is available only as an internal admin operation. Sophisticated users may want to re-run analyses against newer prompt versions or different models.
- **Rationale for v1**: Public regeneration endpoints raise cost and abuse concerns. v1 keeps the surface tight; internal operations cover edge cases.
- **Resolution**: v1.1+ may expose authenticated regeneration endpoints with rate limits and explicit cost confirmation. Likely shape: `POST /v1/daos/{slug}/proposals/{type}/{id}/ai/summary/regenerate` returning a job ID. Deferred until usage signals demand.
- **Target version**: v1.1+ (conditional on demand)

#### KNOWN-018 — Full governance anomaly detection deferred

- **Severity**: minor
- **Category**: coverage
- **Spec sections**: 6.7
- **Description**: The DAO health dashboard surfaces "anomaly indicators" — sudden delegation spikes, voting power concentration changes, abnormal proposal velocity — but v1's implementation uses simple statistical thresholds (e.g., "delegation activity is more than 3 standard deviations above the 90-day baseline"). A more sophisticated detection system would consider correlated signals, known governance-attack signatures, and contextual factors (e.g., proximity to a contentious proposal).
- **Rationale for v1**: Sophisticated anomaly detection requires both more data (Kvorum needs operational history) and more design work (distinguishing real attacks from false alarms is non-trivial). v1's thresholds are useful but coarse.
- **Resolution**: v1.1+ adds: (a) signature-based detection for known attack patterns (Sybil delegation, vote-buying transfers), (b) contextual analysis (anomalies considered in the context of active proposals), (c) tunable sensitivity per DAO. Implementation depends on accumulated operational data and observed user feedback.
- **Target version**: v1.1+

#### KNOWN-019 — Mobile treatment for analytical pages deferred

- **Severity**: minor
- **Category**: usability
- **Spec sections**: 6.17
- **Description**: The dashboard is responsive down to mobile widths, but the analytical pages (DAO health dashboard, delegate alignment heatmap, delegation flow graph) are explicitly desktop-first in v1. On mobile, they degrade gracefully but are not optimized — charts may horizontal-scroll, tables may collapse to summary cards, the delegation flow graph may not render meaningfully.
- **Rationale for v1**: Charting and graph visualization on small screens is a different design problem than on desktop, requiring rethought UX (drill-down navigation rather than overview displays). Doing it well requires design research that v1 does not budget for.
- **Resolution**: v1.1+ adds dedicated mobile layouts for analytical pages, likely involving: (a) progressive disclosure (summary card → tap to expand → detail view), (b) simplified visualizations (sparklines instead of full time-series charts), (c) touch-first interactions (swipe between metrics rather than tab navigation).
- **Target version**: v1.1+

#### KNOWN-020 — Account deletion not extensively tested in v1

- **Severity**: minor
- **Category**: operational
- **Spec sections**: 6.14
- **Description**: The developer dashboard exposes account deletion (Section 6.14). The implementation revokes API keys, removes the user record, and hashes the email for re-registration prevention. Edge cases — concurrent API requests during deletion, in-flight session invalidation, GDPR-style data export before deletion, audit-log retention of deleted accounts — are handled at the framework level but have not been exercised against adversarial scenarios.
- **Rationale for v1**: v1's user base is small enough that account deletion is a rare event; investing in adversarial testing of the flow is not justified. The implementation handles the common case correctly.
- **Resolution**: As the user base grows, formalize deletion as a tested workflow including: data export prior to deletion, explicit grace period (7-day soft-delete with reactivation), audit-log preservation. Revisit when account count crosses a threshold or a real deletion request reveals an issue.
- **Target version**: v1.1+ (operational hardening)

#### KNOWN-021 — Custom web admin UI deferred indefinitely

- **Severity**: minor
- **Category**: operational
- **Spec sections**: 6.20
- **Description**: v1's admin surface is split between a CLI (`kvorum-admin`) for operational tasks and standard third-party monitoring (Grafana + Prometheus) for observability. There is no custom web admin UI. This is sufficient for one-operator operation, but graphical workflows (DLQ inspection with multi-row selection, approval gates for destructive operations involving a second operator, content-rich audit log review) would be more ergonomic in a web UI than in the CLI.
- **Rationale for v1**: A custom web admin UI requires its own auth layer, RBAC scaffolding, dedicated design work, and a security review. The CLI plus Grafana approach displaces no engineering effort from the actual product, leverages mature off-the-shelf tooling for monitoring, and is more defensible against unauthorized access (no exposed admin web surface). The two-tool approach is sufficient for v1's operational profile.
- **Resolution**: Deferred indefinitely; not committed to a target version. A web admin UI may be considered if specific operational pain emerges that neither the CLI nor Grafana addresses well — for example, when a second operator joins the project and approval workflows become valuable, or when DLQ inspection patterns benefit substantially from graphical presentation. Until that pain materializes, the two-tool approach holds.
- **Target version**: Not committed; contingent on operational demand

#### KNOWN-022 — Security commitments at v1 scale exclude third-party audits

- **Severity**: minor
- **Category**: operational (trust boundary)
- **Spec sections**: 7.6
- **Description**: v1's security posture covers the technical fundamentals — TLS, secret management, dependency hygiene, input validation, parameterized queries, password hashing, rate limiting. It does not include third-party penetration testing, formal compliance audits (SOC 2, ISO 27001), or a bug bounty program. These are appropriate for a funded organization with a security team; they are not appropriate commitments for a single-developer v1.
- **Rationale for v1**: The cost of formal audit and bug bounty programs is on the order of tens of thousands of dollars per year, and they require dedicated personnel for response and triage. v1's scale and threat model do not justify this expenditure. The technical security fundamentals are non-negotiable; the formal validation of those fundamentals is the deferred work.
- **Resolution**: Revisit if Kvorum becomes a funded project, takes on enterprise users with compliance requirements, or processes meaningfully sensitive data. Until then, the technical fundamentals are the security posture.
- **Target version**: Not committed; contingent on funding and user requirements

#### KNOWN-023 — No staging environment in v1

- **Severity**: minor
- **Category**: operational
- **Spec sections**: 7.10
- **Description**: v1 deploys from `main` to production after CI passes. There is no separate staging environment for pre-production validation. This is a deliberate tradeoff: the cost of staging (a second host, ongoing data divergence, cognitive overhead) is high at single-operator scale, while CI running against production-like fixtures (real schema, RPC mocks, Snapshot fixture data) makes production deployments predictable enough.
- **Rationale for v1**: Staging is genuinely valuable for teams running pre-release validation in parallel with development. For a single operator, it is more often a divergent environment that produces false confidence ("works on staging, breaks in production"). Rapid rollback (Section 7.10) is the alternative: deploy fast, monitor, revert if needed.
- **Resolution**: Add a staging environment if pre-production validation needs grow — for example, if breaking schema migrations become more frequent, if multi-week features benefit from beta testing, or if a second contributor joins the project and structured code review needs a deployable target.
- **Target version**: Not committed; contingent on development practices

### 9.4 Registry maintenance

The registry is updated when:

- A new known concern is identified during drafting, implementation, or operation. New entries get the next available `KNOWN-NNN` ID.
- A known concern is resolved. The entry is updated to record the resolution version and ADR reference; the ID is preserved.
- A known concern is reclassified (e.g., from "minor" to "material" because real-world impact turned out to be greater than expected). The entry is updated with a note recording the reclassification.

The registry is NOT a substitute for ADRs. Once the spec is frozen, _changes_ to known concerns (resolutions, reclassifications) are captured in ADRs that reference the affected `KNOWN-NNN` IDs. The registry itself is updated to reflect the ADR's outcome but the ADR is the canonical record of the decision.

---

_Section 9 ends here._

---

## 10. Implementation milestones

Sections 1 through 9 specify _what_ Kvorum is. This section specifies _the order in which it gets built_. The milestone structure exists to:

- **Front-load risk.** The hardest, riskiest pieces of the system (reorg handling correctness, multi-source unification under heterogeneous governance, AI cost discipline) are exercised in early milestones. Late-stage architectural surprises are a project killer at single-developer scale.
- **Produce demonstrable output at each step.** Every milestone ends with something working — even if narrow. There is no "and then in week 12 it all comes together" milestone. Vertical slices over horizontal layers.
- **Define done.** Each milestone has explicit acceptance criteria. When they're met, the milestone closes; polish continues in the background or via ADRs.

**Estimated total duration: 14 working weeks** at a focused-but-sustainable hobby-pace cadence. This is the implementation-time estimate, not wall-clock — real life will stretch it. The dependencies between milestones are real; ordering can shift but cannot be radically rearranged.

**Estimates apply to a single developer with v1's stack experience.** Section 1 establishes the developer profile (13 years overall, 5 in Web3, comfortable with NestJS/TypeScript/Postgres/ClickHouse/React). Estimates assume that profile.

### 10.1 Milestone overview

| #    | Milestone                      | Duration              | Cumulative | Acceptance                                             |
| ---- | ------------------------------ | --------------------- | ---------- | ------------------------------------------------------ |
| M0   | Foundation                     | 1 week                | Week 1     | Empty project boots, CI green                          |
| M1   | Compound proposals end-to-end  | 2 weeks               | Week 3     | Compound proposals visible via API; reorg test passing |
| M2   | Compound votes & voting power  | 2 weeks               | Week 5     | Full Compound governance browsable                     |
| M3   | Aave integration               | 2 weeks               | Week 7     | Aave proposals + votes; cross-chain stitching working  |
| M4   | Lido integration               | 2 weeks               | Week 9     | All three v1 DAOs in unified schema                    |
| M5   | AI features                    | 2 weeks               | Week 11    | Four AI features live; cost discipline working         |
| M5.5 | Dashboard design               | 3 weeks (overlaps M5) | Week 13    | Component-level designs complete                       |
| M6   | Frontend implementation        | 2 weeks               | Week 13    | Dashboard pages live                                   |
| M7   | Operational hardening & launch | 1 week                | Week 14    | Production deployment, monitoring, launch              |

The overlap between M5 and M5.5 is intentional: design work is creative and concurrent-friendly; backend work in M5 doesn't block design progress. Similarly M5.5 and M6 overlap by one week: design completion of high-priority pages enables frontend implementation to begin while remaining pages are still being designed.

### 10.2 M0 — Foundation

**Duration: 1 week.**

**Purpose.** Stand up the empty project skeleton so that subsequent milestones have somewhere to build into. No product features; only scaffolding.

**Scope:**

- Nx monorepo initialized with the four service apps (`api`, `dashboard`, `indexer`, `ai-worker`) plus shared libraries (`libs/domain`, `libs/db`, `libs/chain`, `libs/ai`)
- Docker Compose for local development: Postgres 16, Redis 7, ClickHouse, Anvil (forked mainnet)
- GitHub Actions CI: lint, typecheck, test, dependency audit, secret scanning
- Prisma initialized with empty schema; first migration runs
- README documenting setup, with `make up` / `make down` / `make migrate` commands
- Empty `docs/adr/README.md` ready for the first ADR
- `CLAUDE.md` at repo root briefing future Claude Code sessions on conventions
- Caddy reverse proxy configured (TLS termination ready for production)
- Spec committed at `docs/SPEC.md`, tagged `spec-v1.0`

**Acceptance criteria:**

- `make up && make migrate` succeeds on a fresh checkout
- All four services start (even if they do nothing useful)
- CI passes on `main`
- `kvorum-admin --help` shows the planned command surface (commands stubbed out, not implemented)

**Risks:** trivial. Pure setup work.

### 10.3 M1 — Compound proposals end-to-end

**Duration: 2 weeks.**

**Purpose.** Establish the full ingestion path — from RPC call to API response — for one DAO's proposals. Validate reorg handling correctness _now_, not later.

**Scope:**

- Chain client lib (`libs/chain`): RPC abstraction, multi-provider failover, circuit breakers, EIP-1967 proxy resolution
- Compound Governor adapter (`apps/indexer/sources/compound-governor`): parses `ProposalCreated`, `ProposalCanceled`, `ProposalExecuted`, `ProposalQueued` events
- Append-only event archive Postgres schema (per Section 3.2)
- Reorg detection and handling (per Section 3.4): confirmation-status transitions, `reorg_event` table, append-only invalidation
- `proposal` core entity derivation from archive events
- ABI decoding pipeline (Section 3.8): bundled selector index, bundled ABI library, local-first decoding
- API endpoints: `GET /v1/daos/{slug}/proposals`, `GET /v1/daos/{slug}/proposals/{type}/{id}`
- API auth, rate limiting, ETag caching, error model (per Section 4)
- OpenAPI spec generated and served at `/v1/openapi.json`

**Acceptance criteria:**

- All historical Compound binding proposals indexed (~300 proposals)
- New proposals appear in the API within 4 minutes of execution on Ethereum mainnet
- **Reorg test passes:** Anvil-forked mainnet with synthetic reorg at known block; events transition `pending` → `confirmed` and `pending` → `orphaned` correctly; no data is silently mutated
- Calldata is decoded for >95% of proposals (the long tail can remain `decoded_function = NULL`)
- API returns proposal entities with the response shape committed to in Section 4.7
- Latency: p95 < 500ms on warm cache

**Risks:**

- Reorg handling is the highest-stakes correctness work in v1. Get it wrong here and discover it months later. This milestone exists to force the issue.
- ABI decoding edge cases (proxy upgrades during proposal lifetime, unusual factory patterns). Mitigation: optional Etherscan enrichment is already specified as a fallback (Section 3.8).

**The "would I ship this?" test.** No — proposals without votes is not a usable product. But the foundation is now sound for everything that follows.

### 10.4 M2 — Compound votes and voting power

**Duration: 2 weeks.**

**Purpose.** Complete Compound's governance surface. By the end, Compound is fully browsable and the analytical capabilities have something to work against.

**Scope:**

- `VoteCast` event ingestion → `vote` core entity
- `DelegateVotesChanged` event ingestion → `delegation` event log
- Voting power snapshot job per Section 2.4.6 (computes `voting_power_snapshot` rows at proposal `start_block`)
- API endpoints: `GET /v1/daos/{slug}/proposals/{type}/{id}/votes`, `GET /v1/daos/{slug}/delegates/{address}`
- `actor` entity merging logic (per Section 2.4.3)
- ENS resolution for actor display names (cached, periodic refresh)
- Analytical endpoints (Section 4.6.2) for: voting power concentration, participation, delegate alignment — all initially against Compound only
- ClickHouse analytical mirror populated; daily ETL job from Postgres

**Acceptance criteria:**

- All historical Compound votes indexed (~300k votes)
- Voting power snapshots computed and queryable for every proposal
- Concentration metric returns sensible values matching independent verification
- API supports filtering, sorting, cursor pagination per Section 4.5
- ClickHouse and Postgres returns are consistent for analytical queries

**Risks:**

- Voting power snapshot correctness — historical voting power must reproduce on-chain truth at each block. Test against a known proposal where the result is publicly verifiable (e.g., Compound's UNI distribution proposal).
- ENS resolution rate-limiting from upstream providers. Mitigation: cache aggressively, accept slow first-load for new addresses.

**The "would I ship this?" test.** Yes, narrowly. A Compound-only governance analytics tool is a real product. Not the v1 vision, but a defensible interim release.

### 10.5 M3 — Aave integration

**Duration: 2 weeks.**

**Purpose.** Validate the multi-source schema by adding a structurally different DAO. Aave's Governance v3 has cross-chain execution, which exercises chain-stitching logic.

**Scope:**

- Aave Governance v3 adapter: parses `ProposalCreated`, `ProposalQueued`, `ProposalExecuted` from the mainnet Governance contract
- Cross-chain Payload Controllers: indexers for Polygon, Avalanche, Arbitrum, Optimism, Base, Metis, Gnosis (per Section 2.4.4)
- Cross-chain proposal stitching: linking mainnet proposal to its destination-chain payload executions
- `proposal_action` rows accommodate both mainnet and L2 actions
- Aave-specific ABI library additions (token contracts, staking contracts, common Aave governance targets)
- Existing API endpoints work for Aave with no contract changes
- Analytical endpoints aggregate across both DAOs

**Acceptance criteria:**

- All historical Aave Governance v3 proposals indexed
- For multi-chain proposals, mainnet proposal entity links to all destination-chain payload executions
- Cross-DAO analytical queries return correct combined results
- Schema requires zero changes to accommodate Aave (validating Section 2's unification claim)

**Risks:**

- Aave Governance v3's cross-chain machinery is non-trivial. Lossy execution on a single L2 should not orphan the entire proposal.
- Per Section 9, KNOWN-003 (emergency action governance not modeled) becomes visible during Aave indexing — historical Aave does have emergency executions. Document any encountered edge cases as ADRs.

**The "would I ship this?" test.** Yes. Two-DAO version is a meaningful product; if external pressure forced an early launch, this is the minimum-defensible cut.

### 10.6 M4 — Lido integration

**Duration: 2 weeks.**

**Purpose.** Add the hardest DAO. Lido's hybrid governance (Aragon + Snapshot + Dual Governance) is the schema's stress test. If Lido fits, the unification claim holds.

**Scope:**

- Aragon Voting adapter for Lido's binding proposals
- Snapshot polling adapter (per Section 3.7) for `lido-snapshot.eth` signaling proposals
- Dual Governance state tracking: timelock state, veto signaling
- Lido extension tables (per Section 2.5) for any Lido-specific data not fitting the core schema
- Three `dao_source` rows for Lido: `aragon_voting`, `snapshot`, `dual_governance`
- API exposes the three sources distinctly; no unified "Lido voting power" figure
- Forum thread ingestion (Discourse API) — Lido has the most active research forum, so forum integration ships here
- `forum_thread` and `proposal_forum_link` populated for Lido proposals
- KNOWN-007 closes (resolution recorded as ADR if any spec adjustments needed)

**Acceptance criteria:**

- All three Lido governance tracks ingested correctly
- Snapshot voting power values stored as `voting_power_reported` per DR-008 (verification deferred to v1.1)
- Aragon binding votes correctly distinguished from Snapshot signaling votes in the API response
- A user querying "who voted on this Lido proposal" gets correct results regardless of which source the proposal came from
- Forum threads link to their proposals with `confidence: high|medium|low` per the stitching logic in Section 3.6

**Risks:**

- Lido's Dual Governance is complex; modeling its state correctly may require an ADR amending Section 2 or Section 3
- Snapshot's API has rate limits and occasional inconsistencies between the GraphQL and REST endpoints. Mitigation: prefer GraphQL, cache aggressively
- Forum-to-proposal linking has inherent ambiguity (KNOWN-006). The confidence model in Section 3.6 is the answer; this milestone exercises it for real

**The "would I ship this?" test.** Yes. Three-DAO product is the v1 vision; everything beyond this is polish, not core.

### 10.7 M5 — AI features

**Duration: 2 weeks.**

**Purpose.** Add the four AI features per Section 5. Validate cost discipline at production scale.

**Scope:**

- AI infrastructure (`libs/ai`): LLM client abstraction, structured-output validation against Zod schemas, prompt templating system, batch API integration, content-hash caching, cost logging, hard budget cap enforcement
- Proposal summarizer (Section 5.5) running on all binding proposals (batch) and Snapshot signaling proposals (batch, separate prompt)
- Mismatch detector (Section 5.6) running on all binding proposals with decoded calldata; sync mode for proposals in `active` state
- Forum synthesizer (Section 5.7) running on linked threads; auto-routing between Haiku and Sonnet based on length and contentiousness
- Embedding generation (Section 5.8) for all proposals, populating the `proposal_embedding` table with pgvector
- Similarity search endpoint: `GET /v1/daos/{slug}/proposals/{type}/{id}/similar`
- AI output exposed both embedded in entity responses and via dedicated endpoints
- Grafana dashboard for AI cost and feature health (one of the four dashboards in Section 6.20.2)

**Acceptance criteria:**

- Backfill: all historical proposals have summaries; binding proposals have mismatch analyses; linked forum threads have syntheses; all proposals have embeddings
- New proposals trigger appropriate AI features within their committed latency targets (Section 7.2)
- Total monthly cost under the $41 ceiling during backfill; under $15 in steady state
- Hard budget cap actually disables features at 100% (validated by deliberately lowering the cap and confirming feature disable)
- Mismatch detector validation: hand-curate ~20 historical proposals (mix of consistent and known-discrepancy) and verify the detector's output matches expectations within the 5% false-positive target

**Risks:**

- Mismatch detector quality is the load-bearing claim of the AI work. If it produces too many false positives, the flagship feature is broken. This is the milestone where prompt engineering effort lands.
- Cost overrun during initial backfill — historical proposals plus per-feature costs could exceed the cap before steady state is reached. Mitigation: backfill batched, monitored daily, paused if approaching cap.
- Snapshot voting power "trust" boundary (DR-008) is now visible to users via the AI features — operators may flag this as a concern. The disclosure in Section 6.16 (AI provenance) is the answer.

**The "would I ship this?" test.** Yes. The full v1 backend product is now operating. The frontend is the only major remaining piece.

### 10.8 M5.5 — Dashboard design (parallel)

**Duration: 3 weeks.** Begins concurrent with M5. Mostly creative work; doesn't block backend.

**Purpose.** Produce component-level designs (Level 2 fidelity per the design discussion) sufficient for M6 to implement against.

**Scope:**

- Design system in Figma: color palette, typography scale, spacing tokens, primitives (Button, Card, Badge, Tooltip, Input)
- Cross-page components per Section 6.3: mismatch indicator, AI output panel, voting power figure, delegate identity chip, time freshness indicator, empty/loading/error states
- Page designs (priority order):
  1. Proposal detail page (most-used, exercises most components) — week 1 of design work
  2. DAO landing, DAO health dashboard, proposal list, delegate scorecard — week 2
  3. Homepage, cross-DAO actor page, forum thread page, developer dashboard — week 3
  4. Auth pages, error pages — built directly from spec without dedicated Figma work
- Mobile treatment for the proposal detail page only (per KNOWN-019, other pages defer to v1.1)

**Acceptance criteria:**

- All page designs exported as Figma URLs and committed to `docs/design/figma-links.md`
- Design system implemented as a referenceable library within Figma
- shadcn/ui component mapping documented: which page elements map to which shadcn components, where customization is needed
- A non-designer (i.e., you) can look at any page design and confidently know what to build

**Risks:**

- Design work expanding beyond Level 2 fidelity (perfectionism). Mitigation: hard time-box, accept "good enough" over polished
- Discovering that Section 6's specification is under-specified for design (e.g., what _exactly_ goes in the proposal detail header). Mitigation: write ADRs as you discover gaps

**The "would I ship this?" test.** N/A — designs aren't a shipping artifact, they enable shipping.

### 10.9 M6 — Frontend implementation

**Duration: 2 weeks** (with one week overlapping M5.5).

**Purpose.** Build the dashboard against the now-frozen designs.

**Scope:**

- Next.js application bootstrap with Tailwind and shadcn/ui
- Component library implemented from M5.5 designs
- All page types per Section 6.2 (15 page types in total: 11 functional + auth + error)
- Routing matching the URL contracts in Section 6
- Server-side rendering for SEO-relevant pages (proposal detail especially)
- SIWE auth flow + email/password fallback (Section 6.14)
- ETag-driven polling for active proposal tally updates (Section 6.16)
- Accessibility pass per Section 6.19
- Plausible (or equivalent) analytics integration

**Acceptance criteria:**

- All 15 page types render with real data
- Polling on active proposals updates tally within ~10 seconds
- Auth flow works end-to-end (signup, login, forgot password, account deletion)
- Mobile responsive at the proposal detail page; degraded-graceful elsewhere per KNOWN-019
- Lighthouse score: Performance ≥ 80, Accessibility ≥ 95, Best Practices ≥ 90, SEO ≥ 95
- Manual smoke test of all primary user flows passes

**Risks:**

- Frontend work always takes longer than expected. Mitigation: page priority is enforced — proposal detail must work; cross-DAO actor page can ship at minimum-viable if needed
- Real data revealing design issues that didn't surface in mockups. Mitigation: design adjustments captured as ADRs; defer cosmetic polish

**The "would I ship this?" test.** Yes — this is the v1 product complete.

### 10.10 M7 — Operational hardening and launch prep

**Duration: 1 week.**

**Purpose.** Make the product runnable in production. Set up monitoring, backups, status page, and prepare launch.

**Scope:**

- Production deployment to Hetzner CX32 (Section 7.1)
- All four Grafana dashboards live (Section 6.20.2)
- All seven alerting rules configured with routing (Slack/email)
- Postgres backup automation: daily logical, continuous WAL archiving to off-host storage
- DR drill: restore backup to a separate environment, verify integrity (Section 7.5)
- Self-hosted Uptime Kuma status page at `status.kvorum.example`
- Privacy policy at `/privacy`
- Status indicators on the dashboard (degraded modes per Section 7.3)
- Smoke test suite running against production every 5 minutes from external monitoring
- Launch announcement drafted (Twitter, dev.to, governance forums)

**Acceptance criteria:**

- 7 consecutive days of stable production operation before launch announcement
- Backups verified by successful test restore
- All monitoring dashboards green
- Status page reflects real operational state
- Privacy policy live
- Launch post drafted, reviewed, ready to publish

**Risks:**

- Deployment surprises (TLS, DNS, container networking quirks specific to production environment). Mitigation: deploy to production at start of week, debug from there
- Cost overrun during the 7-day stabilization period (LLM backfill costs hitting users early). Mitigation: review cost dashboards daily

**The "would I ship this?" test.** Yes — and this is the moment v1.0 is real.

### 10.11 Post-launch (week 14+)

**Not a milestone, but worth flagging.** The first 30 days post-launch are the operational shakedown:

- Monitor cost dashboards daily; tune AI caps if reality diverges from estimates
- Triage incoming feedback (likely sources: Twitter, GitHub issues, governance forums)
- File ADRs for any spec amendments forced by reality
- Begin v1.1 design conversations (pending visibility, Snapshot verification, streaming protocols)

The spec lifecycle (top of document) becomes operational at this point. ADR-001 onward captures the project's evolution from here.

### 10.12 Sequencing flexibility and what could shift

This milestone breakdown is a recommendation, not a contract. Real-world sequencing might shift in defensible ways:

**M3 (Aave) and M4 (Lido) could swap.** Lido is harder; doing it second lets the Aave work simplify it. But doing Lido second means schema validation against the hardest case happens later. Either is defensible. Recommended order is Aave-then-Lido to avoid front-loading too much risk.

**M5 (AI) could come before M3-M4.** Making AI work against just Compound proves the AI infrastructure earlier. But it locks AI prompts into Compound-shaped data and may require revision when Aave/Lido are added. Not recommended unless AI feedback loop dominates.

**M6 (Frontend) could come before M5 (AI).** A working dashboard with no AI features is still a product. But late-stage AI integration into existing dashboard pages is more work than designing them in. Not recommended.

**M5.5 (Design) could shift earlier.** Designs can begin as soon as Section 6 is settled (now). Earlier design start risks designing against a backend that doesn't exist yet, but the spec's per-page specifications are detailed enough that this is manageable.

**Solo developer reality.** Real life intervenes. A 14-week plan executed at hobby pace likely takes 5–7 calendar months. That's fine. The dependencies between milestones are real but the wall-clock duration is flexible.

### 10.13 What this section does not address

Out of scope:

- Marketing strategy and launch tactics — Section 7.10 references release notes and `/changelog` but the launch playbook (where to post, who to talk to, what to demo) is operator's craft, not spec
- Hiring plan — v1 is single-operator by design (Section 7.6, KNOWN-022). If Kvorum scales to need additional contributors, that's post-v1.
- Funding and revenue strategy — KNOWN-022 records that v1 doesn't commit to commercial paths; revisit if Kvorum becomes meaningful enough to require it
- Detailed task breakdown within milestones — that's GitHub Issues / project board territory, not spec

Open questions:

- Whether to publish weekly or biweekly progress updates during implementation. Public progress builds momentum and accountability; it also adds time-tax. Leaning toward biweekly written posts during weeks 2–13, weekly during week 14 (launch run-up).
- Whether to set up a private alpha during M4 or M5 (governance researchers and DAO operators using the API before public launch). Reduces launch-day surprises but adds support burden during build. Leaning toward no — public launch direct from M7, with the status page and quick rollback as the safety net.

---

_Section 10 ends here. This is the final section of the v1.0 spec._
