# ADR-0063: pg-boss job-based ingestion pipeline (producer/consumer)

- **Status**: Accepted
- **Date**: 2026-05-30
- **Supersedes**: Epic P reconciliation sweeps (ADR-0041 §Reconciliation job)
- **Amends**: 0021, 0041, 0058, 0059
- **Related**: ADR-0058 (confirmed-head ingestion — premise), ADR-0041 (cross-DB integrity contract), epic #227, PR-A #229, PR-C #230, PR-D #231

## Context

ADR-0041 committed to a deferred M2 reconciliation job (CH-orphan sweep + PG-orphan sweep) to close the inconsistency window where a CH write succeeds but the `archive_event` PG insert never completes. Two developments made that design obsolete before it shipped:

1. **ADR-0058** deleted the entire reorg control plane (pending/confirmed/orphaned + `reorg_event` table). The orphan-state sweep (the "narrow window" rider in ADR-0041) was **RETRACTED** on 2026-05-24 with ADR-0058.
2. **Write ordering is a choice, not a necessity.** The only durable inconsistency the CH-orphan sweep hunted came from inserting the CH payload _before_ the durable `archive_event` PG row. Reversing that order — PG-first, or more precisely **CH-first with `archive_event` immediately after** — makes the invariant structural: a row's existence in `archive_event` implies its CH payload exists.

The existing polling listener triggers on every confirmed-block log; it decodes, classifies, and writes directly. This path is correct for backfill but fragile for real-time ingestion: a CH write that completes while the PG `archive_event` insert fails leaves an orphan that the sweep would have caught. With the sweep removed and the write-order reversed, the window disappears structurally.

## Decision

### Architecture

Replace the real-time write path with a **producer/consumer pipeline** built on pg-boss (Postgres-backed durable job queue):

**Producer (generic, domain-blind):**

- Runs in the existing polling listener, triggered once per confirmed log.
- In a single Kysely transaction: insert the chain-coordinate into `seen_log(chain_id, tx_hash, log_index, block_number)` with `ON CONFLICT … RETURNING`; only when a _new_ coordinate is recorded, enqueue an `archive_log` pg-boss job carrying the raw log payload.
- Job payload contains only chain-structural fields + the emitting contract address: `{ chainId, blockNumber, blockHash, txHash, logIndex, address, topics, data }`. No domain columns. No `sourceType`.
- `seen_log` is block-height-pruned (not time-TTL) inline with the poll window; the table stays bounded.

**Consumer (owns the domain):**

- Drains `archive_log` jobs; runs with `localConcurrency = 1` (Epic 1).
- Per job: resolve `address → source` via a **rebuildable** map (rebuilt on miss before dead-lettering, not frozen at startup); decode the log; classify `event_type`; **CH insert** → `[txn]` **INSERT `archive_event`** with 4-tuple `ON CONFLICT DO NOTHING`.
- Writing `archive_event` CH-first restores the original "row exists ⇒ archived" invariant without a sweep. A CH write that completes and then crashes before `archive_event` is re-tried by pg-boss; the CH insert is idempotent (`ReplacingMergeTree` / now AggregatingMergeTree); the `ON CONFLICT` guard catches duplicates.

**Backfill is untouched** — the direct `find()` short-circuit + `writeCore` path is preserved in the backfill driver (Q4). Only the real-time path changes.

### pg-boss wiring (D-EXEC-3)

- A `PgBossLifecycle` provider owns `new PgBoss({ …, migrate: false })` + `start()` (verify-only). pg-boss schema applied as a Kysely migration step (`0009_pgboss_schema.ts`); `migrate: false` on the constructor ensures `start()` only verifies, never auto-migrates.
- Separate provider(s) register `work()` handlers (consumer + DLQ-bridge) and await `lifecycle.whenReady()` before registering.
- pg-boss version pinned at `^12.18.2`. Key API notes: `getConstructionPlans(schema)` and `getMigrationPlans(schema, version)` are **module-level named exports**, not static `PgBoss.*` methods. `getQueueStats(name).queuedCount` is the depth API; `getQueueSize` does not exist in v12. Queue creation via `createQueue` (required before `send`/`work` on v12).

### `seen_log` prune cadence (D-EXEC-4)

A `SeenLogPruneService` runs the block-height `DELETE` on an interval ≈ `N × pollIntervalMs` (default `N` configurable, e.g. 10). Reads `confirmedHead` per chain via the chain registry (same pattern as the archive-lag gauge in `IndexerOrchestratorService`). The prune horizon is `confirmedHead − blockWindow − safetyMargin` so no in-window coordinate is pruned.

### Two-layer idempotency

- **Layer 1 — `seen_log`:** queue hygiene. The transactional enqueue ensures exactly-once-into-queue per chain coordinate. A re-scan of an already-recorded coordinate enqueues nothing.
- **Layer 2 — `archive_event` 4-tuple `ON CONFLICT`:** authoritative domain guard. A duplicate `archive_log` job (pg-boss retry or manual replay) yields exactly one `archive_event` row.

### No detection-gap reconciliation

Exceptional CH durability loss (manual `DROP PARTITION`, lost replica part) is handled case-by-case via operator intervention — `admin-cli backfill`. It is not baked into the application design. See G8 (design doc R4 dropped).

### Deployment sequencing

PR-C (producer) and PR-D (consumer) ship in the **same deploy**. A producer-only `main` would accumulate `archive_log` jobs under `deleteAfterSeconds` retention while `seen_log` self-prunes by block height — events past retention would require backfill recovery. They may be reviewed as separate PRs but must merge/deploy together.

## Consequences

- Postgres is the single durable store for ingestion correctness (no Redis for ingestion queuing).
- "Find work by scanning the other DB" (reconciliation sweep) becomes "consume your queue." The anti-orphan guarantee is structural.
- Backfill continues to use the direct path; no feature flags; no dual-write shim.
- Epic 2 (co-timed with M5) will make vote/delegation projections order-independent, removing the `localConcurrency = 1` constraint and enabling intra-protocol parallelism.
- ai-worker (M5) queue choice is **not pre-committed to pg-boss** — deferred to M5 evaluation.

## Alternatives rejected

- **Redis + BullMQ for ingestion queuing** — rejected: adds an availability dependency (Redis outage = no ingestion); pg-boss reuses the existing PG connection; Postgres durability is already required.
- **`singletonKey` as idempotency** — rejected: pg-boss v12 `singletonKey` prevents duplicate _enqueue_, not duplicate _execution_ on retry; the 4-tuple `ON CONFLICT` guard is the right idempotency boundary.
- **Time-TTL pruning for `seen_log`** — rejected: block-height pruning is deterministic and aligned with the confirmed-head model; time-TTL can prune a coordinate that a lagging chain hasn't processed yet.
- **Door-gate (check `archive_event` before enqueue)** — rejected: the gate is not transactional with the enqueue; a crash between them can still produce an orphan. Transactional `seen_log` insert + enqueue is the correct primitive.
- **Pure flood (enqueue every log, deduplicate in consumer via `ON CONFLICT`)** — rejected: enqueues N × retries per log with no queue-side dedup; `seen_log` provides cheap pre-consumer filtering.
