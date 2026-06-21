-- Discourse forum off-chain archive table.
--
-- Same off-chain shape as archive_event_snapshot (forum threads are editable, mutable-latest):
--   - No block coords, no chain_id partition, no bloom index (off-chain).
--   - ReplacingMergeTree(version) NOT received_at: received_at is second-precision and would drop
--     same-second edits. version is the PG-monotonic integer from archive_event.version, bumped
--     only on content change (ADR-071 §Z3 binding constraint).
--   - ORDER BY (dao_source_id, external_id): dao_source_id is 1:1 with (source_type, chain_id) so
--     it fully partitions by source+chain; external_id is the Discourse topic id.
--   - SELECT ... FINAL returns the row with the greatest version per (dao_source_id, external_id).
--
-- No writer until AE2; created alongside the discourse_forum source_type so the
-- "archive table per archiving source_type" invariant holds before the forum plugin lands.

CREATE TABLE IF NOT EXISTS archive_event_discourse_forum
(
    dao_source_id  UUID CODEC(ZSTD(1)),
    external_id    String CODEC(ZSTD(1)),
    version        Int32 CODEC(ZSTD(1)),
    content_hash   String CODEC(ZSTD(1)),
    payload        String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (dao_source_id, external_id);
