-- Aave governance archive tables.
--
-- These are raw event archives for the four Aave governance contract kinds. Reconcile
-- source_type rows do not get separate archive tables; reconcilers read chain state.
--
-- block_hash is part of ORDER BY: a reorg of the same (chain_id, tx_hash, log_index)
-- emits a second row, not a dedup. Consumers pin PG-canonical block_hash values through
-- their archive_event IN-tuple filter and fold physical duplicates downstream, so archive
-- reads are intentionally not SELECT ... FINAL.
--
-- received_at is server-stamped (DEFAULT now()); writers MUST NOT supply it.
-- ReplacingMergeTree(received_at) keeps the row with the greatest received_at;
-- DateTime is SECOND PRECISION, so same-second re-observations dedup
-- non-deterministically. Polygon voting-machine volume makes that exposure larger than
-- Compound, but canonical block_hash filtering prevents derivation corruption.
--
-- PARTITION BY chain_id is deliberate for this R3 footprint. Monthly sub-partitions would
-- create hundreds of tiny partitions for the light tables. Chain partitions are healthy for
-- the voting-machine table and small-but-fine for governance/payloads/governor_v2; the
-- strategy can be rebuilt later if observed volume changes.
--
-- TTL is intentionally omitted: this archive is the data plane. Future TTL additions must
-- key on block_number or toDate(...) of a first-observation column, NOT received_at.
--
-- UUID CODEC(ZSTD(1)) on dao_source_id is a no-op (UUIDs are incompressible random
-- bytes); kept for per-column codec-spec consistency.

CREATE TABLE IF NOT EXISTS archive_event_aave_governance_v3
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

CREATE TABLE IF NOT EXISTS archive_event_aave_voting_machine
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

CREATE TABLE IF NOT EXISTS archive_event_aave_payloads_controller
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

CREATE TABLE IF NOT EXISTS archive_event_aave_governor_v2
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
