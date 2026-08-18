# AI DLQ Triage Runbook — inspect + retry failed AI work

**Scope:** find and re-run AI jobs that failed. The AI worker has **two distinct dead-letter surfaces**, both
separate from the ingestion `ingestion_dlq`. There is **no `admin-cli ai dlq` command** — inspection is raw
SQL, retry is `admin-cli ai regenerate`.

Pairs with:

- [`m5-ai-backfill.md`](m5-ai-backfill.md) — the backfill is the main producer of DLQ volume.
- [`m5-budget-cap-ops.md`](m5-budget-cap-ops.md) — budget-skipped jobs are **not** failures (they ACK).

---

## Helpers

```bash
alias psql='docker compose exec -T postgres psql -U kvorum -d kvorum'
```

---

## The two AI DLQ tables

| Table        | Grain                         | Unique key                                   | Populated when                                                                                                                       |
| ------------ | ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ai_dlq`     | **schema-validation failure** | `(feature_name, prompt_version, input_hash)` | a model result fails `schema.safeParse` — stores `raw_output` + `zod_error`; the cost is still booked.                               |
| `ai_job_dlq` | **job-execution exhaustion**  | `(feature, entity_ref)`                      | a handler throws → pg-boss retries (`retryLimit: 3`) → dead-letters onto `<queue>_dlq` → `AiJobDlqBridge` drains it into this table. |

> **KNOWN-030.** `ai_job_dlq.attempts` is hardcoded to `0` (pg-boss does not surface the exhausted retry
> count) and `error` is always `{"name":"DeadLettered","message":"job <id> exhausted retries"}` — the real
> error is in the worker logs at failure time, not here. A transient PG failure during the bridge insert can
> silently drop a record; cross-check against the `ai_worker_job_queue_depth{queue=~".*_dlq"}` gauge if counts
> look low.

A budget-disabled job is **not** in either table — it is skipped and ACKed at the consumer
(`ai_worker_jobs_total{outcome="skipped_budget_disabled"}`), by design, so a capped feature never floods the
DLQ.

---

## Inspect

```bash
# Schema-validation failures (what the model returned that didn't parse):
psql -c "
  SELECT feature_name, prompt_version, left(input_hash, 16) AS input_hash,
         left(zod_error, 200) AS zod_error, created_at
  FROM ai_dlq ORDER BY created_at DESC LIMIT 50
"

# Job-execution exhaustion (which entity's job died):
psql -c "
  SELECT feature, entity_ref, created_at
  FROM ai_job_dlq ORDER BY created_at DESC LIMIT 50
"
```

Live dead-letter depth (the metric, per feature queue):

```bash
$ curl -s localhost:9091/metrics | grep 'ai_worker_job_queue_depth{queue=~".*_dlq"}'  # illustrative; scrape + filter
```

---

## Retry

Re-enqueue the entity onto its live queue with `ai regenerate` — the same content-addressed path the trigger
scanner uses. `<entity_reference>` is `<type>:<id>` (e.g. `proposal:<uuid>`, `forum_thread:<uuid>`), exactly as
stored in `ai_dlq.entity_reference` / `ai_job_dlq.entity_ref`.

```bash
admin-cli ai regenerate <feature> <entity_reference>
# examples:
admin-cli ai regenerate mismatch_detector proposal:0e1f...        # re-run a mismatch analysis
admin-cli ai regenerate forum_synthesizer forum_thread:abc-123 --force   # forum: bypass the content-hash cache
```

- **`--force`** bypasses the content-hash cache (honored by the forum synthesizer). Use it when the DLQ cause
  was transient (a flaky call), so an unchanged input still re-runs. Without `--force`, an unchanged input is a
  cache hit → no-op, which is what you want when the fix was a code/prompt change that bumped the version.
- A **schema-validation** DLQ (`ai_dlq`) usually means the prompt/schema needs a fix, not a blind retry —
  address the `zod_error` (often a prompt or `version:` bump; see
  [`m5-ai-model-version-bump.md`](m5-ai-model-version-bump.md)) before regenerating.
- The regenerate enqueue requires the **ai-worker to be running** (it owns/drains the pg-boss queues); the CLI
  errors clearly if the queue does not exist.

After a batch retry, re-check the tables — a fixed entity leaves no new row; a still-failing one reappears.
