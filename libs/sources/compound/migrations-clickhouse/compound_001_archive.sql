-- block_hash is part of ORDER BY: a reorg of the same (chain_id, tx_hash, log_index)
-- emits a second row, not a dedup. G1 supplies the canonical block_hash from
-- archive_confirmation in its IN-tuple filter (ADR-041 §Reorg semantics).

-- received_at is server-stamped (DEFAULT now()); writers MUST NOT supply it.
-- ReplacingMergeTree(received_at) keeps the row with the greatest received_at;
-- DateTime is SECOND PRECISION — same-second re-observations dedup non-deterministically.
-- Compound's volume (~100-200 events/yr) makes the collision negligible; revisit for
-- high-volume sources. Multi-replica `now()` evaluates per-replica: this reduces but
-- does not eliminate clock-skew exposure (insert-block dedup is the real fix when
-- ReplicatedMergeTree lands). (ADR-041 rider 2026-05-11 §3.)

-- PARTITION BY chain_id is a per-source decision tuned for Compound's volume.
-- Future high-volume sources (Aave/Lido) should evaluate (chain_id, toYYYYMM(...))
-- or block-bucketing — do NOT cargo-cult chain_id when the row count justifies finer
-- granularity.

-- TTL is intentionally omitted: this archive is the data plane and G1 reads it
-- indefinitely (SPEC §7.5 retention applies to PG backups, not CH). Future TTL
-- additions must key on block_number or toDate(...) of a first-observation column,
-- NOT received_at (latest-observation semantics would extend lifetime of
-- frequently-reobserved canonical events).

-- UUID CODEC(ZSTD(1)) on dao_source_id is a no-op (UUIDs are incompressible random
-- bytes); kept for per-column codec-spec consistency.

CREATE TABLE IF NOT EXISTS event_archive_compound_governor
(
    dao_source_id   UUID CODEC(ZSTD(1)),
    chain_id        LowCardinality(String) CODEC(ZSTD(1)),
    block_number    UInt64 CODEC(Delta(8), ZSTD(1)),
    block_hash      FixedString(66) CODEC(ZSTD(1)),
    tx_hash         FixedString(66) CODEC(ZSTD(1)),
    log_index       UInt32 CODEC(ZSTD(1)),
    event_type      LowCardinality(String),
    received_at     DateTime DEFAULT now() CODEC(DoubleDelta, ZSTD(1)),
    payload         String CODEC(ZSTD(3)),
    INDEX bf_tx_hash tx_hash TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY chain_id
ORDER BY (chain_id, block_number, tx_hash, log_index, block_hash);
