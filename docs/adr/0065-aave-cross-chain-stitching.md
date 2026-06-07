# ADR-065 — Aave cross-chain stitching contract

**Status:** Accepted  
**Date:** 2026-06-02

---

## Context

Aave Governance v3 splits one logical governance action across multiple chains and contracts:

- mainnet `Governance` creates and finalizes proposals
- one voting chain `VotingMachine` receives bridged voting state and emits votes
- one or more destination-chain `PayloadsController` contracts execute payloads independently

The ingestion and derivation layers therefore cannot treat proposal, vote, and payload rows as a single in-order event stream on one chain. Proposal creation can arrive before or after voting-machine rows or payload rows. Payload execution on one destination chain can succeed while another payload remains queued, expires, or is never observed because the target chain is not indexed.

Epic T and Epic U need an explicit stitching contract before implementation so they do not invent incompatible retry, correlation, or failure semantics.

## Decision

Adopt the following stitching contract for Aave Governance v3.

1. Correlate payload executions by the triple `(target_chain_id, payloads_controller_address, payload_id)`.

- `payload_id` is not globally unique.
- It is sequential only within one payloads controller on one chain.
- `bridge_message_id` is optional enrichment and is not required for correctness.

2. Correlate voting rows to a proposal by `(dao_id, proposal_id)`.

- A proposal routes to exactly one voting network.
- The `(proposal, voter)` supersession read key therefore remains chain-free.

3. Out-of-order arrival is an indefinite hold, not a DLQ stage.

- If a vote row or payload row arrives before its proposal exists, the row remains underived with reason `no_proposal`.
- `no_proposal` does not increment DLQ counters and is not bounded by an attempts budget.
- Re-drive uses a periodic sweep of underived rows plus normal derivation retries; the hold is visible backlog, not a silent terminal state.

4. Stitch observability is time-based, not count-based.

- The primary signal is `indexer_stitch_pending_seconds`.
- Alert when stitching backlog exceeds an agreed time threshold (for example, stuck for multiple hours), not when a retry count is exceeded.

5. Payload execution is lossy per payload, not per proposal.

- Each `aave_proposal_payload` row advances independently through its own status lifecycle.
- Failure, cancellation, expiry, or missing execution on one destination chain does not mutate the proposal state and does not degrade sibling payload rows.
- `executed_at_destination` is set only when that payload actually executes.

6. Unindexed destination chains are explicit partial knowledge.

- If a payload targets a chain Kvorum does not index, persist the row as `status='declared'` with an `unindexed_target_chain` marker in the stitching layer.
- Do not leave the row in an implicit perpetual-null state.

7. Single-voting-chain is a guarded invariant.

- One proposal must resolve to one `voting_chain_id`.
- If derivation ever observes two voting chains for the same logical proposal/voter surface, fail loudly and alert.
- Never apply silent last-write-wins behavior.

8. Settlement reverts on optimistic L2s remain manual-recovery scope.

- A payload execution accepted past `headLag` on an optimistic L2 can still be reverted later at settlement.
- Kvorum does not architect an automatic recovery loop for this edge case in v1.
- Recovery follows the ADR-059 manual rewind path.

9. The stitch hold is not part of `aave_*_archive_write` DLQ staging.

- Archive write remains a separate correctness plane from derivation-time proposal correlation.

## Consequences

- Epic T and Epic U share one correlation contract instead of source-local heuristics.
- Legitimate bridge latency is tolerated without false orphaning.
- Operators get one backlog-age signal for stitching health.
- Partial cross-chain execution is represented faithfully instead of forcing one aggregate proposal status to encode all payload outcomes.
- Future bridge-message enrichment can be added without rewriting the primary correlation key.

## Alternatives considered

- Use `payload_id` alone as the payload key: rejected because it is only controller-local.
- Treat missing proposal correlation as DLQ with bounded retries: rejected because cross-chain latency can exceed any reasonable retry budget.
- Collapse all payload outcomes into proposal-level failure: rejected because Aave execution is independently lossy per destination payload.
- Require `bridge_message_id` for correctness: rejected because it is useful enrichment but not necessary for deterministic stitching.

## Amends (T3)

- Vote derivation records `held` for indefinite `no_proposal` rows and `noop` for terminal no-op derives.
- `ProposalResultsSent` and `ProposalVoteConfigurationBridged` are ingested but derived as terminal no-ops so `aave_voting_machine` underived backlog can clear.
- The `voting_chain_id` / `voting_machine_address` binding comes from `ProposalVoteStarted` activation plus the first `VoteEmitted` per proposal; `ProposalVoteConfigurationBridged` is not a binding source.
- `indexer_stitch_pending_seconds` is emitted with labels `{voting_chain_id, source_type, event_type}`.

## Operational notes

- The underived-row sweep and retry carrier must be preserved when Epic T implements this contract; "indefinite hold" is not permission to leave rows without a re-drive path.
- Alerting should key off age, not row count.
