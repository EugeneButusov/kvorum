-- Aave governance archive tables.
--
-- These are raw event archives for the four Aave governance contract kinds. Reconcile
-- source_type rows do not get separate archive tables; reconcilers read chain state.
--
-- block_hash is NOT in ORDER BY. The ingester reads at confirmedHead = tip − headLag
-- (ADR-058), so ingested blocks are finalized and reorg-free. The dedup key is the
-- natural 4-tuple (chain_id, block_number, tx_hash, log_index).
--
-- received_at is server-stamped (DEFAULT now()); writers MUST NOT supply it.
-- ReplacingMergeTree(received_at) keeps the row with the greatest received_at;
-- DateTime is SECOND PRECISION, so same-second re-observations dedup
-- non-deterministically. Confirmed-head ingestion makes that exposure negligible.
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
ORDER BY (chain_id, block_number, tx_hash, log_index);

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
ORDER BY (chain_id, block_number, tx_hash, log_index);

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
ORDER BY (chain_id, block_number, tx_hash, log_index);

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
ORDER BY (chain_id, block_number, tx_hash, log_index);
