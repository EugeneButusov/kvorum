-- Archive table for the Gnosis Delegate Registry on-chain Snapshot delegation source
-- (mainnet only). Mirrors 0005_aave_token_archive.sql in structure; block_hash is not in ORDER BY
-- (ingester reads at confirmedHead = tip − headLag per ADR-058; reorgs cannot affect ingested
-- blocks). The 4-tuple idempotency key (source_type, chain_id, tx_hash, log_index) lives in PG
-- archive_event per ADR-041. SetDelegate/ClearDelegate are topic-scoped to the seeded space ids +
-- the global id, so volume is bounded. received_at is server-stamped (DEFAULT now()); writers MUST
-- NOT supply it. ReplacingMergeTree(received_at) keeps the row with the greatest received_at.

CREATE TABLE IF NOT EXISTS archive_event_snapshot_delegate_registry
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
