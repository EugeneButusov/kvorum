# ADR-038 — Split ClickHouse archive layer from analytical mirror; archive ships in M1

- **Status**: Accepted (2026-05-10; amended same date — see "Amendments" below)
- **Date**: 2026-05-10
- **Spec sections affected**: 2.6, 2.7, 3.2, 3.3, 3.4, 7.1, 7.5, 10.4
- **Related**: supersedes ADR-026; refined by ADR-041 (cross-DB integrity contract); `docs/plan-m1-e1.md`, `docs/proposal-orm-choice.md`, KNOWN-026

## Context

ADR-026 (Proposed, 2026-05-08) defers all of ClickHouse to v1.x and ships v1 on Postgres only. Its reasoning was operational: the planned single-host CX32 (8 GB RAM) deployment cannot comfortably accommodate Postgres + Redis + ClickHouse + 6 services + monitoring stack at v1 scale.

That trade-off conflated two different ClickHouse use cases that the SPEC describes side-by-side in §2.7:

1. **Raw event archive layer.** SPEC §3.2 commits to one archive table per source (`event_archive_compound_governor`, future `event_archive_aave_governor`, etc.), storing every observed governance event for SPEC §3.3 idempotency, SPEC §3.4 reorg observability, and SPEC §3.10 backfill resumability. By end of M3 this is 5 tables × every governance event from every chain Kvorum tracks — millions of rows, append-mostly, queried by `(chain_id, block_number)` ranges and by the `(chain_id, tx_hash, log_index, block_hash)` exact-key lookups.

2. **Analytical mirror layer.** SPEC §2.7 describes denormalized join tables (`vote_events_flat`, `delegation_flow_flat`) for SPEC §4.6.2 analytical endpoints — concentration, delegation flow, delegate alignment, cross-DAO actor analytics, proposal pass-rate.

These have very different shapes:

- The archive is **append-mostly with rare mutations** (`confirmation_status` transitions on promotion / orphaning). It is the data ClickHouse exists for: wide payloads, columnar compression (10–50× vs Postgres jsonb+TOAST), high-volume range scans, append-only ingestion.
- The analytical mirror is **a derived view, refreshed periodically**, queried via a small set of pre-defined endpoints. SPEC §2.7 itself acknowledges that "for v1 with three DAOs, ClickHouse is technically optional — the analytical queries run acceptably on Postgres."

ADR-026 is correct that the analytical mirror can run on Postgres at v1 scale. It is wrong to extend that conclusion to the archive layer, because:

- **The archive is the wrong shape for Postgres.** Storing millions of wide event payloads in a Postgres table (even with `jsonb` + partitioning) burns disk, RAM (TOAST overhead, autovacuum), and query budget that ClickHouse handles natively. By M3 the table is a known performance liability.
- **The Postgres-then-mirror migration is expensive.** Building a Postgres archive in M1 and then backfilling it into ClickHouse during M3 (per SPEC §10.4: "ClickHouse analytical mirror populated; daily ETL job from Postgres") is a one-shot data migration of millions of rows plus the dual-write window during cutover. Designing the archive into ClickHouse from M1 skips that entirely.
- **The mutation path is small and isolatable.** Postgres only needs to track `confirmation_status` and the orphaning FK to `reorg_event` — small, mutable, OLTP-shaped. Pulling that into a separate Postgres `archive_confirmation` table keeps the OLTP control plane in Postgres and the OLAP data plane in ClickHouse — the textbook split.

The cost of activating ClickHouse in M1 is real but bounded:

