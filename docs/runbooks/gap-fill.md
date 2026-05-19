# Startup gap-fill and catch-up runbook

This runbook covers ADR-051 operation for startup gap detection and manual catch-up.

## What happens automatically

- On indexer startup, each `dao_source` computes a gap against `head - 2*reorgHorizon`.
- If a gap exists, the indexer runs a sequential gap fill before live poller start.
- Gap fill uses the existing backfill driver with `mode=fresh` and `force=true`.
- Locking uses per-source PG advisory lock; lock contention skips fill and starts live polling.

## Critical operational caveat

- `force=true` resets `backfill_*` checkpoints for that source.
- Do not restart the indexer while a manual `backfill start` for the same source is in flight.

## Manual catch-up command

Use when source lag is known and you want explicit operator control:

```bash
admin-cli backfill catch-up <source_type> --dry-run
admin-cli backfill catch-up <source_type> --confirm
```

Behavior:

- `--dry-run` shows computed gap (or no gap/skip reason) and does not write.
- `--confirm` executes gap fill with the same logic as startup path.
- Lock contention exits with an error and does not run fill.

## Troubleshooting

1. Gap fill skipped (`reason=lock_contended`):
   Run the command again after concurrent task finishes.

2. Gap fill skipped (`reason=no_active_from_block`):
   Seed history explicitly:

```bash
admin-cli backfill start <source_type> --from-block <N> --confirm
```

3. Gap fill failed (`ingestion_gap_fill_failed`):
   Review indexer logs for source/range, then run manual catch-up.

## Metrics to watch

- `ingestion_gap_fill_failed{reason=error|shutdown}`
- `ingestion_gap_fill_skipped{reason=lock_contended|no_active_from_block}`
- `ingestion_live_watermark_skipped{reason=listener_failed}`
