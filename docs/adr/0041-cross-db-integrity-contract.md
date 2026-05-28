# ADR-041 — Cross-DB integrity contract for the ClickHouse archive ↔ Postgres tracker

- **Status**: Accepted (2026-05-10)
- **Date**: 2026-05-10
- **Spec sections affected**: 2.6, 3.2, 3.3, 3.12
- **Amends**: 0062
- **Related**: ADR-038 (introduced the split), ADR-027 (backfill cutoff)

## Context

ADR-038 splits the event archive into a ClickHouse data plane (immutable raw events) and a Postgres `archive_event` control plane (mutable status). The ADR enumerates failure modes briefly (lines 64–68) but does not specify the **write protocol** F1 must follow, the **idempotency-check pattern**, the **retry semantics**, or what the deferred-to-M2 reconciliation job actually does. Three review concerns surfaced these as gaps:

1. F1 author has no committed contract for "have I already written event X?" — leaving the choice to runtime invention risks inconsistency between the two writers (real-time path + backfill).
2. The ADR-038 framing "DLQ catches the PG retry" is misleading because the DLQ table lives in Postgres — if PG is unreachable, the DLQ row cannot be written either.
3. ClickHouse `ReplacingMergeTree` deduplication is **eventual** (asynchronous merge): a re-insert after a transient failure produces a transient duplicate visible to readers until the next merge runs. Without a defined read-side semantic, G1 may see two payload rows for the same idempotency key during the merge window.

This ADR fixes the contract.

## Decision

### Write protocol (F1, I1)

Every archive write — whether real-time (F1 from polling) or backfill (I1) — follows this sequence:

1. **PG-first existence check.** Read `archive_event` by the 5-tuple `(source_type, chain_id, tx_hash, log_index, block_hash)`. If a row exists with `confirmation_status IN ('pending', 'confirmed')`, the event is already persisted — return success without writing.
2. **CH insert.** `INSERT INTO event_archive_<source> VALUES (...)`. ClickHouse's `ReplacingMergeTree(received_at)` absorbs duplicates from concurrent or retried writes idempotently (eventually); the insert is safe to repeat.
3. **PG insert.** `INSERT INTO archive_event (...) VALUES (...) ON CONFLICT DO NOTHING` on the 5-tuple unique index. The `confirmation_status` written depends on the writer: F1 writes `'pending'`; I1 writes `'confirmed'` directly per ADR-027.
4. **Bounded in-process retry.** Wrap step 3 in 3 attempts × exponential backoff (200ms, 600ms, 1.8s). On exhaustion, route to DLQ via step 5.
5. **DLQ on persistent PG failure.** If step 3 exhausts retries, write `ingestion_dlq` with `stage='archive_event_write'`, `event_archive_key` carrying the 5-tuple as typed columns. If PG is itself unreachable for the DLQ insert, increment Prometheus counter `kvorum_dual_write_pg_unreachable_total` and abort the worker poll cycle — the next poll re-runs step 1 and finds the CH row already present.

The PG-first check is the load-bearing primitive: it makes step 1 the source-of-truth for "did this event get persisted," removes the dependency on CH eventual-merge timing, and lets the worker be stateless.

### Read protocol (G1, dlq retry)

Readers that need the raw payload follow this sequence:

1. **PG selects** canonical-confirmed `archive_event` rows for the source (using the `derived_at` watermark).
2. **CH lookup** by the 5-tuple, with `SELECT ... FINAL` modifier to force at-read deduplication. This handles the merge-window window where two physical rows exist for one logical idempotency key.