- The CX32 → CX42 host upgrade (€10 → €20/month) restores ~8 GB of headroom — the CX42 has 8 vCPU and 16 GB RAM, comfortable for Postgres + ClickHouse + the rest. Still under the v1 €60/month ceiling.
- Local dev gains a ClickHouse container in `docker-compose.yml` (matches SPEC §10.1's "Postgres 16, Redis 7, ClickHouse, Anvil" already-committed list).
- M1 timeline grows ~4–6h for ClickHouse scaffolding (client wiring, schema, dev-loop verification).

ADR-026's RAM concern was the right concern. Its conclusion ("defer all of ClickHouse") was over-broad. Splitting the two layers respects both the SPEC's architectural intent and the operational constraint.

## Decision

**v1 ships ClickHouse for the raw event archive layer, in M1. The analytical mirror layer remains deferred per ADR-026's activation triggers.**

### Archive layer (M1)

The archive ships in ClickHouse from the start. The schema is a `ReplacingMergeTree` engine keyed on the SPEC §3.3 idempotency tuple, with `received_at` as the version column for natural deduplication on retry:

```sql
CREATE TABLE event_archive_compound_governor (
  dao_source_id   UUID,
  chain_id        UInt32,
  block_number    UInt64,
  block_hash      FixedString(66),     -- '0x' + 64 hex
  tx_hash         FixedString(66),
  log_index       UInt32,
  event_type      LowCardinality(String),
  received_at     DateTime64(3),
  payload         String                -- JSON-serialized; ZSTD codec at column level
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(received_at)
ORDER BY (chain_id, block_number, tx_hash, log_index, block_hash);
```

**Mutation pattern:** the archive itself is **immutable** — `confirmation_status`, `confirmed_at`, `orphaned_at`, and `orphaned_by_reorg_event_id` move out of ClickHouse into a Postgres `archive_confirmation` tracker (see plan-m1-e1.md). F1 inserts to ClickHouse first, then to Postgres in the same logical operation; on retry, ClickHouse's `ReplacingMergeTree` absorbs the duplicate insert and Postgres's unique key absorbs its own. F2's promotion sweep updates **only Postgres**. This makes the archive truly append-only and gives ClickHouse its preferred mutation pattern (none).

**Cross-DB integrity** is application-managed: F1 writes to both DBs in a defined order, with a reconciliation job (deferred to M2) catching divergence. The acceptable failure modes are:

- CH succeeds, PG fails → DLQ handles the PG retry; CH's existing row matches on retry.
- PG succeeds, CH fails → derivation worker (G1) fails to fetch payload; F3 routes to DLQ; reconciliation later catches and re-inserts.
- PG-rollback case: not possible; CH inserts come first, so a PG failure leaves a "tracking-less" CH row that the reconciliation job sweeps.

### Analytical mirror layer (deferred — ADR-026's posture preserved)

ADR-026's deferral applies **only to the analytical mirror layer**. SPEC §4.6.2 endpoints (concentration, delegation flow, delegate alignment, cross-DAO actor analytics, proposal pass-rate) continue to run against Postgres for v1 with appropriate indexes and one or two materialized views (refresh cadence per ADR-026: concentration daily, delegation flow hourly).

**Activation triggers for the analytical mirror** (unchanged from ADR-026):

- Any committed analytical endpoint exceeds p99 5 s sustained for 10 minutes (SPEC §7.2's stated p99).
- A fourth DAO is added to v1.x scope.
- The Postgres-side denormalized view equivalent to `vote_events_flat` exceeds ~5 M rows.

When triggered, the analytical-mirror activation work consists of: defining `vote_events_flat` and `delegation_flow_flat` materialized views in ClickHouse, populating from Postgres via a daily ETL job, repointing the §4.6.2 endpoint handlers. The archive layer is already there from M1.

### Deployment

CX32 (€10/month) → CX42 (€20/month, 8 vCPU, 16 GB RAM) at v1 launch. ClickHouse container added to `docker-compose.yml` for both prod and local dev. Dev loop adds `clickhouse-server` to the runlist.

Total v1 cost ceiling: still well under €60/month (per ADR-026's framing).

### CLAUDE.md amendment

CLAUDE.md currently reads "ClickHouse is deferred (ADR-026). Do not add ClickHouse dependencies." That line is rewritten:

> ClickHouse ships in M1 for the raw event archive layer (ADR-038). The analytical mirror layer (`vote_events_flat`, `delegation_flow_flat`) remains deferred per ADR-026's activation triggers — do not implement materialized analytical views in v1.

## Alternatives considered

- **Keep ADR-026 as-is; everything ClickHouse deferred.** Rejected. Pays a real M3+ migration cost to defer 4–6h of M1 work that doesn't earn the deferral. The wrong-shape-for-Postgres problem only worsens with scale; deferring makes the eventual fix harder, not easier.
- **Move all of ClickHouse to M1 (archive _and_ analytical mirror).** Rejected. SPEC §2.7 itself says the analytical mirror is "technically optional" at v1 scale; ADR-026's reasoning that Postgres + materialized views suffice for v1's three DAOs is sound. Adding the materialized-view layer to M1 expands scope without earning it.
- **Use Postgres for archive but with a columnar extension (`citus`, `timescaledb`).** Considered. Adds tooling, partial fix at best (still not ClickHouse's compression / column-store native query plans), and introduces a Postgres extension dependency that Hetzner's stock Postgres image doesn't ship. Worse cost-benefit than running ClickHouse natively.
- **Run ClickHouse on CX32 anyway, accept tight RAM.** Rejected. ADR-026's original concern was correct: 8 GB is too tight under spike load (backfill, AI batch cycles). The CX32 → CX42 upgrade is the right call.
- **Use a managed ClickHouse service (Aiven, ClickHouse Cloud).** Rejected at v1 scale. Adds €20–40/month minimum and a vendor dependency for data the project explicitly wants to keep self-hosted (per SPEC §1's "read-only blockchain analytics platform" identity — ironic to outsource the analytical store).

## Consequences

- **ADR-026 is superseded.** Its analytical-mirror deferral and activation triggers are preserved verbatim in this ADR; its archive-layer deferral is reversed.
- **Plan-m1-e1.md is substantially revised** (see `docs/plan-m1-e1.md` v3 changelog):
  - `EventArchiveCompoundGovernor` is removed from the Postgres schema; replaced by a ClickHouse table.
  - A new Postgres `ArchiveConfirmation` table tracks the OLTP control plane (status transitions, FKs to `ReorgEvent`).
  - The hand-edited Postgres partial-unique index is removed (ClickHouse `ReplacingMergeTree` handles dedup natively).
  - PR split adjusted: ClickHouse scaffolding lands as part of the Compound source package (PR 2).
- **ORM choice flips** (see `docs/proposal-orm-choice.md` v2): the dual-DB commitment from M1 makes Kysely's "shared call-site idiom across Postgres + ClickHouse" load-bearing rather than nice-to-have. The recommendation flips from Drizzle to Kysely + a Postgres migration tool + the community `kysely-clickhouse` dialect.
- **Source-package boundary** (see `docs/proposal-source-package-boundary.md`) — Option B (per-package schema files) becomes the default, since both Postgres tables and ClickHouse tables for a source live in the same `libs/sources/<name>/` package.
- **F1 (Compound archive writer) gets dual-DB scope.** Its task description gains a CH insert path; Postgres insert is the small `archive_confirmation` row.
- **F2 (reorg detection / promotion sweep) is simpler in ClickHouse terms** because CH has no role in the mutation path — F2 is pure Postgres.
- **G1 (derivation worker)** reads from Postgres (for canonical-confirmed entries) and joins to ClickHouse (for raw payloads) at processing time. This is the boundary that justifies Kysely: same call-site idiom for the two reads.
- **F3 (DLQ) stays in Postgres.** DLQ is small, mutable, queried by admin CLI — OLTP-shaped.
- **M1 effort grows by ~4–6h** for ClickHouse scaffolding (Docker Compose entry, client wiring, schema migration tool wiring, dev-loop verification, smoke test). Plan-m1-e1.md re-estimates total at ~17–18h post-revision.
- **CI complexity grows.** GitHub Actions jobs need a ClickHouse service container alongside Postgres (already planned per SPEC §10.1 "ephemeral Postgres + Redis + ClickHouse instances"). The service containers are well-supported in GitHub Actions.
- **Operational surface grows.** Backups must now cover ClickHouse. SPEC §7.5 mandates daily Postgres backups via `pg_dump --format=custom` + `wal-g`; it does not enumerate ClickHouse because the v1.0 baseline assumed CH was deferred. This ADR commits to a parallel daily ClickHouse backup using native `BACKUP TABLE event_archive_<source> TO Disk('backups', 'YYYYMMDD.zip')` (CH 22.x+). Retention matches SPEC §7.5's Postgres retention (30 days). Monitoring (SPEC §7.7.3) gains ClickHouse query throughput and disk usage metrics from M1.
- **KNOWN-026 is rewritten** to reflect the split: archive layer is no longer deferred; analytical mirror layer remains deferred per the original triggers.

## Implementation notes

- **Engine choice rationale.** `ReplacingMergeTree(received_at)` deduplicates rows with the same `ORDER BY` tuple, keeping the row with the largest `received_at`. F1's idempotent insert path benefits naturally — a retry inserts a new row, the merge process deduplicates, queries see one row. `CollapsingMergeTree` was considered but adds the burden of paired `+1`/`-1` sign rows; rejected as unnecessary given the archive is logically immutable.
- **Reorg semantics in ClickHouse.** The same logical event observed under two different `block_hash` values (canonical + orphaned) produces two distinct rows in ClickHouse, identical to the Postgres-only design — `block_hash` is part of the `ORDER BY` tuple. The Postgres-side `archive_confirmation` table tracks which is canonical.
- **Payload codec.** Apply `CODEC(ZSTD(3))` to the `payload` column in the M1 schema migration. Default LZ4 is faster but compresses ~2× less for JSON payloads.
- **Local dev:** `docker-compose.yml` adds a `clickhouse-server:24` container with default settings sufficient for dev volume. Schema migrations apply via the chosen migration tool (see ORM choice ADR forthcoming).
- **CI:** GitHub Actions adds a `clickhouse/clickhouse-server:24-alpine` service container alongside Postgres. Integration tests reset both DBs per test run.
- **Cost envelope:** CX32 (€10) → CX42 (€20). Total v1 deployment cost ≤ €60/month is still met with margin.

## Amendments

### 2026-05-10 — Polymorphic `archive_confirmation` table (sub-decision)

The original ADR text (line 27) describes "a separate Postgres `archive_confirmation` table" without specifying whether the table is **per-source** (e.g., `archive_confirmation_compound_governor`, `archive_confirmation_aave_governor`) or **polymorphic** (one table for all sources, discriminated by `source_type`). plan-m1-e1.md v3 picked polymorphic implicitly; v4 makes the choice explicit and ratifies it here:

> The Postgres `archive_confirmation` table is **polymorphic across all source types**. A single table carries `source_type` as the leading column of its idempotency key, and a single set of indexes serves F1/F2/G1/F3 across all current and future sources.

Rationale:

- **Schema growth is bounded.** Adding a new source (Aave, Snapshot, Lido) ships a new ClickHouse archive table and a new entry in the `source_type` enum — no new Postgres table.
- **Query patterns are identical across sources.** Every read against `archive_confirmation` is keyed by `(dao_source_id, …)` or `(source_type, chain_id, tx_hash, log_index, block_hash)`. Splitting per-source would force every cross-source admin query (e.g., `dlq list --since`) to UNION-ALL a growing set of tables.
- **Mutation paths are identical.** F2's promotion sweep, F1's PG-first existence check, F3's DLQ join — all are source-agnostic.

Trade-off: a single hot table for all sources rather than N per-source tables. At v1 scale (3 DAOs, ~10 events/day post-backfill steady-state), the table is small (~10k rows/year). Revisit if a future high-volume source pushes the table past ~10M rows; partitioning by `source_type` is a one-step migration if needed.

The ClickHouse archive layer remains **per-source** (one table per `source_type` — `event_archive_compound_governor`, `event_archive_aave_governor_v3`, etc.), per the original ADR. The asymmetry is deliberate: CH benefits from per-source schema specialization (different `event_type` cardinalities, different payload sizes); PG benefits from polymorphic uniformity for the small mutable control plane.

### 2026-05-10 — Cross-DB integrity contract refined by ADR-041

The original ADR text (lines 64–68) sketches the failure modes but does not specify the F1 write protocol, the read-side dedup strategy, or the M2 reconciliation job. **ADR-041 supplies the full contract.** This ADR is unchanged in intent; ADR-041 makes it implementable.

### 2026-05-10 — `received_at` semantic clarification

`ReplacingMergeTree(received_at)` keeps the row with the largest `received_at` per `ORDER BY` tuple. Under SPEC §3.3 polling fallback, F1 may legitimately re-observe the same canonical event multiple times, and each observation advances `received_at`. The kept value is therefore **most-recent observation timestamp**, not first-observation. This is documented in ADR-041's read-side semantics and in the M1 runbook. If forensic "first observation" is ever needed, a separate `first_observed_at` column ships in a follow-up migration; M1 does not need it.
