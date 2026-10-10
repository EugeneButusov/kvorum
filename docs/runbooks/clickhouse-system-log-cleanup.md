# ClickHouse system-log cleanup

Use this runbook when ClickHouse remains CPU- or memory-bound while `system.merges` shows only
`system.*_log` tables. It removes disposable ClickHouse diagnostic history without touching the
`kvorum` database.

The production configuration disables high-churn system logs because Prometheus and container
console logs cover steady-state observability on the single-node cluster. Low-volume `crash_log`,
`backup_log`, `blob_storage_log`, and `s3queue_log` remain enabled.

Schedule a short maintenance window. The configuration deployment and the post-cleanup restart each
make ClickHouse briefly unavailable; application pollers retry rather than skipping their cursors.

## Failure mode

A system-log merge can exceed the server memory limit while thousands of small parts remain loaded.
If `text_log` records every failed merge, each failure creates more diagnostic data and sustains the
merge/log feedback loop. Serializing merges reduces peak concurrency but cannot drain a merge that
fails every time.

Typical evidence:

- ClickHouse remains near one CPU with no application backfill running.
- `system.merges` names `system.metric_log`, `system.text_log`, or another `system.*_log` table.
- server logs contain `MEMORY_LIMIT_EXCEEDED` from `MergeTreeBackgroundExecutor`.
- `text_log` reports `TOO_MANY_PARTS`.

## 1. Capture the pre-cleanup state

Record the application tables and active merge. The cleanup must never target the `kvorum` database.

```bash
kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --query "SELECT name, engine, total_rows, total_bytes FROM system.tables WHERE database = '\''kvorum'\'' ORDER BY name FORMAT TSVRaw"
'

kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --query "SELECT database, table, elapsed, num_parts, total_size_bytes_compressed, memory_usage FROM system.merges ORDER BY elapsed DESC FORMAT TSVRaw"
'
```

Save both outputs in the incident or rollout record.

## 2. Deploy the disabled-log configuration

Merge and deploy the configuration change before deleting any table. The generated ConfigMap name
is hashed into the StatefulSet, so the normal deployment recreates the ClickHouse pod.

```bash
kubectl -n kvorum rollout status statefulset/kvorum-clickhouse --timeout=10m
kubectl -n kvorum get pod -l app.kubernetes.io/name=kvorum-clickhouse
```

Confirm every table in the cleanup allowlist is absent from the effective configuration. This check
must print only `<name>=disabled` lines:

```bash
kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  for key in \
    metric_log asynchronous_metric_log trace_log part_log text_log error_log \
    query_log query_thread_log query_views_log query_metric_log \
    processors_profile_log asynchronous_insert_log opentelemetry_span_log
  do
    if clickhouse extract-from-config --config-file=/etc/clickhouse-server/config.xml \
      --key="$key" >/dev/null 2>&1
    then
      echo "$key=ENABLED"
    else
      echo "$key=disabled"
    fi
  done
'
```

Stop if any line says `ENABLED`. Deleting a table while its writer remains configured lets
ClickHouse recreate it and restarts the loop.

## 3. Remove the obsolete tables

The following is the complete destructive allowlist. Review it before execution: every target must
be in the `system` database, and no application archive/projection table may appear.

```bash
kubectl -n kvorum exec -i statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery
' <<'SQL'
DROP TABLE IF EXISTS system.metric_log SYNC;
DROP TABLE IF EXISTS system.asynchronous_metric_log SYNC;
DROP TABLE IF EXISTS system.trace_log SYNC;
DROP TABLE IF EXISTS system.part_log SYNC;
DROP TABLE IF EXISTS system.text_log SYNC;
DROP TABLE IF EXISTS system.error_log SYNC;
DROP TABLE IF EXISTS system.query_log SYNC;
DROP TABLE IF EXISTS system.query_thread_log SYNC;
DROP TABLE IF EXISTS system.query_views_log SYNC;
DROP TABLE IF EXISTS system.query_metric_log SYNC;
DROP TABLE IF EXISTS system.processors_profile_log SYNC;
DROP TABLE IF EXISTS system.asynchronous_insert_log SYNC;
DROP TABLE IF EXISTS system.opentelemetry_span_log SYNC;
SQL
```

These tables contain ClickHouse diagnostics only. The commands do not delete application data.

Restart ClickHouse once more to release part metadata and allocator-held memory:

```bash
kubectl -n kvorum rollout restart statefulset/kvorum-clickhouse
kubectl -n kvorum rollout status statefulset/kvorum-clickhouse --timeout=10m
```

## 4. Validate recovery

The disabled system-log tables must not be recreated, no system-log merge should remain, and the
application-table names and engines must match the output captured in section 1. Live ingestion can
increase row counts between captures, so compare them for unexpected decreases rather than exact
equality:

```bash
kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --query "SELECT name FROM system.tables WHERE database = '\''system'\'' AND name IN ('\''metric_log'\'', '\''asynchronous_metric_log'\'', '\''trace_log'\'', '\''part_log'\'', '\''text_log'\'', '\''error_log'\'', '\''query_log'\'', '\''query_thread_log'\'', '\''query_views_log'\'', '\''query_metric_log'\'', '\''processors_profile_log'\'', '\''asynchronous_insert_log'\'', '\''opentelemetry_span_log'\'') ORDER BY name"
'

kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --query "SELECT database, table, elapsed, num_parts FROM system.merges ORDER BY elapsed DESC FORMAT TSVRaw"
'

kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -lc '
  clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --query "SELECT name, engine, total_rows, total_bytes FROM system.tables WHERE database = '\''kvorum'\'' ORDER BY name FORMAT TSVRaw"
'

kubectl top node
kubectl -n kvorum top pod kvorum-clickhouse-0
```

Expected:

- the first query returns zero rows;
- `system.merges` contains no sustained `system.*_log` work;
- the `kvorum` table names and engines match the pre-cleanup capture, with no unexpected row-count
  decrease;
- ClickHouse and node CPU/memory settle below the workload's operational gate.

Do not run a historical backfill until the node remains below its runbook capacity thresholds for
at least ten minutes.
