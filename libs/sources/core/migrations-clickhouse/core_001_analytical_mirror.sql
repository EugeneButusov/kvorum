-- ============================================================================
-- core_001_analytical_mirror.sql — M2 analytical mirror (cross-source)
-- ============================================================================
-- Activates the analytical mirror layer per ADR-038's "M2 amendment"
-- (milestone decision overrides the ADR-038 activation triggers).
--
-- Two tables, both empty at end of this migration. Epic Q's daily ETL
-- (apps/indexer/src/mirror-etl/) populates them from PG `vote` + `delegation`
-- on a 04:00-UTC cron with a 6h overlap watermark on `created_at`.
--
-- These tables are CROSS-SOURCE aggregates, not per-source. They live under
-- libs/sources/core/migrations-clickhouse/ so the migrate-ch runner's
-- libs/sources/*/migrations-clickhouse/ glob picks them up
-- (libs/db/scripts/migrate-ch.mts:25). The runner sorts files by original
-- basename FIRST (migrate-ch.mts:39, `localeCompare`), then performs the
-- `^([a-z_]+)_(\d+)_(.+)$ → $2_$1_$3` basename-prefix swap on each file
-- during copy-into-staging (migrate-ch.mts:57). Either way, `compound_*`
-- runs before `core_*` ('compound' < 'core' alphabetically). Source
-- ordering is irrelevant here — these two CREATE TABLEs are standalone
-- (no dependency on any per-source archive table); the ordering note is
-- informational.
--
-- Reading these tables (consumer-side note):
--   `voting_power UInt256` round-trips through @founderpath/kysely-clickhouse
--   as a JS string (JS BigInt is not the dialect's native row-decoder type).
--   Query sites in apps/api/src/analytics/* must parse to BigInt for Gini /
--   top-N / sum aggregations and re-stringify per SPEC §4.7 before JSON
--   serialisation. ADR-053 (drafted in L PR1) also notes this for the
--   voting-power snapshot consumer side.
--
--   *** Precision footgun: do NOT cast `voting_power` to Float64. ***
--   Native CH `sum(voting_power)` is exact across UInt256. Casting to
--   Float64 (e.g., for the textbook Gini formula) silently truncates
--   above 2^53. Compute Gini in TypeScript with BigInt after pulling
--   per-bucket sums, or use `Decimal256(0)` arithmetic in CH.
--
-- Sentinel conventions (per plan-m2.md §"J3 schema notes"):
--   * `primary_choice = -1` ↔ PG `vote.primary_choice IS NULL`. To prevent
--     `SUM(primary_choice) = … - N` style footguns in analytical SQL, an
--     `ALIAS` column `primary_choice_nullable` maps the sentinel back to
--     `NULL` automatically — analytics queries should select against the
--     ALIAS, ETL writes against the physical column. The sentinel halves
--     I/O vs `Nullable(Int8)` (no null-bitmap byte per row) — modest in
--     absolute terms at v1 scale (~300k votes ≈ ~300 KB), real win at M3+.
--     Compound votes always populate `primary_choice`, so the sentinel is
--     dormant in M2; it lights up under ADR-023 NULL semantics in M4.
--   * `delegate_actor_id = '00000000-0000-0000-0000-000000000000'` ↔ PG
--     `delegation.delegate_actor_id IS NULL` (delegated-to-no-one). Used
--     only in equality / IN comparisons, not in aggregations, so no ALIAS
--     mirror is needed.
--   Epic Q's ETL writes sentinels; Epic O3's API reads convert back to NULL.
--
-- No TTL on either table — both are derived (rebuildable from PG `vote` /
-- `delegation` via Q's ETL on demand). Future TTL must NOT key on:
--   * `vote_events_analytics.cast_at` — collapses ADR-021 supersession state
--     (an old superseded vote and its replacement share `cast_at` range
--     but differ on `vote_id`; TTL'ing on cast_at could drop active rows).
--   * `delegation_flow_analytics.created_at` — collapses event-arrival
--     order under reorg + re-derive (a re-derived delegation row gets
--     a fresh `created_at`; TTL would drop pre-reorg history).
-- Any future TTL must key on `block_number` (monotonic in either table) or
-- be applied via a separate first-observation column.
--
-- TTL + ReplacingMergeTree merge-timing footgun: TTL eviction runs at
-- merge time, not on a wall-clock cron. A TTL'd row may briefly survive
-- `SELECT ... FINAL` queries until the next background merge. If TTL is
-- ever required for GDPR-style deletes, pair it with explicit
-- `OPTIMIZE TABLE … FINAL` operator runbook entry (see CLAUDE.md
-- "Database access convention" — application code must not call OPTIMIZE).
-- ============================================================================

-- ── vote_events_analytics ───────────────────────────────────────────────────
-- Denormalised vote rows for analytical queries (concentration, alignment,
-- cross-DAO actor). One physical row per PG `vote.id`. ReplacingMergeTree
-- deduplicates on the ORDER BY tuple; the trailing `vote_id` makes the
-- dedup-key per logical PG row, which is forward-correct under ADR-021
-- supersession (the superseded row and its replacement have distinct
-- vote_ids; both rows persist in CH, the API filters via the `superseded`
-- column at query time).
CREATE TABLE IF NOT EXISTS vote_events_analytics
(
    vote_id                  UUID,
    proposal_id              UUID,
    voter_actor_id           UUID,
    voter_address            FixedString(42),
    dao_id                   UUID,
    dao_slug                 LowCardinality(String),
    source_type              LowCardinality(String),
    primary_choice           Int8,
    primary_choice_nullable  Int8 ALIAS if(primary_choice = -1, NULL, primary_choice),
    voting_power             UInt256 CODEC(ZSTD(1)),
    cast_at                  DateTime64(3) CODEC(DoubleDelta, ZSTD(1)),
    created_at               DateTime64(3) CODEC(DoubleDelta, ZSTD(1)),
    block_number             UInt64 CODEC(DoubleDelta, ZSTD(1)),
    superseded               UInt8,
    INDEX bf_voter_address voter_address TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(cast_at)
PARTITION BY toYear(cast_at)
ORDER BY (dao_id, proposal_id, voter_actor_id, vote_id);

-- ── delegation_flow_analytics ───────────────────────────────────────────────
-- Directed edges of the delegation graph (delegator → delegate at a block).
-- One physical row per PG `delegation.id`. ReplacingMergeTree's `created_at`
-- version column is monotonic (PG-insertion time); re-running Q's ETL for
-- the same logical row produces a duplicate physical row that the next
-- background merge collapses.
CREATE TABLE IF NOT EXISTS delegation_flow_analytics
(
    delegation_id        UUID,
    delegator_actor_id   UUID,
    delegate_actor_id    UUID,
    dao_id               UUID,
    dao_slug             LowCardinality(String),
    voting_power         UInt256 CODEC(ZSTD(1)),
    block_number         UInt64 CODEC(DoubleDelta, ZSTD(1)),
    event_type           LowCardinality(String),
    created_at           DateTime64(3) CODEC(DoubleDelta, ZSTD(1)),
    INDEX bf_delegate_actor delegate_actor_id TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(created_at)
PARTITION BY toYear(created_at)
ORDER BY (dao_id, delegator_actor_id, block_number, delegation_id);
