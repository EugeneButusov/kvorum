# ADR-0072: Vote-choice multiplicity + off-chain supersession ordering key

- **Status**: Accepted
- **Date**: 2026-06-21
- **Amends**: 0021, 0062
- **Related**: 0023, 0067, issue #321, Z4 (Epic Z #309), M4 (Lido)

## Context

The CH vote pipeline (`vote_events_raw` → `vote_events_mv` → `vote_events_agg` →
`vote_events_projection`) stores exactly one choice per vote (`primary_choice Int8`) and uses
`(cast_at DESC, block_number DESC, log_index DESC)` as the supersession ordering key.

Two gaps need closing before AD4 (live Snapshot weighted/ranked-choice decode) and AF1 (vote API
shapes):

1. **Off-chain supersession degeneracy.** EVM votes have strictly increasing `(cast_at,
block_number, log_index)` — a natural total order for supersession. Snapshot votes carry no
   block or log_index; both are sentinel `0`. `cast_at` is second-resolution and can tie across
   same-second edits of the same vote. Without a tie-breaker the "current" vote is
   non-deterministic for off-chain re-votes.

2. **Choice multiplicity** (deferred to AD4). Snapshot supports weighted (split power across
   choices), ranked-choice, quadratic, and approval voting. A per-vote `choices` breakdown is
   needed but belongs in a Snapshot-specific protocol table rather than the core CH pipeline —
   it is a payload column (point-fetch by vote_id for display only), never filtered or aggregated,
   and would break vectorized execution on the core pipeline columns.

ADR-023 (Accepted) additionally mandated `primary_choice = NULL` for multi-choice Snapshot
voting types (`weighted`, `ranked-choice`, `quadratic`). See D4 below for the amendment.

## Decisions

### D1 — In-place pipeline rebuild

The `seq` column requires a new `argMaxState` entry in `vote_events_agg` and a new
`argMaxMerge` entry in `vote_events_projection`. Because the MV SELECT lists are hardcoded,
adding columns is a full drop-and-rebuild (MV → agg → projection; ADR-0067 precedent). The
implementation edits `0001_core_ch_source_of_truth.sql` in-place. The
`clickhouse-migrations` runner md5-checksums applied files and `process.exit(1)`s on a changed
file — **any already-migrated ClickHouse instance must be wiped before applying** (CI uses a
fresh DB on every run; no prod data exists at Z4 time). The rebuild + rollback procedure is
documented below.

### D2 — `choices` payload deferred to AD4 (Snapshot-specific table)

`choices` is a point-lookup payload column (display UI fetches by `vote_id`), never used in
WHERE, GROUP BY, or aggregation. Storing it in the core CH pipeline would break vectorized
execution for all vote types needing fast analytics.

AD4 will store the Snapshot-specific `choices[]`/`vp_by_strategy` breakdown in a
Snapshot-specific protocol table (separate from `vote_events_raw`). `findChoicesForVote` will
dispatch at read time: Snapshot → Snapshot protocol table; EVM → synthesized from
`primary_choice` as `[{ choice_index, weight: "1.0" }]`. No further pipeline rebuild is needed
at AD4.

### D3 — `choices` JSON shape (AD4 contract, not Z4)

```jsonc
[{"choice_index": <int>, "weight": "<decimal-string>"}, ...]
```

`weight` is a decimal string (no float drift). Sorted descending by weight so `choices[0]` is
always the highest-weight entry. `primary_choice = choices[0].choice_index` by invariant.

#### Per-`voting_type` mapping (the AF1 fixture contract, owned by AD4)

| `voting_type`             | `primary_choice`             | `choices` entries                                                        |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `basic` / `single-choice` | index of chosen option       | one entry, `weight: "1.0"`                                               |
| `approval`                | index of first chosen option | one entry per chosen option, each `weight: "1.0"`                        |
| `weighted`                | `choices[0].choice_index`    | one entry per option with fractional weights summing to `"1.0"`          |
| `ranked-choice`           | `choices[0].choice_index`    | `choice_index` carries rank (1 = first preference); `weight: "1.0"` each |
| `quadratic`               | `choices[0].choice_index`    | normalized fractional weights summing to `"1.0"`                         |
| `copeland`                | index of first chosen option | pairwise weight entries                                                  |

### D4 — `primary_choice Int8`, always highest-weight choice index (amends ADR-023)

ADR-023 mandated `primary_choice = NULL` for multi-choice Snapshot voting types. **This ADR
amends that decision.** `primary_choice` is defined as the **highest-weight choice index for
all voting types** — never NULL:

- single-choice / basic / approval → the chosen option index (unchanged)
- weighted → `choices[0].choice_index` (the option with the largest fractional weight)
- ranked-choice → `choices[0].choice_index` (first preference, rank 1)
- quadratic → `choices[0].choice_index` (the option with the largest normalized weight)

`primary_choice` keeps vectorized filter and aggregation performance for all vote types.
Analytics that need the full breakdown will use the Snapshot-specific protocol table (AD4);
analytics that need speed (participation counts, for/against breakdowns, indexed filters) use
`primary_choice` and get a coherent result regardless of voting type. The write invariant
`primary_choice = choices[0].choice_index` is enforced at the write path (AD4) and verified by
integration tests.

### D5 — Off-chain supersession key: `seq UInt64 DEFAULT 0`

