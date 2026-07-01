-- Archive table for the Gnosis Guild Split Delegation on-chain Snapshot delegation source
-- (mainnet only). Same structure as 0011_snapshot_delegate_registry_archive.sql. Split Delegation
-- `context` (the space) is un-indexed, so the ingester subscribes by event signature and drops
-- out-of-scope contexts before archiving; only the seeded spaces land here. payload carries the
-- multi-delegate array + ratios + expiration. received_at is server-stamped (DEFAULT now());
-- writers MUST NOT supply it. ReplacingMergeTree(received_at) keeps the latest row per key.

CREATE TABLE IF NOT EXISTS archive_event_snapshot_split_delegation
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
