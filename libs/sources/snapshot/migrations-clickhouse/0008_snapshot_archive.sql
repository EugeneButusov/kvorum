-- Snapshot off-chain archive table.
--
-- Off-chain shape differs from EVM archive tables:
--   - No block coords, no chain_id partition, no bloom index (off-chain).
--   - ReplacingMergeTree(version) NOT received_at: received_at is second-precision and
--     would drop same-second edits. version is the PG-monotonic integer from
--     archive_event.version, bumped only on content change (ADR-071 §Z3 binding constraint).
--   - ORDER BY (dao_source_id, external_id): dao_source_id is 1:1 with
--     (source_type, chain_id) so it fully partitions by source+chain.
--   - SELECT ... FINAL returns the row with the greatest version per (dao_source_id, external_id).
--   - event_type and ordinal are NOT stored here; they ride the PG OffchainArchiveRow and
--     are keyed by the off-chain deriver on (dao_source_id, external_id).

CREATE TABLE IF NOT EXISTS archive_event_snapshot
(
    dao_source_id  UUID CODEC(ZSTD(1)),
    external_id    String CODEC(ZSTD(1)),
    version        Int32 CODEC(ZSTD(1)),
    content_hash   String CODEC(ZSTD(1)),
    payload        String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (dao_source_id, external_id);