**Unified ordering key:** `(cast_at DESC, block_number DESC, log_index DESC, seq DESC)`.

`seq` is a `UInt64` payload column (not in `ORDER BY` or `GROUP BY` — matches
`primary_choice`/`voting_power`). Agg state: `AggregateFunction(argMax, UInt64, DateTime64(6))`.

- **Off-chain** (Snapshot, AD1/AD4): `seq` = `derivation_ordinal` from Z1 — the poll-sequence
  counter the plugin increments monotonically per observed event. For EVM `seq` is `0` (the
  `(cast_at, block_number, log_index)` triple is already a total order).
- **Monotonicity constraint (binding on AD1/AD4):** the off-chain ordinal fed to `seq` MUST be a
  strict total order increasing with cast/observation order within any `(proposal, voter)` chain.
  Concretely: a per-source poll-sequence counter **never `created`-seconds** (second resolution
  reintroduces same-second ties). `derivation_ordinal` from Z1 satisfies this by construction.
- `vote_id` (content-addressed from the vote-hash by AD4) remains the storage `ORDER BY`
  terminal for replay-idempotent dedup.
- `isNewerVote`, `findCurrentVote` ORDER BY, and `listVotersForProposal` argMax tuple all gain
  `seq` as the terminal comparator. For EVM the comparator is a no-op (`0 vs 0`).

### D6 — Live decode out of scope → AD4

Z4 ships the `seq` pipeline column, the pipeline rebuild, this ADR, and `findChoicesForVote`
(EVM synthesis from `primary_choice`). AD4 owns the live Snapshot decode: Snapshot-specific
protocol table for `choices`/`vp_by_strategy`, deriving `vote_id` from the vote-hash, emitting
off-chain sentinels (`block_number=0`, `log_index=0`), and setting `seq = derivation_ordinal`.
`findChoicesForVote` will dispatch by source type at AD4.

### D7 — Rollback is documented, not executable as a migration

D1 (in-place edit) carries no down-migration. Rollback = reverting `0001_core_ch_source_of_truth.sql`
to the prior text and re-applying the rebuild procedure below. **AG validates this procedure
against a populated database before the first real backfill run.**

## Already-migrated-instance rebuild procedure

For any ClickHouse instance that has already applied `0001_core_ch_source_of_truth.sql` (including
local dev), the in-place edit does not auto-apply. Procedure (mirrors ADR-0067):

```sql
-- 1. Stop all indexer workers (no writes during rebuild)
-- 2. Drop the read VIEW
DROP VIEW IF EXISTS vote_events_projection;
-- 3. Drop the MV (stops new rows flowing into agg)
DROP TABLE IF EXISTS vote_events_mv;
-- 4. Drop the agg table
DROP TABLE IF EXISTS vote_events_agg;
-- 5. ALTER vote_events_raw to add new columns (or DROP + recreate if ALTER is unavailable)
ALTER TABLE vote_events_raw
  ADD COLUMN IF NOT EXISTS seq UInt64 DEFAULT 0;
-- 6. Recreate agg (with new state columns)
CREATE TABLE vote_events_agg ... (see 0001_core_ch_source_of_truth.sql);
-- 7. Recreate MV (new SELECT list)
CREATE MATERIALIZED VIEW vote_events_mv TO vote_events_agg AS ... ;
-- 8. Recreate projection VIEW
CREATE VIEW vote_events_projection AS ... ;
-- 9. Backfill agg from raw (for existing rows)
INSERT INTO vote_events_agg
  SELECT vote_id, dao_id, proposal_id, voter_address, block_number, log_index, cast_at,
         voting_chain_id,
         argMaxState(primary_choice, version) AS primary_choice_state,
         argMaxState(seq, version)            AS seq_state,
         argMaxState(voting_power, version)   AS voting_power_state,
         argMaxState(superseded, version)     AS superseded_state,
         argMaxState(superseded_at, version)  AS superseded_at_state,
         argMaxState(superseded_by_vote_id, version) AS superseded_by_vote_id_state
  FROM vote_events_raw
  GROUP BY vote_id, dao_id, proposal_id, voter_address, block_number, log_index, cast_at, voting_chain_id;
-- 10. Resume indexer workers
```

**Rollback:** revert `0001_core_ch_source_of_truth.sql` to pre-Z4 text, run the same procedure
with the old DDL (omit new columns in step 5; skip agg INSERT for new state columns).
AG validates the rollback against a populated DB before the first M-series backfill.

## Consequences

- **Z4** ships `seq UInt64 DEFAULT 0` in the CH pipeline. All EVM sources pass `seq = '0'`; the
  comparator is a no-op for EVM re-votes. `isNewerVote` gains `seq` as the terminal comparator;
  `findCurrentVote` ORDER BY and `listVotersForProposal` argMax tuple both include `seq`.
- **AD4** adds the Snapshot-specific protocol table for `choices` + `vp_by_strategy` payload
  without any further core pipeline rebuild. `findChoicesForVote` will dispatch by source type
  at AD4 time.
- **AF1** can read `findChoicesForVote` → `VoteChoiceDto[]` for EVM sources now (synthesized
  from `primary_choice`); full multi-element support added in AD4.
- **EVM sources (Compound, Aave)** are unaffected beyond the `seq` no-op; `primary_choice` is
  always non-null.
- **AG validates** the already-migrated-instance rebuild + rollback procedure before the first
  populated backfill run.
