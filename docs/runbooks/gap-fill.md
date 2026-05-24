# Startup catch-up runbook (ADR-051 parallel handoff)

This runbook covers boot-time catch-up and manual catch-up/backfill operations.

## What happens automatically

- On indexer startup, live pollers start immediately for enabled sources.
- For each EVM event source, the orchestrator waits for the first successful live tick head `L`.
- Boot catch-up then runs in background over `[backfill_head_block + 1, L - 2H]` (`H = headLag`).
- Catch-up advances `backfill_head_block` per chunk and does not clear it on completion.
- Catch-up failure does not stop live polling; it is surfaced through logs/metrics.

## Manual operation (current stage)

Locking is intentionally not enabled yet. Operationally, avoid overlapping manual and boot-time catch-up on the same `dao_source`.

- Do not run `backfill catch-up` while indexer boot catch-up is active for that source.
- Do not run `backfill start` while boot catch-up is active for that source.

## Manual catch-up command

```bash
admin-cli backfill catch-up <source_type> --dry-run
admin-cli backfill catch-up <source_type> --confirm
```

Behavior:

- `--dry-run` prints computed gap (or no-gap / skip reason).
- `--confirm` executes boot-style catch-up in the foreground.

## Manual backfill start command

```bash
admin-cli backfill start <source_type> --from-block <N> [--to-block <M>]
```

Validation rule:

- `--from-block` must be `>= max(active_from_block, backfill_head_block + 1)`.
- Skipping ahead is allowed.
- Going below that floor is rejected.

## Metrics to watch

- `ingestion_gap_fill_failed{reason="error"|"shutdown"}`
- `ingestion_gap_fill_skipped{reason="no_active_from_block"|"above_floor"}`
- `ingestion_log_poll_lag_seconds`

## Troubleshooting

1. Catch-up skipped with `no_active_from_block`:
   set a valid starting history via `backfill start --from-block <N>`.
2. Catch-up failed:
   inspect indexer logs for source/range and rerun `backfill catch-up --confirm`.
3. Live polling healthy but floor not moving:
   verify no concurrent manual backfill/catch-up is running for the same source.
