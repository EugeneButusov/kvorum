# M2 Backfill Runbook

## Scope

- Re-run `compound_governor_alpha`, `compound_governor_bravo`, and `compound_governor_oz` from their current `backfill_head_block` using `admin-cli backfill start --from-block <head> --confirm-replay`.
- Run first full backfill for `compound_comp_token` from `active_from_block`.
- Execute DLQ fault-injection scenarios for:
  - `archive_confirmation_write`
  - `vote_archive_write`
  - `delegation_archive_write`

## Preconditions

- K3 PR1 merged.
- Indexer process stopped before backfill reruns.
- `ingestion_dlq` pending depth is zero before rehearsal starts.

## Execution Outline

1. Record reference counts and retrieval timestamp (Tally/Etherscan) before running any backfill command.
2. Run governor replays one-by-one with `--confirm-replay`.
3. Pause after Alpha for wall-clock calibration; if runtime is >2x expected, reassess before Bravo/OZ.
4. Run comp-token backfill without `--from-block`.
5. Verify event counts and sample proposal VoteCast exact matches.
6. Re-enable live poller and verify fresh event latency.

## DLQ Drill Outline

1. Force PG write failure and verify row appears in `vote_archive_write` for VoteCast.
2. Force PG write failure and verify row appears in `archive_confirmation_write` for proposal events.
3. Force CH write failure and verify routing to the same stages above.
4. Force comp-token archive failure and verify `delegation_archive_write`.
5. Recover via `admin-cli dlq retry <id>` and confirm rows resolve.

## Acceptance Evidence

- Aggregate VoteCast counts per governor are within ±5% of recorded references (or exact zero when reference is zero).
- Pre-selected per-proposal VoteCast samples match exactly.
- COMP token DelegateChanged / DelegateVotesChanged counts are within ±5% of references.
- Replay window idempotency check produces zero net row increase.
- `ingestion_dlq` returns to zero unresolved rows after drill cleanup.

## TODO Before M2 Acceptance

- Expand with exact command blocks (psql/chsql/admin-cli) and cleanup traps.
- Add result tables for timestamps, counts, and pass/fail gates.
- Add links to rehearsal tracking issue and generalized backfill collection follow-up.
