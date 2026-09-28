# Runbook — Datastore backup and restore

Postgres and ClickHouse run in-cluster on `local-path` volumes (ADR-0090), i.e. the droplet's own disk. **Losing the node loses the data.** This is the recovery path.

## What is backed up

`components/backup` runs a nightly CronJob at 03:17 UTC, in two stages over a shared `emptyDir`:

1. **dump** (`postgres:18-alpine`) — `pg_dump -Fc` of the whole database, then every ClickHouse source `*MergeTree` table as `FORMAT Native`. Table discovery is dynamic (`system.tables`), so a new source's tables are picked up without touching the job. Migration metadata and the two materialized-view aggregate targets are excluded; migrations recreate them, and restoring both raw and aggregate state would double the aggregates. Everything is gzipped.
2. **upload** (`rclone/rclone`) — pushes to `s3://$R2_BUCKET/daily/<timestamp>/`, and additionally to `weekly/` on Sundays. Retention is 7 days on `daily/`, 28 on `weekly/`.

Projection `VIEW`s, materialized views, and their `*_agg` targets are deliberately **not** dumped: they are derived, and they repopulate from the `*_raw` tables. `_migrations` is not dumped either because the schema-first restore recreates that metadata.

Native output uses 256-row blocks. The forum archive's JSON payloads are large enough that
one default-sized block can exceed the single-node ClickHouse memory ceiling during restore.

The bucket must already exist — the job runs with `--s3-no-check-bucket` so its token needs only object read/write, not bucket creation.

Prometheus data is **not** backed up. Metrics are disposable; the datastores are not.

## Check it is working

```bash
kubectl -n kvorum get cronjob kvorum-backup
kubectl -n kvorum get jobs -l app.kubernetes.io/name=kvorum-backup
kubectl -n kvorum logs job/<latest> -c dump
kubectl -n kvorum logs job/<latest> -c upload
```

The upload stage ends by listing the bucket's top-level prefixes. An empty `daily/` after a successful run means the upload silently went nowhere — check `R2_ENDPOINT` and the token.

Run one on demand:

```bash
kubectl -n kvorum create job backup-now --from=cronjob/kvorum-backup
kubectl -n kvorum wait --for=condition=complete job/backup-now --timeout=600s
```

## Restore Postgres

Into a scratch database first — never straight over the live one.

```bash
# 1. fetch the dump (adjust the timestamp)
rclone copy "r2:$R2_BUCKET/daily/<timestamp>/postgres.dump.gz" /tmp/
gunzip /tmp/postgres.dump.gz

# 2. restore into a scratch database
psql -h kvorum-postgres -U kvorum -d postgres -c 'CREATE DATABASE restore_drill'
pg_restore -h kvorum-postgres -U kvorum -d restore_drill --no-owner --no-privileges /tmp/postgres.dump

# 3. verify before trusting it
psql -h kvorum-postgres -U kvorum -d restore_drill -tAc \
  "select count(*) from information_schema.tables where table_schema='public'"
psql -h kvorum-postgres -U kvorum -d restore_drill -tAc 'select extname from pg_extension order by 1'
psql -h kvorum-postgres -U kvorum -d restore_drill -tAc 'select count(*) from proposal'
```

`pg_extension` must list `vector` — a restore that silently dropped it will fail the `ai_003` migration and every embedding read.

To promote the scratch database, stop the apps first (`kubectl -n kvorum scale deploy/kvorum-api deploy/kvorum-indexer deploy/kvorum-ai-worker deploy/kvorum-dashboard --replicas=0`), rename, then scale back up.

## Restore ClickHouse

Schema first, data second — the dump carries no DDL.

```bash
# 1. schema, from the migrations
pnpm -w db:migrate:ch

# 2. per source table, into empty tables
rclone copy "r2:$R2_BUCKET/daily/<timestamp>/" /tmp/chrestore/
cd /tmp/chrestore && gunzip -f ./*.native.gz

(
  set -e -o pipefail

  while IFS= read -r t; do
    [ -n "$t" ] || continue
    rows=$(curl -fsS -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
      "$CLICKHOUSE_URL/?database=$CLICKHOUSE_DATABASE" \
      --data-binary "SELECT count() FROM \`$t\` FORMAT TSV")
    if [ "$rows" != 0 ]; then
      echo "ERROR: target table $t already has $rows row(s); restore into an empty target" >&2
      exit 1
    fi
  done < ch-tables.txt

  while IFS= read -r t; do
    [ -n "$t" ] || continue
    curl -fsS -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
      "$CLICKHOUSE_URL/?database=$CLICKHOUSE_DATABASE&query=INSERT%20INTO%20%60${t}%60%20FORMAT%20Native" \
      --data-binary "@ch__$t.native"
  done < ch-tables.txt
)
```

Do not restore over partially populated tables. The archive tables use `ReplacingMergeTree`,
but `vote_events_raw` and `delegation_flow_raw` are plain `MergeTree`; replaying them creates
permanent duplicates and also doubles the materialized aggregate state. The preflight above
therefore refuses any non-empty source table. For `ReplacingMergeTree` verification, read
with `SELECT … FINAL` so background merge timing does not look like data loss; never run
`OPTIMIZE TABLE FINAL` from a script.

Verify a large `UInt256` survived, e.g. `SELECT toString(voting_power) FROM vote_events_raw LIMIT 1` — reading such a column as a JS number silently loses precision, which has broken derivation before.

## Whole-host recovery

Weekly droplet snapshots are the coarse path: restore the snapshot, then apply the latest logical backups on top for anything since. Snapshots alone are not sufficient — they can be up to a week stale.

## Last resort

Chain-derived data is re-derivable: reset the source cursors and re-run the backfill. It is slow, spends RPC quota, and has historically been the riskiest operation in this project, so treat it as recovery of last resort rather than a backup strategy. Identity, configuration and the proposal state machine live only in Postgres and are **not** re-derivable.

## Drill log

An unverified backup is not a backup. Record each drill here.

| Date       | Scope                                  | Result                                                                                                                                                                                                                                                                    |
| ---------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-27 | Full dump + restore on single-node k3s | Pass. PG: 40 public tables and `source_type` 25 rows restored into a scratch DB, `vector` present. CH: `vote_events_raw` truncated then restored from `FORMAT Native`, count and a 26-digit `UInt256` byte-exact. Verified against an S3 endpoint, not a filesystem stub. |
