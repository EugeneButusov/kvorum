# 0061 - Analytical CH read patterns

- Status: Accepted
- Date: 2026-05-25
- Amends: 0062

## Context

O3 introduces API read endpoints backed by ClickHouse projections (source of truth for chain-event-derived data per ADR-0062). ~~ClickHouse analytical mirror tables~~ _Superseded by ADR-0062 — CH is primary storage, not a mirror._

## Decision

1. Use `SELECT ... FINAL` for reads from `ReplacingMergeTree` analytical tables.
2. Reconstitute sentinels to nullable wire values at mapper boundaries.
3. Treat CH UInt256 values as strings at the DB boundary and parse to `BigInt` for arithmetic.
4. Avoid Float64 casts in ClickHouse SQL for governance voting power calculations.
5. Use bucket helpers for day/week/month aggregation in SQL.
6. Return analytics responses with `{ confirmed, mirror_ready, mirror_last_etl }` metadata.

## Consequences

Read logic stays deterministic and precision-safe. ~~Clients can distinguish empty mirror warmup from ready data.~~ _Superseded by ADR-0062 — no warmup phase post-cutover._

## Amendment — 2026-05-28 (`_meta` shape change; TTL/Cache-Control defaults)

**Rule 6 superseded.** Old: `{ confirmed, mirror_ready, mirror_last_etl }`. New: `{ confirmed, derived_through }` where `derived_through` is ISO-8601 from `max(version)` over the source-of-truth rows that fed the response. Both old fields are **removed**, not deprecated; OpenAPI 4xxs on hardcoded references to them. Internal-only consumer (dashboard) coordinated in the same release.

**New rule 7 — TTL/Cache-Control defaults per endpoint class:**

- Entity endpoints (O1, O2 single-row): `Cache-Control: private, max-age=0, must-revalidate` + ETag. Conditional-only.
- List endpoints (O1, O2 paginated): `Cache-Control: max-age=15, stale-while-revalidate=300` + ETag.
- Aggregation endpoints (O3): `Cache-Control: max-age=60, stale-while-revalidate=3600` + ETag. The ~90 s Dictionary refresh window (ADR-0062 §Operational invariants) is the freshness floor.

Rules 1–5 unchanged: `SELECT … FINAL`; sentinel reconstitution at mapper boundaries; UInt256-as-string at DB boundary; no Float64 casts in CH SQL; bucket helpers for date aggregation.

Cite ADR-0062 + PR #220.

## Amendment — 2026-06-17 (concentration 204 for zero-power windows)

**New rule 8 — Return `204 No Content` when the entire requested window has no power-bearing delegation.**

The concentration endpoint (`GET /v1/daos/:slug/analytics/concentration`) queries `delegation_flow_projection` and computes Gini / top-N share over `voting_power` values. For relationship-only-delegation sources (e.g. Aave governance, ADR-0070), all delegation rows carry `voting_power='0'`. Returning a 200 with all-zero Gini and `top_share.n_1=0` is misleading — it reads as "perfect equality" rather than "no power data."

**Gate:** window-level, data-driven. Return 204 if and only if `window total_voting_power === 0` for the full requested date range — not per bucket. A window containing any power-bearing row returns 200 with **all** buckets unchanged (including zero-power buckets from `delegate_changed` events). Never gate by DAO slug or source type — the condition must be generic.

**Implementation:** `@Res({ passthrough: true })` + `res.status(204)` + `return undefined`. The `EtagInterceptor` skips the ETag header on null/undefined body and still emits `Cache-Control` per rule 7.

**Scope:** The rule applies to the concentration endpoint only. Other analytics endpoints always return 200 with an empty `data: []` array for empty windows.
