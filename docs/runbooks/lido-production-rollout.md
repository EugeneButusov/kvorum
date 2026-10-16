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
- The Job never retries automatically. A source-scoped replacement Job resumes an unfinished
  source from its durable historical checkpoint.
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

For Snapshot, repeated `items 101 quiescent 0` lines are expected while the vote cursor advances:
one proposal boundary row plus a full 100-vote page were processed. This is not a stuck loop. Check
the `votes.skip` or `votes.createdGte` value in `off_chain_cursor` when progress is unclear; a run is
complete only after the structural cursor stops changing for the configured five quiescent ticks.

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
fixing the cause, repeat the preflight, then resume only the unfinished source as described below.
Do not create another full-DAO Job: the shared backfill lifecycle used by Aave and Compound clears a
source's historical checkpoint after successful completion, so a full replacement can safely but
expensively replay a completed sparse source from `active_from_block`.

### Resume an interrupted attempt source by source

Use the same single-source `backfill start` path documented for Aave and Compound. It selects
`resume` when `backfill_started_at_block` is present and `fresh` for an untouched source. Lido's
EVM source types resolve uniquely; `--dao lido` is needed only for the shared off-chain `snapshot`
and `discourse_forum` source types.

First correlate the saved Job summary with the checkpoint table. A source reported `completed` by
the Job must not be scheduled again even if a later aborted replay left another checkpoint. A source
reported `cancelled` or `error` with a non-null `backfill_started_at_block` is resumable. A source the
Job never started has both backfill columns null and starts fresh.

Run only one EVM source Job at a time. Set `SOURCE_TYPE` to one of `aragon_voting`,
`dual_governance`, `easy_track`, `snapshot_delegate_registry`, or
`snapshot_split_delegation`:

```bash
IMAGE=$(kubectl -n kvorum get deploy/kvorum-indexer \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
SOURCE_TYPE=snapshot_delegate_registry

case "$SOURCE_TYPE" in
  aragon_voting|dual_governance|easy_track|snapshot_delegate_registry|snapshot_split_delegation) ;;
  *) printf 'Unsupported Lido EVM source: %s\n' "$SOURCE_TYPE" >&2; exit 1 ;;
esac

PATCH=$(printf '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["node","dist/apps/admin-cli/main.js","backfill","start","%s","--format","json"]}]' "$SOURCE_TYPE")

JOB=$(
  kubectl patch --local -f infra/k8s/jobs/lido-backfill-job.yaml \
    --type=json -p "$PATCH" -o yaml \
  | kubectl set image --local -f - backfill="$IMAGE" -o yaml \
  | kubectl -n kvorum create -f - -o name
)

printf 'Created %s for %s\n' "$JOB" "$SOURCE_TYPE"
kubectl -n kvorum logs -f "$JOB"
```

After all five EVM sources are complete, drain each off-chain source in its own Job. Set
`SOURCE_TYPE` to `snapshot` and then `discourse_forum`:

```bash
IMAGE=$(kubectl -n kvorum get deploy/kvorum-indexer \
  -o jsonpath='{.spec.template.spec.containers[0].image}')
SOURCE_TYPE=snapshot

case "$SOURCE_TYPE" in
  snapshot|discourse_forum) ;;
  *) printf 'Unsupported Lido off-chain source: %s\n' "$SOURCE_TYPE" >&2; exit 1 ;;
esac

# Anonymous Snapshot access is limited to roughly 60 requests/minute per IP, and one tick fetches
# proposals and votes concurrently. Use a conservative delay unless a known-good key is configured.
INTER_TICK_DELAY=500
if [ "$SOURCE_TYPE" = snapshot ]; then INTER_TICK_DELAY=2500; fi

PATCH=$(printf '[{"op":"replace","path":"/spec/template/spec/containers/0/command","value":["node","dist/apps/admin-cli/main.js","backfill","start","%s","--dao","lido","--direct","--quiescence-ticks","5","--inter-tick-delay","%s","--format","json"]}]' "$SOURCE_TYPE" "$INTER_TICK_DELAY")

JOB=$(
  kubectl patch --local -f infra/k8s/jobs/lido-backfill-job.yaml \
    --type=json -p "$PATCH" -o yaml \
  | kubectl set image --local -f - backfill="$IMAGE" -o yaml \
  | kubectl -n kvorum create -f - -o name
)

printf 'Created %s for %s\n' "$JOB" "$SOURCE_TYPE"
kubectl -n kvorum logs -f "$JOB"
```

