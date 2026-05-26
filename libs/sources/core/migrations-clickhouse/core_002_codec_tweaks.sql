ALTER TABLE vote_events_analytics
    MODIFY COLUMN voting_power UInt256 CODEC(ZSTD(1));

ALTER TABLE delegation_flow_analytics
    MODIFY COLUMN voting_power UInt256 CODEC(ZSTD(1));

ALTER TABLE vote_events_analytics
    MODIFY COLUMN block_number UInt64 CODEC(DoubleDelta, ZSTD(1));

ALTER TABLE delegation_flow_analytics
    MODIFY COLUMN block_number UInt64 CODEC(DoubleDelta, ZSTD(1));
