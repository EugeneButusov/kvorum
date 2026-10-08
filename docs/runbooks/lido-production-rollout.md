# Lido production rollout

Use this runbook for the first production backfill and live-polling activation of Lido's Aragon,
Dual Governance, Easy Track, Snapshot delegation, Snapshot, and Discourse sources.

The backfill Job archives history. The running indexer derives the unified projections. All Lido
sources stay paused until both stages have been validated.

## Safety model

- Run every command from a clean checkout of the same revision deployed to production.
- Keep `dao_source.live_polling_enabled = false` for every Lido source during the backfill.
- Use the dedicated Job in `infra/k8s/jobs/lido-backfill-job.yaml`; do not run this long process with
  `kubectl exec` inside the API or indexer container.
- The Job runs one source at a time and writes off-chain rows directly, avoiding an additional
  pg-boss backlog on the single-node cluster.
- The Job never retries automatically. A replacement Job resumes from durable checkpoints.
- Do not bypass the historical-log depth gate.

## 1. Preflight

Confirm the indexer is ready and its restart count has not changed for at least ten minutes:

```bash
kubectl -n kvorum get pod -l app.kubernetes.io/name=kvorum-indexer
kubectl -n kvorum get pod -l app.kubernetes.io/name=kvorum-indexer \
  -o jsonpath='{range .items[*]}{.metadata.name}{" ready="}{range .status.containerStatuses[*]}{.ready}{" restarts="}{.restartCount}{" started="}{.state.running.startedAt}{end}{"\n"}{end}'
```

Check the single node and its largest workloads:

```bash
kubectl top node
kubectl -n kvorum top pods --sort-by=memory
kubectl -n kvorum top pods --sort-by=cpu
```

Do not start while node CPU is at or above 70%, node memory is at or above 80%, or ClickHouse is
still sustaining a full CPU core. Wait for at least ten minutes of headroom; if the load does not
fall, diagnose it before adding backfill traffic. If `system.merges` shows only ClickHouse
diagnostic tables, follow [`clickhouse-system-log-cleanup.md`](clickhouse-system-log-cleanup.md).

Confirm every Lido source is paused and has no unexpected partial state:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT ds.id, ds.source_type, ds.chain_id, ds.live_polling_enabled,
           ds.backfill_started_at_block, ds.backfill_head_block, ds.poll_cursor_block
    FROM dao_source ds
    JOIN dao d ON d.id = ds.dao_id
    WHERE d.slug = 'lido'
    ORDER BY ds.source_type, ds.chain_id;
  "
```

Expected: ten rows, every `live_polling_enabled` value is `false`. On a first run, all three block
columns are null. Non-null backfill columns on a resumed run are expected; investigate any non-null
live cursor before continuing.

Run the zero-write plan and historical-provider gate:

```bash
kubectl -n kvorum exec deploy/kvorum-api -- \
  node dist/apps/admin-cli/main.js backfill run lido --dry-run --format json
```

Continue only when the command exits zero and prints `"gate_failures":[]`.

## 2. Create the backfill Job

Pin the Job to the exact application image used by the indexer. Do not use a floating `latest` tag.
`generateName` gives each attempt a unique name, so a failed attempt and its logs remain available.

```bash
IMAGE=$(kubectl -n kvorum get deploy/kvorum-indexer \
  -o jsonpath='{.spec.template.spec.containers[0].image}')

JOB=$(
  kubectl set image --local -f infra/k8s/jobs/lido-backfill-job.yaml \
    backfill="$IMAGE" -o yaml \
  | kubectl -n kvorum create -f - -o name
)

printf 'Created %s with %s\n' "$JOB" "$IMAGE"
kubectl -n kvorum get "$JOB" -o wide
```

Save the printed `JOB` value in the operator log. If the shell is closed, recover the newest Job:

```bash
JOB=$(kubectl -n kvorum get jobs \
  -l app.kubernetes.io/name=kvorum-lido-backfill \
  --sort-by=.metadata.creationTimestamp -o name | tail -1)
```

## 3. Monitor

Follow structured backfill progress:

```bash
kubectl -n kvorum logs -f "$JOB"
```

`Ctrl-C` only disconnects from the log stream; it does not cancel the Job. In another terminal,
monitor the Job, node capacity, archive growth, and derivation backlog:

```bash
kubectl -n kvorum get "$JOB" -w
kubectl top node
kubectl -n kvorum top pods --sort-by=memory

kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT ae.source_type, ae.chain_id, count(*) AS rows,
           max(ae.block_number) AS max_block,
           count(*) FILTER (WHERE ae.derived_at IS NULL) AS underived
    FROM archive_event ae
    JOIN dao_source ds ON ds.id = ae.dao_source_id
    JOIN dao d ON d.id = ds.dao_id
    WHERE d.slug = 'lido'
    GROUP BY ae.source_type, ae.chain_id
    ORDER BY ae.source_type, ae.chain_id;
  "
```

Stop and investigate if node memory reaches 90%, ClickHouse or Postgres is repeatedly restarting,
the indexer becomes unready, or the Job stops making progress. To cancel cleanly, signal the CLI
instead of deleting the Job:

```bash
JOB_NAME=${JOB#job.batch/}
POD=$(kubectl -n kvorum get pods -l job-name="$JOB_NAME" \
  -o jsonpath='{.items[0].metadata.name}')
kubectl -n kvorum exec "$POD" -- sh -c 'kill -TERM 1'
kubectl -n kvorum logs "$JOB"
```

The Job has `backoffLimit: 0`, so Kubernetes will not restart a cancelled or failed attempt. After
fixing the cause, repeat sections 1 and 2; the next Job resumes the durable backfill state.

## 4. Validate the completed backfill

Wait for the Job and then capture its final summary:

```bash
kubectl -n kvorum wait --for=condition=complete "$JOB" --timeout=24h
kubectl -n kvorum logs "$JOB"
```

The summary must report every planned source as completed or safely skipped, with no source error.
Then wait until the indexer derives every Lido archive row:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT ae.source_type, ae.chain_id, count(*) AS underived
    FROM archive_event ae
    JOIN dao_source ds ON ds.id = ae.dao_source_id
    JOIN dao d ON d.id = ds.dao_id
    WHERE d.slug = 'lido' AND ae.derived_at IS NULL
    GROUP BY ae.source_type, ae.chain_id
    ORDER BY ae.source_type, ae.chain_id;
  "
```

Expected: zero rows. Check for unresolved Lido ingestion failures:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT q.stage, q.archive_source_type, q.archive_chain_id, count(*)
    FROM ingestion_dlq q
    WHERE q.archive_source_type IN (
      SELECT ds.source_type
      FROM dao_source ds JOIN dao d ON d.id = ds.dao_id
      WHERE d.slug = 'lido'
    )
    GROUP BY q.stage, q.archive_source_type, q.archive_chain_id
    ORDER BY q.stage, q.archive_source_type, q.archive_chain_id;
  "
```

Expected: zero rows. Before activation, also verify:

- Aragon, Dual Governance, Easy Track, Snapshot, and Discourse proposals appear through the API.
- vote and delegation projections have non-zero counts where their source archives are non-empty.
- Dual Governance proposals have the expected Aragon/direct origin classification.
- Easy Track motions have plausible active/enacted/cancelled terminal-state distributions.
- Snapshot and Discourse cursors reached quiescence in the Job summary.

Record the archive counts, Job name, image digest, final summary, and validation results in the
delivery issue.

## 5. Enable live polling

Resume all ten Lido rows only after section 4 passes. The flags take effect on the next indexer
restart.

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -At -c "
    SELECT ds.id
    FROM dao_source ds JOIN dao d ON d.id = ds.dao_id
    WHERE d.slug = 'lido'
    ORDER BY ds.source_type, ds.chain_id;
  " \
| while IFS= read -r source_id; do
    kubectl -n kvorum exec deploy/kvorum-api -- \
      node dist/apps/admin-cli/main.js daos source resume "$source_id" --format json
  done

kubectl -n kvorum rollout restart deploy/kvorum-indexer
kubectl -n kvorum rollout status deploy/kvorum-indexer --timeout=10m
```

Confirm all ten flags are true, the indexer restart count remains stable, and Lido cursors advance.
Observe the rollout for 24 hours before closing delivery.

## Rollback

If Lido live polling causes errors or unacceptable load, pause all Lido rows and restart the
indexer. This preserves the archived and derived data while stopping new Lido ingestion:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -At -c "
    SELECT ds.id
    FROM dao_source ds JOIN dao d ON d.id = ds.dao_id
    WHERE d.slug = 'lido'
    ORDER BY ds.source_type, ds.chain_id;
  " \
| while IFS= read -r source_id; do
    kubectl -n kvorum exec deploy/kvorum-api -- \
      node dist/apps/admin-cli/main.js daos source pause "$source_id" --format json
  done

kubectl -n kvorum rollout restart deploy/kvorum-indexer
kubectl -n kvorum rollout status deploy/kvorum-indexer --timeout=10m
```

Do not delete archive or projection rows as part of rollback. Diagnose the source, RPC, or capacity
failure and resume from the existing cursors after a fix is deployed.