Apply the same capacity and cancellation gates to every targeted Job. Keep each Job name and final
summary in the operator record. A configured but invalid `SNAPSHOT_API_KEY` is worse than no key:
the client sends it on every request and Snapshot responds with HTTP 401. If the Snapshot Job fails
with `Snapshot GraphQL ... HTTP 401`, replace the key with a valid one or set it to an empty string,
then create a new targeted Job. Do not retry the same configuration.

## 4. Validate the completed backfill

Treat every check in this section as a release gate. Do not enable live polling if a command fails
or an expected result is missing.

### 4.1 Confirm every backfill Job outcome

Wait for the initial or final targeted Job and capture its final summary:

```bash
kubectl -n kvorum wait --for=condition=complete "$JOB" --timeout=24h
kubectl -n kvorum logs "$JOB"
```

Across the saved initial and targeted Job summaries, every planned source must be completed or
safely skipped, with no unresolved source error. A later cancelled replay does not invalidate an
earlier recorded `completed` result for the same source.

### 4.2 Check source state and durable cursors

Inspect all configured Lido sources and both cursor types:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT ds.source_type, ds.chain_id, ds.live_polling_enabled,
           ds.backfill_started_at_block, ds.backfill_head_block,
           ds.poll_cursor_block, oc.cursor AS off_chain_cursor, oc.updated_at
    FROM dao_source ds
    JOIN dao d ON d.id = ds.dao_id
    LEFT JOIN off_chain_cursor oc ON oc.dao_source_id = ds.id
    WHERE d.slug = 'lido'
    ORDER BY ds.source_type, ds.chain_id;
  "
```

Expected before activation:

- exactly ten rows and every `live_polling_enabled` value is `false`;
- no unfinished EVM source has an unexplained non-null backfill checkpoint. A checkpoint left by a
  later cancelled replay is acceptable only when the saved Job summary proves that source completed
  in an earlier attempt;
- `snapshot` and `discourse_forum` have non-null cursors whose final Job summaries reported five
  quiescent ticks;
- `poll_cursor_block` is null unless live polling was enabled previously.

### 4.3 Wait for derivation and reject unresolved failures

Wait until the indexer derives every Lido archive row:

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

Expected: zero rows. `ingestion_dlq` contains unresolved rows only; resolved rows are moved to
`ingestion_dlq_resolved`. Because shared Snapshot and Discourse DLQ rows do not carry a DAO id, this
is intentionally a conservative cluster-wide gate for every source type used by Lido.

### 4.4 Validate source-specific projections

Run the Postgres projection checks:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT p.source_type, p.state, count(*) AS proposals
    FROM proposal p JOIN dao d ON d.id = p.dao_id
    WHERE d.slug = 'lido'
    GROUP BY p.source_type, p.state
    ORDER BY p.source_type, p.state;

    SELECT dg.origin, dg.status, count(*) AS proposals
    FROM dual_governance_proposal dg JOIN dao d ON d.id = dg.dao_id
    WHERE d.slug = 'lido'
    GROUP BY dg.origin, dg.status
    ORDER BY dg.origin, dg.status;

    SELECT em.state, count(*) AS motions
    FROM easy_track_motion_meta em
    JOIN proposal p ON p.id = em.proposal_id
    JOIN dao d ON d.id = p.dao_id
    WHERE d.slug = 'lido'
    GROUP BY em.state
    ORDER BY em.state;

    SELECT sd.delegation_system, sd.event_type, count(*) AS events
    FROM snapshot_delegation sd
    WHERE sd.dao_id = (SELECT id FROM dao WHERE slug = 'lido') OR sd.dao_id IS NULL
    GROUP BY sd.delegation_system, sd.event_type
    ORDER BY sd.delegation_system, sd.event_type;

    SELECT count(*) AS forum_threads,
           count(*) FILTER (WHERE ft.raw_content IS NOT NULL) AS threads_with_content
    FROM forum_thread ft JOIN dao d ON d.id = ft.dao_id
    WHERE d.slug = 'lido';
  "
```

Expected:

- non-zero proposal counts for Aragon and Easy Track, and for Snapshot when the archive count for
  `SnapshotProposalCreated` is non-zero;
