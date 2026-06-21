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

1. **Choice multiplicity.** Snapshot supports weighted (split power across choices),
   ranked-choice (ordered preference), quadratic, and approval voting. None fit a scalar
   `primary_choice`. A structured `choices` column is needed to carry a multi-element breakdown per
   vote.

2. **Off-chain supersession degeneracy.** EVM votes have strictly increasing `(cast_at,
block_number, log_index)` — a natural total order for supersession. Snapshot votes carry no
   block or log_index; both are sentinel `0`. `cast_at` is second-resolution and can tie across
   same-second edits of the same vote. Without a tie-breaker the "current" vote is
   non-deterministic for off-chain re-votes.

ADR-023 (Accepted) additionally mandates `primary_choice = NULL` for multi-choice Snapshot
voting types (`weighted`, `ranked-choice`, `quadratic`).

## Decisions

### D1 — In-place pipeline rebuild

The `choices` and `seq` columns require new `argMaxState` entries in `vote_events_agg` and new
`argMaxMerge` entries in `vote_events_projection`. Because the MV SELECT lists are hardcoded,
adding columns is a full drop-and-rebuild (MV → agg → projection; ADR-0067 precedent). The
implementation edits `0001_core_ch_source_of_truth.sql` in-place. The
`clickhouse-migrations` runner md5-checksums applied files and `process.exit(1)`s on a changed
file — **any already-migrated ClickHouse instance must be wiped before applying** (CI uses a
fresh DB on every run; no prod data exists at Z4 time). The rebuild + rollback procedure is
documented below.

### D2 — `choices` storage: argMax'd JSON `String`

`choices String DEFAULT '[]' CODEC(ZSTD(1))` on `vote_events_raw`; agg state
`AggregateFunction(argMax, String, DateTime64(6))`; MV `argMaxState(choices, version)`;
projection `argMaxMerge(choices_state)`. `String` argMax round-trips JSON losslessly.
`Nested`/`Array(Tuple)` cannot be argMax'd and would force a subquery-based projection.
`DEFAULT '[]'` ensures `JSON.parse` never throws on a row written without the field.

### D3 — `choices` JSON shape: `[{choice_index, weight}]` sorted descending weight

```jsonc
[{"choice_index": <int>, "weight": "<decimal-string>"}, ...]
```

`weight` is a decimal string (no float drift). Sorted descending by weight so `choices[0]` is
always the highest-weight entry. `primary_choice = choices[0].choice_index` for single-choice
sources.

#### Per-`voting_type` mapping (the AF1 fixture contract)

| `voting_type`             | `primary_choice`             | `choices` entries                                                        |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `basic` / `single-choice` | index of chosen option       | one entry, `weight: "1.0"`                                               |
| `approval`                | index of first chosen option | one entry per chosen option, each `weight: "1.0"`                        |
| `weighted`                | NULL (ADR-023)               | one entry per option with fractional weights summing to `"1.0"`          |
| `ranked-choice`           | NULL (ADR-023)               | `choice_index` carries rank (1 = first preference); `weight: "1.0"` each |
| `quadratic`               | NULL (ADR-023)               | normalized fractional weights summing to `"1.0"`                         |
| `copeland`                | index of first chosen option | pairwise weight entries                                                  |

This table is the contract AF1 codes its fixtures against.

### D4 — `primary_choice Nullable(Int8)` (reconciles ADR-023)

ADR-023 mandates `primary_choice = NULL` for `weighted`/`ranked-choice`/`quadratic` votes.
Z4 makes `primary_choice Nullable(Int8)` in the storage layer, so AD4 can write NULL for
multi-choice types without a second pipeline rebuild. Single-choice EVM sources (Compound, Aave)
continue to write the concrete integer index. `primary_choice` is retained as the denormalised
highest-weight index for single-choice reads, tie-breaks, and analytics; `NULL` is the
correct sentinel for multi-choice types.

The agg state type changes to `AggregateFunction(argMax, Nullable(Int8), DateTime64(6))` —
argMax supports Nullable arguments (precedent: `superseded_at_state`).

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

Z4 ships the columns, the pipeline rebuild, this ADR, and read wiring (`findChoicesForVote`).
AD4 owns the live Snapshot decode: populating `choices` from `choices[]`/`vp_by_strategy`, writing
`primary_choice = NULL` for `weighted`/`ranked-choice`/`quadratic`, deriving `vote_id` from
the vote-hash, emitting off-chain sentinels (`block_number=0`, `log_index=0`), and setting
`seq = derivation_ordinal`.

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
  ADD COLUMN IF NOT EXISTS choices String DEFAULT '[]' CODEC(ZSTD(1)),
  ADD COLUMN IF NOT EXISTS seq UInt64 DEFAULT 0,
  MODIFY COLUMN primary_choice Nullable(Int8);
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
         argMaxState(choices, version)        AS choices_state,
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

- **AD4** can write multi-element `choices` + `primary_choice = NULL` for Snapshot
  weighted/ranked-choice/quadratic votes without any further pipeline rebuild.
- **AF1** can read `findChoicesForVote` → `VoteChoiceDto[]` for both single-choice and
  multi-element breakdowns; uses the per-`voting_type` mapping table above as the fixture
  contract.
- **EVM sources (Compound, Aave)** are byte-identical: `choices` reads back as the one-element
  shape; `primary_choice` is non-null; `seq = 0` is a no-op tie-break.
- **Analytics** (`matched_choices`, `listForProposal`, `listForActor`): `primary_choice` going
  nullable is additive-safe — no weighted votes exist until AD4, so no read hits NULL in Z4.
  Future analytics for multi-choice types will treat NULL as "no single choice to align" —
  semantically correct.
- **AG validates** the already-migrated-instance rebuild + rollback procedure before the first
  populated backfill run.
