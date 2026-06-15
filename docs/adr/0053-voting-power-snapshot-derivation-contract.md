# ADR-053 - Voting power snapshot derivation contract

- **Status**: Withdrawn (M3 V3 #262 — feature retired)
- **Date**: 2026-05-23
- **Amends**: 0062
- **Related**: ADR-022, ADR-041
- **Issue**: #174, #261, #262

## Context

Epic L requires a deterministic worker that writes one row into CH `voting_power_snapshot_projection` (post-ADR-0062 — PG `voting_power_snapshot` table removed in PR-2 #221) per actor for each Compound proposal that has reached an eligible post-`pending` state. The worker must stay idempotent per proposal and degrade safely on RPC or process failures. _Superseded by ADR-0062._

## Decision

1. Introduce `VotingPowerStrategy` as a whole-snapshot contract:
   - `computeSnapshot(block, { daoId }) -> ComputedActorPower[]`
2. For Compound, snapshot derivation is computed from CH `delegation_flow_projection` ordered by `(block_number, log_index, delegation_id)` — PG `delegation` table removed in PR-2 #221; CH `delegation_flow_projection` ORDER BY is `(dao_id, delegator_address, block_number, log_index, delegation_id)` with `delegator_address` as dedup key (delegation is not proposal-scoped). _Superseded by ADR-0062._
3. Population set is `delegators U delegates` up to `voting_power_block`; every actor in the set receives a row, including zero-power actors.
4. Per-proposal attempt state is persisted in `voting_power_snapshot_run` with `status` (`in_progress`, `completed`, `failed`) and `snapshot_attempt_count`.
5. Retry semantics:
   - If a proposal has an `in_progress` run row on the next tick, delete existing `voting_power_snapshot` rows for that proposal and recompute.
   - Route to DLQ when `snapshot_attempt_count >= 5`.
6. DLQ retry must be stage-aware (snapshot/projection/archive adapters), not archive-payload-only.

## Consequences

- Snapshot computation is deterministic and auditable from CH `delegation_flow_projection` + `voting_power_snapshot_projection` state. _Superseded by ADR-0062._
- Worker retries are crash-safe and idempotent at proposal granularity.
- The worker no longer depends on per-proposal chain re-verification for correctness.

## Amendment — 2026-05-28 (storage moves to CH; retry semantics revised; shipped deviation flagged as known incorrect)

**Storage.** Decision §1's per-actor `voting_power_snapshot` row moves from PG to CH `voting_power_snapshot_projection` (`ReplacingMergeTree(version)`). Dedup key changes from PG's `(actor_id, proposal_id)` to CH's `(dao_id, proposal_id, actor_address)` — **address-keyed**, not actor-keyed. Read semantics for "actor A's voting power on proposal P" = SUM over A's currently-resolving addresses via the CH `actor_address_redirect` Dictionary, with `actor_id_hint Nullable(UUID)` as a Dictionary-miss fallback (`coalesce(dictGetOrNull(…), vps.actor_id_hint, '')` at `voting-power-snapshot-projection-read-repository.ts:22,41`). `computed_at DateTime64(3)` records when the snapshot was materialised.

**Why address-keyed.** Two actors X, Y both holding snapshots on the same proposal P would double-count after X→Y merge under actor-keyed dedup; address-keyed reads naturally re-group at SUM time.

**`voting_power_snapshot_run` PG table is retained.** Decision §6's per-proposal `voting_power_snapshot_run` (`in_progress`/`completed`/`failed`, `snapshot_attempt_count`) stays in PG — small mutable OLTP table for worker bookkeeping (`libs/db/migrations/0007_voting_power_snapshot_run.ts`). Only the **row data** moved to CH.

**Retry semantics — intended contract.** Decision §7's "delete existing rows and recompute" is **withdrawn**. Intended contract under CH: re-compute and re-insert with a fresher `version`; `ReplacingMergeTree + FINAL` keep the latest; do not issue `ALTER TABLE … DELETE` (async mutations create a sample-verification race window).

**Known incorrect shipped behaviour (follow-up issue #<NNN> — D14 sharp framing).** `libs/db/src/voting-power-snapshot-projection-read-repository.ts:8` issues `ALTER TABLE voting_power_snapshot_projection DELETE WHERE proposal_id = ?` from application code; line 50 issues `ALTER TABLE … UPDATE`. **This shipped code is known incorrect with respect to the intended contract above** — the async-mutation race window it opens is precisely the issue §7 was designed to prevent. The rewrite to version-overwrite + FINAL is **scheduled** under follow-up issue #<NNN>; this deviation must not be treated as an accepted variant.

**Atomicity contract revised.** Decision §1's "atomic per-proposal snapshot row write" becomes per-`(actor_address, proposal_id)` row atomicity (CH INSERT is atomic per row). The whole-proposal atomicity is rebuilt at the worker level: compute all addresses' rows in memory, then bulk insert; on partial failure the run row stays `in_progress` and the retry recomputes with a fresher `version` over all rows.

Cite ADR-0062 + PR #220 + PR #221 + issue #261 + follow-up issue #<NNN>.

## Amendment — 2026-06-11 (sample verification withdrawn)

Issue #261 withdraws the sample-verification design introduced above.

- `VotingPowerStrategy.verifyOnChain` is removed from the contract; snapshot strategies now expose only `computeSnapshot`.
- `voting_power_snapshot_run` keeps `status`, `snapshot_attempt_count`, `last_error`, and row-count bookkeeping for compute retry/DLQ only. Verify-era columns `sample_size` and `fallback_engaged` are dropped.
- Correctness now rests on authoritative vote-reported power for voter-derived strategies and deterministic event-derived snapshot computation for Compound, plus ingestion completeness guards and integration coverage.
- DLQ routing still applies to compute failures, but `archive_chain_id` is sourced from the proposal's DAO chain context instead of a hardcoded value.

## Amendment — 2026-06-14 (feature retired)

The voting-power snapshot feature is retired in M3 V3 (#262). `VotingPowerStrategy`, the `voting_power_snapshot_run` PG table, and all CH `voting_power_snapshot_*` tables are removed. Voter power now lives on the vote row (`vote_events_projection.voting_power`); cross-DAO analytics read votes/delegation directly. This ADR is withdrawn (feature retired); it is preserved for historical record only.
