# ADR-049 — On-chain state reconciliation for event-silent governor transitions

**Status:** Accepted  
**Date:** 2026-05-18

---

## Context

The current proposal lifecycle in the indexer is event-driven. For Compound Governor Bravo-style sources, projection advances from on-chain events (`ProposalCreated`, `ProposalQueued`, `ProposalExecuted`, `ProposalCanceled`).

Two real transitions have no authoritative event in this model:

- `pending`/`active`/`succeeded` proposals can end as `defeated` after voting closes.
- `queued` proposals can become `expired` after timelock grace elapses.

Because those transitions are event-silent, rows can remain stale (`pending` or `queued`) indefinitely unless corrected by external intervention. Issue #133 confirmed this with concrete stale rows in Compound Bravo.

Manual SQL updates can patch known rows, but they do not provide a systemic, replay-safe fix for ongoing ingestion, existing backlog, and future backfills.

## Decision

Add a confirmed-head-driven proposal state reconciler that performs bounded on-chain classification for reconcilable governor sources.

1. Candidate selection is SQL-gated by per-chain confirmed thresholds and proposal deadline class:

- voting deadline (`voting_ends_block`) for `pending`/`active`/`succeeded`
- timelock deadline (`timelock_eta + GRACE_PERIOD`) for `queued`

2. Classification uses `state(uint256)` read at the confirmed-threshold block.

3. Reconciler writes only event-silent transitions:

- allowed writes: `defeated`, `expired`, `active`
- if on-chain state is `executed`, `queued`, or `canceled` while local state is non-terminal, treat as `missed_event`: emit error/metric and do not write state.

4. Add reconcile watermarking (`last_reconcile_check_block`) to bound re-check frequency and prevent starvation from permanently reselected rows.

5. Keep source applicability explicit in the reconciler `sourceTypes` list.

6. Persist `timelock_eta` from `ProposalQueued` projection so `expired` timestamps derive from on-chain ETA + validated grace.

7. Resolve `GRACE_PERIOD` from timelock with strict bounds validation and explicit env fallback; never coalesce invalid reads to `0`.

8. Split transient RPC errors from decode-domain errors:

- transient per-row failures continue with warnings/escalation after threshold
- decode-domain mismatch (`state` code out of range) fails loudly and circuit-breaks that source tick.

## Consequences

- Stale event-silent states are corrected without manual SQL.
- Backfill and live ingestion share the same reconciliation path for this class of mismatch.
- State timestamp provenance remains authoritative:
- `defeated` and `active` use block timestamps (`eth_getBlockByNumber`)
- `expired` uses `timelock_eta + GRACE_PERIOD`
- authoritative-event states are never overwritten by reconciler guesses.
- RPC cost is bounded by watermark gap and batch size, with explicit observability (`state_reconcile_*` metrics).
- `compound_governor_alpha` remains excluded from reconciliation; `compound_governor_bravo` and `compound_governor_oz` are included.

## Alternatives considered

- Manual one-off SQL correction: rejected as non-systemic and non-repeatable.
- Derive defeat from vote-tally/quorum math only: rejected due to governor-logic duplication and higher correctness risk.
- External subgraph dependency: rejected to keep ingestion correctness anchored to chain RPC + internal persistence.

## Operational notes

- Deployment requires RPC support for historical block headers (`eth_getBlockByNumber`) and confirmed-threshold `eth_call` for `state()`.
- A full node is sufficient for block-header timestamp reads; providers that prune required historical headers are unsupported for this reconciler path.
- Eventual consistency target for newly eligible rows is one confirmed-head cadence plus one batch cycle.

---

## Amendment — 2026-05-24 (ADR-058)

The "confirmed head" read by the reconciler's candidate-selection query now comes from `readConfirmedHead(rpcClient, chainConfig)` (introduced in ADR-058) rather than from promotion-sweep-driven row promotion. The reconciler's algorithm and SQL-gate logic are otherwise unchanged.

## Amendment — 2026-06-02 (Aave Governance v3)

Aave Governance v3 joins the reconciled source set with a narrower write surface than Compound.

### Source applicability

- included: `aave_governance_v3`
- deferred: `aave_governor_v2`

### Aave reconcile model

1. Candidate selection is gated by local state plus reconcile watermark only.

- eligible states: `pending`, `active`, `queued`
- watermark field: `aave_proposal_metadata.last_reconcile_check_block`
- chain scoping reads `dao_source.chain_id`

2. Classification uses `getProposalState(uint256)` at the confirmed-threshold block.

3. Allowed reconciler write set is `expired` only.

- `active` is event-driven by `VotingActivated`
- `defeated` is event-driven by `ProposalFailed`
- `queued`, `executed`, and `canceled` are event-driven on mainnet

4. Event-driven divergence is treated as `missed_event`.

- if on-chain state disagrees with local state for any event-driven transition, emit error and metric
- do not write reconciled state for that row

5. `expired` timestamp provenance is `blockTimestamp(creation_block) + PROPOSAL_EXPIRATION_TIME`.

- `creation_block` comes from `aave_proposal_metadata`
- `PROPOSAL_EXPIRATION_TIME()` is resolved from the governance contract and cached with bounds validation

### Consequences

- Aave reconcile is simpler than Compound because it corrects exactly one event-silent transition.
- A missed `VotingActivated` or `ProposalFailed` event is surfaced operationally rather than papered over by a guessed state write.
- `aave_governance_v3_reconcile` can share the generic reconcile driver while keeping Aave-specific state semantics local.
