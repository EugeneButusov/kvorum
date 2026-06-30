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

### D1 — No CH DDL changes in Z4

Z4 makes no changes to the CH vote pipeline. `primary_choice Int8` already existed and was
already non-nullable. The pipeline rebuild cost (drop MV → drop agg → drop projection → alter
raw → recreate; ADR-0067 precedent) is deferred to AD4, which will add Snapshot-specific
columns when it ships.

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

### D5 — Off-chain supersession key: deferred to AD4 (Snapshot-specific)

The off-chain re-vote tie-break problem (same-second `cast_at`, `block_number = 0`,
`log_index = 0`) is Snapshot-specific — no current EVM source can produce a non-deterministic
supersession ordering. Adding a `seq` column to the generic `vote_events_raw` table would
make every EVM write carry a meaningless `0` sentinel.

The fix belongs in the Snapshot-specific protocol table (AD4): a Snapshot-owned `ordinal`
column derived from `derivation_ordinal` (Z1), stored only where it is meaningful. At AD4,
`isNewerVote` gains an optional ordinal parameter and `findCurrentVote` ORDER BY gains the
terminal comparator — scoped to the Snapshot read path.

**Monotonicity contract (binding on AD4):** the ordinal fed to `seq` MUST be a strict total
order within any `(proposal, voter)` chain. `derivation_ordinal` from Z1 satisfies this by
construction.

### D6 — Live decode and supersession tie-break out of scope → AD4

Z4 delivers `primary_choice Int8` (non-nullable, amends ADR-023), this ADR, and
`findChoicesForVote` (EVM synthesis from `primary_choice`). AD4 owns everything
Snapshot-specific: the Snapshot protocol table (`choices`, `vp_by_strategy`, `ordinal`),
`vote_id` from vote-hash, off-chain sentinels, and `isNewerVote` ordinal extension.

### D7 — No pipeline rebuild in Z4

Z4 makes no CH DDL changes — the `primary_choice Int8` column already existed. No
drop-and-rebuild is needed. AD4 will rebuild the pipeline when it adds the Snapshot-specific
table and columns.

## Consequences

- **Z4** delivers only the `primary_choice` non-nullable amendment and ADR-072 documentation.
  The CH pipeline is unchanged from pre-Z4.
- **AD4** owns the Snapshot protocol table, `choices`/`vp_by_strategy` payload, the ordinal
  tie-break column, and `findChoicesForVote` dispatch by source type.
- **AF1** can read `findChoicesForVote` → `VoteChoiceDto[]` for EVM sources now (synthesized
  from `primary_choice`); full multi-element and off-chain support added in AD4.
- **EVM sources (Compound, Aave)** are unaffected; `primary_choice` is always non-null.

## AD4 amendment (2026-06-30)

AD4 implemented the Snapshot-specific decisions and, on contact with the code, amends D5/D6:

### A1 — No `ordinal`/`seq` column; reuse the shared supersession path (amends D5)

D5 prescribed a Snapshot `ordinal` column from `derivation_ordinal`. But AD1 sets
`derivation_ordinal = the vote's Snapshot `created`=`cast_at`, so it is **redundant** with
`cast_at`and adds no ordering. AD4 therefore adds **no column** and reuses the shared`buildVoteRows`/`isNewerVote`/`findCurrentVote`unchanged, passing off-chain sentinels`block_number='0'`, `log_index=0`. `buildVoteRows`'s `row`param is narrowed to the structural`{ id, block_number, log_index, chain_id }`so off-chain callers can supply a synthetic identity
(EVM callers pass their`ArchiveDerivationRow` unchanged).

**Same-second off-chain re-votes** (the case D5 targeted) are both **unobservable** in practice —
Snapshot's API returns one vote per voter and the poll cadence is 60s, so two same-second casts by
one voter never both reach the archive — **and unorderable** (second-resolution `created`, no
sub-second signal exists anywhere). The shared logic yields a deterministic result (on a `cast_at`
tie the incoming is treated as not-newer → superseded; exactly one `superseded=0` row remains) and
selection order is deterministic (`ORDER BY derivation_ordinal, external_id, id`). This is
**best-effort-deterministic, not recency** — documented as an accepted limitation.

### A2 — `vote_id` is the archive UUID, not a vote-hash (corrects D6)

D6 described `vote_id` as "from vote-hash." In the implementation `vote_id = archive_event.id`, a
random `gen_random_uuid()`. It is **not order-bearing** and is **not** used as a supersession
tie-break (see A1). D6's "vote_id from vote-hash" is withdrawn.

### A3 — `voting_power` is `round(vp)`; no fixed-point scaling

Snapshot `vp` is fractional; the core `voting_power UInt256` stores **`round(vp)`** (read raw by the
API/analytics, so any scaling would corrupt it). The **exact decimal `vp`** is kept in the protocol
table. Snapshot `voting_power` is rounded reported power and is never summed across sources.

### A4 — Protocol table `snapshot_vote_choice` (CH); 0-based indices; `voting_chain_id` from `network`

The breakdown lives in `snapshot_vote_choice` (CH `ReplacingMergeTree(version)`, keyed by `vote_id`):
`choices` JSON (0-based `choice_index`, decimal `weight`, desc by weight), exact `vp`,
`vp_by_strategy`. `voting_chain_id` is derived from `snapshot_proposal_metadata.network` (mapped to
hex), **not** the `'off-chain'` archive sentinel. The API read-dispatch
(`findChoicesForVote`) is AF1's.

### A5 — Votes derive continuously; shielded deferred

Votes derive as archived (a non-shielded vote's choice + `vp` are final at the snapshot block, so
this satisfies "consume only at final" for the per-vote data we store). A scores_state-final gate
was rejected: deferring without a watermark advance would head-of-line-block the off-chain
derivation lane. **Shielded/encrypted choices are detected (undecodable) and skipped** (marked
derived); full shielded support — re-fetching closed proposals' votes for revealed choices — is a
KNOWN follow-up.
