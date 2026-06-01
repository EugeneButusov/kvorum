# ADR-0067: Chain-aware vote projection

- **Status**: Accepted
- **Date**: 2026-06-01
- **Amends**: 0062
- **Related**: 0064, 0021, epic #239, R2 #249, Epic T

## Context

R2 introduces Aave-ready multi-chain vote derivation. Vote rows must preserve the chain where a
vote was cast, while keeping Compound behavior unchanged and retaining current dedup semantics.

The vote pipeline is the CH `vote_events_raw` -> `vote_events_mv` -> `vote_events_agg` ->
`vote_events_projection` argMax flow from ADR-0062.

## Decision

- Add `voting_chain_id` to `vote_events_*`.
- `voting_chain_id` is the archive row `chain_id` (the voting chain).
- In `vote_events_raw`, `voting_chain_id` is `LowCardinality(String) DEFAULT '0x1'`.
- Keep `vote_events_agg` sorting key unchanged (no `voting_chain_id` in key for v1.0).
- Include `voting_chain_id` in MV/projection `GROUP BY` and `SELECT` lists.

Why this is safe:

- The chain is functionally dependent on each vote event.
- Existing `(dao_id, proposal_id, voter_address)` sort-key/query behavior is preserved.
- Compound remains `0x1`; dedup semantics are unchanged.

`findCurrentVote` remains without a chain predicate. The invariant is one voting chain per
`(dao_id, proposal_id, voter_address)` for a given vote stream. Assertion/test hardening lands in
Epic T.

API surfacing of `voting_chain_id` is deferred to Epic T.

## Production rebuild procedure for populated ClickHouse

This procedure is documented for populated instances; R2 pre-prod uses in-place migration edit on
fresh DBs.

1. Stop derivation workers (no live inserts into `vote_events_raw`).
2. `ALTER TABLE vote_events_raw ADD COLUMN voting_chain_id LowCardinality(String) DEFAULT '0x1'`.
3. Drop in order: `vote_events_projection`, `vote_events_mv`, `vote_events_agg`.
4. Recreate `vote_events_agg`, then `vote_events_mv`, then `vote_events_projection` with the new
   key/grouping shape.
5. Backfill agg from raw using `argMaxState(...)` and `GROUP BY ... voting_chain_id`.
6. Resume derivation workers.
7. Verify row counts/sampled values before and after rebuild.

Stopping workers is mandatory; otherwise inserts occurring between drop/recreate are not
materialized into agg.

## Consequences

- Vote projection is chain-aware while preserving current Compound behavior.
- Aave vote ingestion can project correct voting chains in Epic T.
- Local persisted ClickHouse instances must be wiped/recreated when replaying the in-place `core_001`
  edit because `clickhouse-migrations` checksum guards detect file changes.