`SELECT ... FINAL` carries a query-cost penalty (per-granule dedup) but is correct under all merge states. For batched lookups (G1's typical pattern: 100 confirmed PG rows → 1 CH lookup), the cost is amortized across the batch.

### Read batching (G1)

G1 batches its CH lookups: select up to 500 confirmed PG rows ordered by `(dao_source_id, block_number)`, then issue a single CH query of the form

```sql
SELECT chain_id, tx_hash, log_index, block_hash, payload
FROM archive_event_compound_governor_bravo FINAL
WHERE (chain_id, tx_hash, log_index, block_hash) IN (
  (1, '0xabc...', 0, '0xdef...'),
  ...
);
```

The 500-row batch size is the tuned default; revisit if `kvorum_derivation_batch_lookup_seconds` exceeds p99 1s.

### Reconciliation job (M2)

A periodic reconciliation job (M2 deliverable) catches the small inconsistency window where step 2 (CH insert) succeeds but step 3 (PG insert) fails before any DLQ write:

- **CH-orphan sweep.** Hourly, query CH for rows with `received_at < now() - INTERVAL 1 HOUR` (older than the F1 retry budget) and check whether `archive_event` has the matching tuple. If not, insert a `pending` row in PG; the normal F2 promotion sweep then handles confirmation.
- **PG-orphan sweep.** Symmetrically, query PG for `archive_event` rows whose CH counterparts are missing (per `SELECT 1 FROM event_archive_<source> FINAL WHERE ...`). If found, route to DLQ with `stage='reconciliation_pg_orphan'` for operator inspection — this case should not happen under the write protocol above and indicates a bug.

Reconciliation does **not** run in M1. The risk window is the few minutes between an F1 worker crash and the next worker startup, with PG unreachable as the failure mode. M1 accepts this window; M2 closes it.

### Reorg semantics

F2 reorg detection writes `reorg_event` and updates `archive_event` rows in Postgres only. ClickHouse archive rows are never updated — the canonical-vs-orphaned distinction lives entirely in `archive_event.confirmation_status` and the partial unique index on canonical rows. Two CH rows with different `block_hash` for the same `(chain_id, tx_hash, log_index)` is the expected representation of a reorg trace; G1's read protocol filters via the PG canonical-row selection, so orphaned-block payloads never reach derivation.

## Alternatives considered

- **CH-first existence check.** Rejected. ClickHouse merge timing makes "is this row in CH yet" ambiguous during the merge window; the PG row is unambiguous because Postgres unique indexes commit synchronously.
- **Two-phase commit / XA across PG + CH.** Rejected. ClickHouse does not support distributed transactions. Even if it did, 2PC adds latency, lock contention, and operational complexity disproportionate to the small risk window we accept.
- **Write to PG first, then CH.** Considered. Symmetric to the chosen protocol. Rejected because (a) the CH row is the source of truth for the payload, so its presence should precede any tracking row, and (b) the PG-first existence check is more useful as a probe than a write.
- **Write to a write-ahead log (Kafka) and let consumers fan out.** Rejected at v1 scale. SPEC §7.1 commits to a single-host deployment without Kafka. Re-architects the M1 ingestion path for a problem that the PG-first check resolves directly.
- **Skip the existence check; rely entirely on idempotent inserts.** Considered. Works correctness-wise (both inserts are idempotent), but makes every retry pay the CH insert cost (network + ZSTD compression), and amplifies the merge-window duplicate visibility window. The PG SELECT is fast (single B-tree lookup) and dominantly cheaper than the CH insert.

## Consequences

- **F1 contract is fully specified.** The PG-first check, CH-then-PG write order, retry budget, and DLQ fallback are all part of F1's PR review surface.
- **G1 contract is fully specified.** Read protocol with `FINAL` modifier and 500-row batch size are committed defaults.
- **M2 inherits the reconciliation job** as a tracked deliverable (CH-orphan sweep, hourly cadence).
- **DLQ schema gains `stage` values** `'archive_event_write'` and `'reconciliation_pg_orphan'` (defined as text values, not enum, per existing DLQ design).
- **`ReplacingMergeTree(received_at)` semantic** is now documented: `received_at` is the **most-recent observation timestamp**, not first-observation. F1 may legitimately re-observe the same canonical event via polling fallback (per SPEC §3.3), and the kept value advances with each observation. If forensic "first observation" is ever needed, a separate `first_observed_at` column ships in a follow-up migration; M1 does not need it.
- **Smoke tests** use `SELECT ... FINAL` rather than `OPTIMIZE TABLE FINAL`. The latter is reserved for manual operator intervention only and is documented as such in the runbook.
- **Prometheus metrics** introduced (M1 scope, surfaced through F1's existing instrumentation):
  - `kvorum_dual_write_pg_unreachable_total{source}` — counter, increments on step 5 failure.
  - `kvorum_archive_skipped_existence_total{source}` — counter, increments on step 1 hit (event already persisted).
- **CLAUDE.md amendment.** Add a one-paragraph "Cross-DB writes" subsection under "Database access convention" pointing at this ADR.

## Implementation notes

- The PG-first existence check uses the `archive_event` 5-tuple unique index — index-only scan, no heap access in the common case.
- ClickHouse's `OPTIMIZE TABLE event_archive_<source> FINAL` is **never** issued by application code or scheduled jobs. It rewrites entire parts and is reserved for manual operator intervention (e.g., post-bulk-backfill compaction). Documented in the M1 runbook.
- F1's write path emits structured logs at each step transition (`archive_check_skip`, `ch_inserted`, `pg_inserted`, `dlq_routed`) keyed by the 5-tuple, supporting per-event forensics without enabling debug-level logging.

---

## Rider — 2026-05-11 (F1 refinements)

Three refinements at the Decision boundaries surfaced during F1 implementation review. None alter the PG-first, CH-then-PG, retry, DLQ, or reconciliation contract; this rider records the deltas so F1's PR review surface stays aligned with the ADR.

1. **Transient-vs-permanent PG error classification.** Step 4's 3-attempt retry budget applies only to **transient** PG errors. The transient allowlist is:
   - Connection-level: `08000`, `08001`, `08003`, `08006`, `08007`
   - Admin/shutdown: `57P01`, `57P02`, `57P03`
   - Serialization: `40001`, `40P01`

   **Non-transient** errors (FK/CHECK `23xxx`, syntax `42xxx`, and any unmapped code) route to DLQ on the **first** failure without retry. Retrying a deterministic logic error wastes I/O and obscures the real failure mode in metrics. F1 implements this via a small `isTransientPgError(err)` helper colocated with the writer.

2. **`archive_ch_write` DLQ stage.** Consequences §"DLQ schema gains stage values" extends with a third value, `archive_ch_write`, for failures during step 2 (CH insert). The writer wraps step 2 in `try`/`catch`; on failure it routes the event to DLQ with the 5-tuple as typed columns and the raw log (`{ topics, data }`) in the payload, then continues the batch. This avoids the "single CH glitch drops N-1 events in the batch" hazard called out in F1 review.

3. **CH `received_at` is server-stamped.** The Consequences note on `ReplacingMergeTree(received_at)` semantic (most-recent observation wins) continues to hold. The **provenance** changes: the writer no longer supplies `received_at`; the column is `DateTime DEFAULT now()` and CH stamps it on receipt. This sidesteps client-clock-skew failure modes that could silently drop the freshest observation under future multi-replica deployments. PG-side `received_at` continues to be JS-side `new Date()`; the sub-second–to–seconds gap between CH and PG timestamps for the same logical event is accepted.

4. **DLQ row payload shape.** Consequences clarification: F1's DLQ rows store the **raw** log (`{ raw: { topics, data }, reason? }`) plus the typed 5-tuple, not the decoded payload. Decode is deterministic and re-runs on retry. This minimises DLQ row size (raw is ~200 B vs decoded payloads up to ~50 KB for Compound's `ProposalCreated`) and keeps the chain as the single source of truth for the event content. An `admin-cli dlq inspect <id>` helper that lazily re-decodes for operator forensics is a follow-up (Epic I).

---

## Rider amendment — 2026-05-12 (retraction of §2)

F1 implementation review surfaced a stale-tombstone hazard in the §2 `archive_ch_write` DLQ path: when CH recovers on the next 12-s tick, the writer succeeds (step 1 sees no PG row → step 2 CH insert succeeds → step 3 PG insert succeeds), but the DLQ row from the prior tick remains in `ingestion_dlq` with the same 5-tuple — a tombstone for an event that has since landed canonically. `admin-cli dlq retry` (Epic I) would re-attempt and hit `skipped_existing`; metrics like a hypothetical `kvorum_ingestion_dlq_depth` would double-count.

**§2 is retracted.** CH-insert errors no longer route to DLQ. Instead:

- The writer does NOT wrap step 2 in a try/catch. CH exceptions propagate out of `ArchiveWriter.write()`.
- The listener (F1c's `makeIngesterListener`) wraps each per-event `archiveWriter.write()` call in its own try/catch. On a CH-insert exception it increments a dedicated counter `kvorum_archive_ch_write_errors_total{source}`, logs the failure with the 5-tuple, and **continues the batch** to the next event.
- The next 12-s EventPoller tick re-fetches the window and re-runs step 1 → finds no PG row → retries CH insert (ReplacingMergeTree absorbs the duplicate if both eventually land).

This preserves the original §2 motivation ("a single CH glitch must not drop the rest of the batch") via per-event isolation at the listener rather than at the writer. It also removes the `archive_ch_write` value from the DLQ `stage` enum — the supported stages in M1 are `archive_event_write` (step 3 exhaustion or permanent error), `archive_decode` (DecodeError on a filtered log), and `reconciliation_pg_orphan` (M2 reconciliation, deferred).

§1 (transient PG error classification), §3 (server-stamped `received_at`), and §4 (raw-only DLQ payload) of the 2026-05-11 rider are unaffected and stand as written.

### Updated Consequences delta

The 2026-05-11 rider's "DLQ schema gains stage value `archive_ch_write`" line is **withdrawn**. The DLQ `stage` text values in M1 remain those listed in the original Decision section + `archive_decode` (F1c listener). No schema change is needed because the column was always `text` (per existing DLQ design).

### New Consequences

- `kvorum_archive_ch_write_errors_total{source}` — counter, increments when the listener catches an exception from `archiveWriter.write()`. Single source of truth for CH-side write failures.
- `kvorum_archive_decode_errors_total{source,reason}` — counter, increments on `DecodeError`. Decode failures are tracked on this counter rather than on `kvorum_ingestion_archive_writes_total{result}` so the result enum stays clean.

---

## Rider — 2026-05-12 (race-window narrow 23505) — **RETRACTED 2026-05-24**

> **Retracted by ADR-058 (2026-05-24).** This rider's rationale was specific to the pending/orphaned
> status plane and the reorg window. With confirmed-head-only ingestion every insert is canonical
> at write time; the `idx_archive_event_canonical` partial unique no longer exists; and the
> ReorgWatcherService that created the race condition has been deleted. The 4-tuple
> `archive_event_idempotency_key` is a true unique (not partial), so 23505 on conflict is handled
> entirely by `ON CONFLICT DO NOTHING` and never triggers the retry path described here.
> Riders 1 and 2 survive verbatim.

Refines the 2026-05-11 rider §1 ("23xxx → DLQ on first failure"). Carve out one
narrow exception: 23505 raised by `idx_archive_event_canonical` (the
4-tuple partial unique) is retriable transient.

Rationale: the EventPoller can observe a new-branch event before
ReorgWatcherService has committed the orphan transaction for the old-branch
sibling. During that race window, the new pending insert lands on a 4-tuple
that already has a (pending) row for a different block_hash, triggering 23505
on the partial unique. The condition resolves deterministically once the
watcher transaction commits and the old sibling becomes `orphaned`
(excluded from the partial unique).

The transient-allowlist test is constraint-name match, not SQLSTATE alone:
other 23505 cases (e.g. duplicate (source_type, chain_id, tx_hash, log_index,
block_hash) at the 5-tuple key) are still handled by `ON CONFLICT DO NOTHING`
on the idempotency-key constraint and never reach the retry path.

Implementation: `isCanonicalPartialUniqueViolation` in libs/db/src/utils.ts;
ConfirmationRepository.insert retries on either `isTransientDbError(err) ||
isCanonicalPartialUniqueViolation(err)`. Retry budget (3 × 200/600/1800 ms) is
unchanged. On exhaustion the row still DLQs.

Known M1 limitation: the retry budget (2.6 s cumulative) may exhaust before the
watcher transaction commits under severe PG pool saturation. On exhaustion the
row routes to `ingestion_dlq` and is NOT recovered by the orphan-state
reconciliation sweep (that sweep walks `archive_event`, not DLQ rows).
Operator `admin-cli dlq retry` is required in that case. M2 may add a longer
backoff class for the canonical-partial-unique constraint if the DLQ-on-race-window
rate is non-trivial in production.

---

## Rider — 2026-05-12 (orphan-state reconciliation sweep, narrow coverage) — **RETRACTED 2026-05-24**

> **Retracted by ADR-058 (2026-05-24).** This rider described a sweep to catch archive rows that
> remained `pending` after a reorg transaction race. With confirmed-head-only ingestion there is no
> `pending` status, no `reorg_event` table, and no orphan-state transition. The sweep, its metrics,
> and the M2 "reorg signal WAL" sub-task it referenced are all dissolved.

Extends the M2 reconciliation contract (Decision §Reconciliation job) with a
third sweep covering a narrow orphan-state inconsistency window.

Window covered:
ReorgWatcherService runs writeReorgEventAndOrphan inside a PG transaction.
Between the UPDATE statement (which orphans rows existing at that instant)
and the transaction commit, EventPoller writes additional pending rows for
the same block_hash (e.g., the poller batch straddles the reorg signal and
inserts rows that the UPDATE's snapshot did not see). These rows remain
`pending` despite their block_hash now appearing in a committed reorg_event
row.

Window NOT covered (residual risk D-F2b-3, carried to M2):
writeReorgEventAndOrphan's transaction throws and rolls back entirely. No
reorg_event row exists; the orphan UPDATE did not commit. The sweep cannot
recover these rows because reorg_event.orphaned_block_hashes is empty for
exactly this case. The reorg detector's sliding-window buffer has typically
advanced, so the signal is not re-emitted. The 30-second promotion sweep
will eventually confirm the rows.

M2 must address this with a signal-persistence mechanism (e.g., a
reorg_signal_pending queue written before the watcher transaction, with
the watcher draining it on commit). Out of scope for this rider; tracked
separately in M2 backlog as the "reorg signal WAL" sub-task.

Sweep design — narrow orphan-state reconciliation (M2):

- Hourly, for each chain, build the union U of all
  reorg_event.orphaned_block_hashes for detected_at > now() - INTERVAL 7 DAY
  (or since last reconciliation watermark).
- Query archive_event WHERE block_hash IN U AND
  confirmation_status <> 'orphaned'.
- For each such row, transition to orphaned with orphaned_at = now() and
  orphaned_by_reorg_event_id set to the reorg event that lists the block hash.
  (If multiple events list the same hash — unlikely but possible across chain
  forks — pick the earliest by detected_at.)
- Emit a kvorum_reconciliation_orphan_state_total counter increment per
  recovered row, and a kvorum_reconciliation_orphan_state_seconds histogram
  per sweep run.

Why this fits ADR-041 — reconciliation already owns the "CH wrote, PG didn't"
window via CH-orphan sweep + PG-orphan sweep. This sweep is the symmetric
"PG should-have-orphaned-some-late-arrivers, didn't" window. All three use the
same hourly cadence and emit the same observability contract shape.

Metric name vetting: confirmed no collision with existing
kvorum_dual_write_pg_unreachable_total / kvorum_archive_skipped_existence_total
metric names.

M1 risk acceptance: the residual full-rollback window (D-F2b-3) is logged
loudly by ReorgWatcherService.handleReorg's catch block (reorg_write_failed
structured log). Operators paging on this log line can manually orphan affected
rows via admin-cli pending the M2 WAL fix.

---

## Amendment — 2026-05-28 (derivation write protocol simplifies + read-protocol 5-tuple superseded)

The PG-first existence check + CH-then-PG-with-retry + DLQ protocol (original §"Write protocol (F1, I1)") remains the contract for **archive ingestion** (raw chain events landing in `archive_event_*` CH + `archive_event` PG tracker).

For **derivation** (applier-side writes producing `vote_events_projection`, `delegation_flow_projection`, `voting_power_snapshot_projection`), the protocol is simpler: CH insert is idempotent via `ReplacingMergeTree(version)` with server-side `now64(6)`; on success the PG `archive_event.derived_at` watermark is set. If the watermark update fails, the next derivation tick re-runs the applier; CH absorbs the duplicate insert via version-overwrite under FINAL.

The G1 read protocol (Decision §"Read protocol") remains the contract for archive payload reads — **with one cross-reference correction (D16):** the original §"Read protocol" references a 5-tuple `(source_type, chain_id, tx_hash, log_index, block_hash)` idempotency key. ADR-058 narrowed the key to a 4-tuple `(source_type, chain_id, tx_hash, log_index)` by removing `block_hash` (no reorg machinery, no orphan distinction). The 4-tuple is authoritative.

Cite ADR-0062 + ADR-058 + PR #220.
