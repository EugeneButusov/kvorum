-- Snapshot per-vote choice breakdown (ADR-072 D2/D3). A point-lookup payload keyed by vote_id —
-- never filtered or aggregated, so it lives outside the core vote_events pipeline (which keeps
-- primary_choice/voting_power/supersession). `choices` is JSON [{choice_index:int, weight:"decimal"}]
-- sorted desc by weight; `vp` is the exact decimal reported power (the core voting_power is rounded);
-- `vp_by_strategy` is the raw per-strategy JSON. ReplacingMergeTree(version) so a re-derive replaces.

CREATE TABLE IF NOT EXISTS snapshot_vote_choice
(
    vote_id        UUID CODEC(ZSTD(1)),
    choices        String CODEC(ZSTD(1)),
    vp             String CODEC(ZSTD(1)),
    vp_by_strategy String CODEC(ZSTD(1)),
    version        DateTime64(6) DEFAULT now64(6) CODEC(ZSTD(1))
)
ENGINE = ReplacingMergeTree(version)
ORDER BY vote_id;
