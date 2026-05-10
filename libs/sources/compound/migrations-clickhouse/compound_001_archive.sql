CREATE TABLE IF NOT EXISTS event_archive_compound_governor
(
    dao_source_id   UUID,
    chain_id        UInt32,
    block_number    UInt64,
    block_hash      FixedString(66),
    tx_hash         FixedString(66),
    log_index       UInt32,
    event_type      LowCardinality(String),
    received_at     DateTime64(3),
    payload         String CODEC(ZSTD(3)),
    INDEX bf_tx_hash tx_hash TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY (chain_id, intDiv(block_number, 1000000))
ORDER BY (dao_source_id, chain_id, block_number, tx_hash, log_index, block_hash);
