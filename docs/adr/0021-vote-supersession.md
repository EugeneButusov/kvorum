# ADR-021 — Vote supersession model for Snapshot vote changes

- **Status**: Accepted
- **Date**: 2026-05-08
- **Spec sections affected**: 2.4.7, 2.8 (invariant 2), 4.2, 4.6.1
- **Related**: DR-006

## Context

The v1.0 spec contains a contradiction. SPEC §2.8 invariant 2 declares that vote rows are append-only after final confirmation. SPEC §4.2 says "vote changes overwrite the previous vote in the source system." Snapshot allows a voter to replace their vote any number of times before the proposal closes; both statements cannot be true.

The append-only stance is consistent with the rest of Kvorum's archive philosophy (DR-006). Overwriting in place would lose the audit trail of how a voter's position evolved during a contentious vote — a piece of analytical signal Kvorum is otherwise built to preserve.

## Decision

Vote rows are append-only. When a voter replaces their vote on Snapshot (or any future source that supports replacement), Kvorum inserts a new `vote` row and sets `superseded_by_vote_id` on the prior row to point at the new one. The `vote` table gains:

- `superseded_by_vote_id` — nullable FK to `vote.id`, NULL for current votes
- A partial unique index on `(proposal_id, voter_actor_id) WHERE superseded_by_vote_id IS NULL` to enforce one current vote per voter per proposal

The "current vote" view is `WHERE superseded_by_vote_id IS NULL`. All tally calculations and the default `GET .../votes` response use this filter. A new query parameter `?include_superseded=true` returns the full history; the single-vote endpoint `GET .../votes/{voter_address}` returns the current vote by default with a `superseded` array in the payload when history exists.

## Alternatives considered

- **Overwrite the row in place.** Conflicts with §2.8 invariant 2; loses the audit trail; inconsistent with the append-only archive philosophy.
- **Soft-delete with `deleted_at`.** Same data-loss pattern; adds a state to reason about without preserving the supersession relationship.
- **Store history in a parallel `vote_history` table.** Creates two sources of truth for "did this voter vote on this proposal?"; doubles the write path.

## Consequences

- Tally and aggregation queries must filter `superseded_by_vote_id IS NULL` (or use a view that wraps this). The repository layer enforces the filter as the default; explicit history queries opt out.
- The `cast_at` of a superseded row remains the original cast time; the new row carries a fresh `cast_at`. Time-travel queries ("what was the tally at time T") use `WHERE cast_at <= T AND (superseded_by_vote_id IS NULL OR superseded_at > T)`, requiring `superseded_at` (NEW field) on the prior row. This is added to the migration.
- Storage cost is trivial — vote replacement is rare even on contentious Snapshot proposals.
- The `reason` field on a superseded vote is preserved; analysts can study how rationale changed alongside choice.