- a non-zero Dual Governance ledger. `origin = aragon` rows reuse their Aragon proposal, so zero
  unified `dual_governance` proposals is valid when there are no direct submissions;
- a plausible Easy Track state distribution, with historical motions in terminal states;
- non-zero `delegate_registry` or `split_delegation` facts only when that source's archive count is
  non-zero; an empty archive source does not require a fabricated projection;
- non-zero Discourse threads, with content derived for the crawled topics.

Verify that vote projections were written to ClickHouse for the Lido DAO:

```bash
LIDO_DAO_ID=$(kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -At -c "SELECT id FROM dao WHERE slug = 'lido'")

kubectl -n kvorum exec statefulset/kvorum-clickhouse -- sh -c \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
    --database "$CLICKHOUSE_DB" --param_dao_id "$1" --query \
    "SELECT count() AS votes FROM vote_events_projection WHERE dao_id = {dao_id:UUID}"' \
  sh "$LIDO_DAO_ID"
```

Expected: a non-zero count. If an archive source is non-empty but its corresponding projection is
empty, stop and investigate the indexer and DLQ before activation.

### 4.5 Validate the public read path

Use the dashboard BFF so this check covers the public route, dashboard-to-API routing, shared read
token, and API serialization together:

```bash
DASHBOARD_URL=${DASHBOARD_URL:-https://app.kvorum.watch}

curl -fsS "$DASHBOARD_URL/api/v1/daos/lido/sources" \
  | jq -e '
      (.data | length) == 10 and
      (["aragon_voting", "dual_governance", "easy_track", "snapshot", "discourse_forum"]
       - [.data[].source_type] | length == 0)
    '

for source_type in aragon_voting easy_track snapshot; do
  curl -fsS --get "$DASHBOARD_URL/api/v1/daos/lido/proposals" \
    --data-urlencode "source_type=$source_type" \
    --data-urlencode 'limit=1' \
    | jq -e --arg source_type "$source_type" \
        '.data | length == 1 and .[0].source_type == $source_type'
done
```

Every command must exit zero. Discourse is validated through `forum_thread`, not as a proposal
source. Dual Governance is validated through its ledger because correlated submissions deliberately
reuse Aragon proposals. If Snapshot has no `SnapshotProposalCreated` archive rows, omit `snapshot`
from the loop and record the empty upstream result instead.

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

### 5.1 Immediate activation checks

Confirm all ten flags are true and the indexer is stable:

```bash
kubectl -n kvorum exec statefulset/kvorum-postgres -- \
  psql -U kvorum -d kvorum -c "
    SELECT ds.source_type, ds.chain_id, ds.live_polling_enabled,
           ds.poll_cursor_block, oc.cursor AS off_chain_cursor, oc.updated_at
    FROM dao_source ds
    JOIN dao d ON d.id = ds.dao_id
    LEFT JOIN off_chain_cursor oc ON oc.dao_source_id = ds.id
    WHERE d.slug = 'lido'
    ORDER BY ds.source_type, ds.chain_id;
  "

kubectl -n kvorum get pod -l app.kubernetes.io/name=kvorum-indexer \
  -o jsonpath='{range .items[*]}{.metadata.name}{" ready="}{range .status.containerStatuses[*]}{.ready}{" restarts="}{.restartCount}{end}{"\n"}{end}'
kubectl -n kvorum logs deploy/kvorum-indexer --since=15m \
  | grep -Ei 'lido|error|failed|rate.?limit' || true
```

Expected: ten `true` flags, a ready indexer, no restart increase, and no repeating Lido errors.
Capture the source-state output, wait at least 15 minutes, then run it again. At least one applicable
watermark must advance when the source has new data; an unchanged watermark on a quiet source is not
by itself a failure.

### 5.2 Observation window

During the next 24 hours:

- repeat the underived-row and unresolved-DLQ queries from section 4.3 after 15 minutes, one hour,
  and 24 hours;
- confirm the indexer restart count remains stable and node memory stays below 90%;
- rerun the public read-path checks from section 4.5;
- inspect Lido source logs for repeating authentication, rate-limit, RPC, or derivation failures.

Close delivery only after the 24-hour checks pass. A quiet source need not advance during the
window, but every observed new archive row must derive successfully and remain readable through the
API.

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
