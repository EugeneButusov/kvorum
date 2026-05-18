# ClickHouse OPTIMIZE TABLE FINAL — operator runbook

`OPTIMIZE TABLE event_archive_<source> FINAL` is reserved for **manual operator intervention only**. Application code and scheduled jobs must never issue this command.

## When to trigger

1. `system.parts` row count for a single archive table exceeds **500**, or
2. Immediately after a backfill run that wrote **≥ 10,000 rows** in a tight window, before re-enabling derivation reads.

## How to run

```sql
-- Connect to ClickHouse and run:
OPTIMIZE TABLE event_archive_compound_governor_bravo FINAL;
```

## Warnings

- The operation rewrites parts and can be I/O-intensive. Run during a **quiet derivation window** (when G1 reads are low).
- On large tables this can take minutes. Monitor `system.merges` for progress.
- Do **not** run during active backfill — wait until the backfill completes first.

## Why this is manual-only

Application code issues duplicate inserts that ReplacingMergeTree deduplicates lazily at merge time. Forcing `FINAL` compaction from application code or scheduled jobs would introduce I/O spikes unpredictably. For normal read operations, use `SELECT … FINAL` instead (per ADR-041 read protocol).

## Reference

- ADR-038 (CH archive layer)
- ADR-041 §"OPTIMIZE TABLE" restriction
- `libs/sources/compound/migrations-clickhouse/compound_001_archive.sql` — migration SQL comments
