# M2 Mirror ETL Runbook

## Daily checkpoint

Run:

```bash
pnpm --filter admin-cli start -- mirror-etl status
```

Expected steady state:

- `age_seconds < 129600` (36h)
- `last_run_exact_match = true`

## Alert response: `exact_match = false`

1. Re-check after 10 minutes (possible merge-window transient).
2. If still false, inspect latest run rows:

```sql
SELECT *
FROM mirror_etl_run
WHERE job_name IN ('vote_events_etl', 'delegation_flow_etl')
ORDER BY started_at DESC
LIMIT 20;
```

3. Compare PG and CH counts for the same upper bound.

## Alert response: `drift_ratio > 0.01`

1. Inspect `mirror_etl_run.last_error` and `attempt_count`.
2. Run manual retry:

```bash
pnpm --filter admin-cli start -- mirror-etl run-now --job all
```

3. If drift persists, query DLQ for `stage = 'mirror_etl_run'`.

## Alert response: `last_success_age_seconds > 36h`

1. Trigger manual run:

```bash
pnpm --filter admin-cli start -- mirror-etl run-now --job all
```

2. If failing repeatedly, check:

- `mirror_etl_run` (`attempt_count`, `last_error`)
- `ingestion_dlq` rows at `stage='mirror_etl_run'`

## Initial backfill

```bash
pnpm --filter admin-cli start -- mirror-etl reset-watermark --job vote_events_etl --to epoch --confirm
pnpm --filter admin-cli start -- mirror-etl reset-watermark --job delegation_flow_etl --to epoch --confirm
pnpm --filter admin-cli start -- mirror-etl run-now --job all
```

## DLQ retry

```bash
pnpm --filter admin-cli start -- dlq retry <dlq_id>
```

For `mirror_etl_run` entries this re-runs the job named in payload.

## Watermark surgery (escape hatch)

If CLI reset is unavailable:

```sql
UPDATE etl_watermark
SET watermark = TIMESTAMPTZ '1970-01-01T00:00:00Z', updated_at = now()
WHERE name = 'vote_events_etl';
```

Use direct SQL only as an emergency fallback.
