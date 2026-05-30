# ADR-021 — Vote supersession model for Snapshot vote changes

- **Status**: Accepted
- **Date**: 2026-05-08
- **Spec sections affected**: 2.4.7, 2.8 (invariant 2), 4.2, 4.6.1
- **Amends**: 0062, 0063
- **Related**: DR-006

## Context

The v1.0 spec contains a contradiction. SPEC §2.8 invariant 2 declares that vote rows are append-only after final confirmation. SPEC §4.2 says "vote changes overwrite the previous vote in the source system." Snapshot allows a voter to replace their vote any number of times before the proposal closes; both statements cannot be true.

The append-only stance is consistent with the rest of Kvorum's archive philosophy (DR-006). Overwriting in place would lose the audit trail of how a voter's position evolved during a contentious vote — a piece of analytical signal Kvorum is otherwise built to preserve.

## Decision

Vote rows are append-only. When a voter replaces their vote on Snapshot (or any future source that supports replacement), Kvorum inserts a new row into `vote_events_projection` (CH); the prior current row gets re-inserted with `superseded = 1` + `superseded_at` + `superseded_by_vote_id` populated. `ReplacingMergeTree(version)` collapses the prior row on read via `FINAL`.

- ~~`superseded_by_vote_id` — nullable FK to `vote.id`, NULL for current votes~~ → `superseded_by_vote_id Nullable(UUID)` — audit pointer to the row that supersedes this one (not an FK; CH has no referential integrity). _Superseded 2026-05-28 by ADR-0062 — see Amendment below._
- ~~A partial unique index on `(proposal_id, voter_actor_id) WHERE superseded_by_vote_id IS NULL` to enforce one current vote per voter per proposal~~ → Uniqueness of the current row per `(dao_id, proposal_id, voter_address)` is enforced by the `SELECT FINAL → INSERT` supersession sequence under the single-worker-per-protocol invariant (ADR-0062), not by an index. CH cannot enforce partial uniqueness. _Superseded 2026-05-28 by ADR-0062 — see Amendment below._

The "current vote" view is `WHERE superseded = 0`. All tally calculations and the default `GET .../votes` response use this filter. A new query parameter `?include_superseded=true` returns the full history; the single-vote endpoint `GET .../votes/{voter_address}` returns the current vote by default with a `superseded` array in the payload when history exists.

## Alternatives considered

- **Overwrite the row in place.** Conflicts with §2.8 invariant 2; loses the audit trail; inconsistent with the append-only archive philosophy.
- **Soft-delete with `deleted_at`.** Same data-loss pattern; adds a state to reason about without preserving the supersession relationship.
- **Store history in a parallel `vote_history` table.** Creates two sources of truth for "did this voter vote on this proposal?"; doubles the write path.

## Consequences

- Tally and aggregation queries must filter `superseded = 0` (or use a view that wraps this). The repository layer enforces the filter as the default; explicit history queries opt out.
- The `cast_at` of a superseded row remains the original cast time; the new row carries a fresh `cast_at`. Time-travel queries ("what was the tally at time T") use `WHERE cast_at <= T AND (superseded = 0 OR superseded_at > T)`, requiring `superseded_at` (NEW field) on the prior row. This is added to the migration.
- Storage cost is trivial — vote replacement is rare even on contentious Snapshot proposals.
- The `reason` field on a superseded vote is preserved; analysts can study how rationale changed alongside choice.

## Amendment — 2026-05-28 (CH cutover per ADR-0062)

Storage moved from PG to CH `vote_events_projection` (`ReplacingMergeTree(version)`, ORDER BY `(dao_id, proposal_id, voter_address, block_number, log_index, vote_id)`). Boolean `superseded` UInt8 + audit pointers `superseded_at` (Nullable DateTime64(3)) + `superseded_by_vote_id` (Nullable UUID) preserve the supersession graph.

Server-side `version DateTime64(6) DEFAULT now64(6)` is the version column; appliers **MUST** omit it on insert.

Implementation pattern: dao-scoped `SELECT FINAL WHERE dao_id = ? AND proposal_id = ? AND voter_address = ? AND superseded = 0` finds the prior current vote; the applier compares `cast_at` (with `(block_number, log_index)` tiebreaker) to decide chronological role; emits 1 or 2 rows depending on whether the incoming event supersedes the prior or arrives late (replay).

**Load-bearing invariant:** Single-worker-per-protocol (ADR-0062) makes the `SELECT FINAL → INSERT` sequence naturally serialised per `(proposal_id, voter_address)`. Without this invariant, two concurrent writers could both observe no prior current vote and each insert a `superseded = 0` row, violating the "one current vote per voter per proposal" property. M3+ multi-worker scale-out requires revisiting this.

Semantic API contract unchanged: `WHERE superseded = 0` is the "current vote" view; `?include_superseded=true` returns history.

PG `vote` table was **removed in PR-2 #221** (in-place edit to migration `0005_vote_delegation.ts`, not a separate drop migration).

Cite ADR-0062, PR #220, PR #221.

## Amendment — 2026-05-30 (single-worker ordering constraint — Epic 1 scope, superseded in Epic 2)

The "load-bearing invariant" added in the 2026-05-28 amendment — single-worker-per-protocol makes the `SELECT … → INSERT` supersession sequence naturally serialised — is preserved for Epic 1 (`localConcurrency = 1` on the `archive_log` consumer, ADR-0063).

In Epic 2 (co-timed with M5), vote/delegation projections will be made **order-independent**, removing the need for `localConcurrency = 1` and enabling intra-protocol parallelism. At that point this invariant is superseded; it must not be cited as a hard constraint in new code past Epic 2.

Cite ADR-0063, epic #227.
