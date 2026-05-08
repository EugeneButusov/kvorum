# ADR-023 — `primary_choice` scoped to single-choice voting types

- **Status**: Proposed
- **Date**: 2026-05-08
- **Spec sections affected**: 2.4.7

## Context

SPEC §2.4.7 introduces `vote.primary_choice` as a denormalization for fast for/against aggregations: "the highest-weight choice index for this vote, used for fast aggregation." The field is defended as presentational, with `vote_choice` retained as the source of truth.

For binary and approval voting the denormalization is harmless. For Snapshot's other voting types it is misleading:

- **Ranked-choice**: `choice_index` carries the rank ordering, not weight. The "highest-weight" interpretation has no meaning.
- **Weighted**: a vote may legitimately split 60/40 across two options; the higher-weight index is not the voter's "real" choice.
- **Quadratic**: same problem as weighted — multi-option allocations cannot collapse to a single index.

A dashboard for/against bar built on `primary_choice` would silently misrepresent these vote types. Worse, an analytical query joining on `primary_choice` to compute concentration would produce numbers that look correct.

## Decision

`vote.primary_choice` is populated only for vote types where one choice index unambiguously represents the vote:

| Source voting type | `primary_choice` populated |
|---|---|
| Compound / Aave / Aragon (binary + abstain) | Yes |
| Snapshot `single-choice` | Yes |
| Snapshot `basic` (For / Against / Abstain) | Yes |
| Snapshot `approval` | Yes — but interpreted as "any approved choice"; the dashboard uses `vote_choice` directly when displaying approval results |
| Snapshot `weighted` | NULL |
| Snapshot `ranked-choice` | NULL |
| Snapshot `quadratic` | NULL |

Aggregation queries that use `primary_choice` either filter to populated rows or join to `vote_choice` for the NULL cases. The repository layer exposes a `tallyByChoice(proposalId)` helper that handles both paths transparently.

## Alternatives considered

- **Define `primary_choice` as the highest-weight index for weighted/quadratic.** Permits a fast-but-wrong aggregation. The performance gain (one row vs. several) is not worth a misleading column.
- **Remove `primary_choice` entirely; always join `vote_choice`.** Cleanest semantically. Costs ~5–10% on the binary-tally hot path. Defensible if benchmarking shows the join is cheap; for now the denormalization stays for the case it actually helps.
- **Compute `primary_choice` lazily in the tally view rather than storing it.** Same end result; loses the convenient index for the binary case.

## Consequences

- The index `(proposal_id, primary_choice)` continues to work for binary tallies — most of the dashboard's tally bars.
- Non-binary Snapshot proposals (rare in v1; some Lido signaling proposals use ranked-choice) compute their tallies from `vote_choice`. The dashboard's tally panel for those proposals uses a type-appropriate visualization rather than for/against (already the design intent in §6.9, now formally enforced).
- The dashboard component for tally rendering switches on the proposal's `voting_type` and chooses its data source; no silent misrepresentation is possible.
- Schema migration: `primary_choice` becomes nullable (it was previously implied non-null since "highest-weight" always exists).
