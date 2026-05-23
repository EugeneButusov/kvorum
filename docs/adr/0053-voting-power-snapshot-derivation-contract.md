# ADR-053 - Voting power snapshot derivation contract

- **Status**: Accepted
- **Date**: 2026-05-23
- **Related**: ADR-022, ADR-041
- **Issue**: #174

## Context

Epic L requires a deterministic worker that writes one `voting_power_snapshot` row per actor for each Compound proposal that has reached an eligible post-`pending` state. The worker must stay idempotent per proposal, verify derived results against chain truth, and degrade safely on RPC or process failures.

## Decision

1. Introduce `VotingPowerStrategy` as a whole-snapshot contract:
   - `computeSnapshot(block, { daoId }) -> ComputedActorPower[]`
   - `verifyOnChain(address, block, { daoId }) -> bigint`
2. For Compound, snapshot derivation is computed from persisted `delegation` history ordered by `(block_number, tx_index, log_index)`.
3. Population set is `delegators U delegates` up to `voting_power_block`; every actor in the set receives a row, including zero-power actors.
4. Verification policy is sample-first:
   - Sample 20 addresses from inserted snapshot rows.
   - Any mismatch triggers full on-chain fallback re-derivation for the proposal.
5. Full fallback uses per-call retry with backoff (`3` attempts; `200ms`, `600ms`, `1800ms`) before failing the proposal attempt.
6. Per-proposal attempt state is persisted in `voting_power_snapshot_run` with `status` (`in_progress`, `completed`, `failed`) and `snapshot_attempt_count`.
7. Retry semantics:
   - If a proposal has an `in_progress` run row on the next tick, delete existing `voting_power_snapshot` rows for that proposal and recompute.
   - Route to DLQ when `snapshot_attempt_count >= 5`.
8. DLQ retry must be stage-aware (snapshot/projection/archive adapters), not archive-payload-only.

## Consequences

- Snapshot computation is deterministic and auditable from PostgreSQL state.
- Worker retries are crash-safe and idempotent at proposal granularity.
- RPC budget remains bounded in steady state (sample path) while preserving correctness (fallback path).
- The L3 acceptance criterion for fallback validation is satisfied by integration testing, replacing runtime fault injection.
