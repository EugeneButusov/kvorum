CREATE TABLE IF NOT EXISTS vote_events_projection
(
    vote_id UUID,
    dao_id UUID,
    proposal_id UUID,
    voter_address FixedString(42),
    primary_choice Int8,
    voting_power UInt256 CODEC(ZSTD(1)),
    cast_at DateTime64(3),
    block_number UInt64,
    log_index UInt32,
    superseded UInt8 DEFAULT 0,
    superseded_at Nullable(DateTime64(3)),
    superseded_by_vote_id Nullable(UUID),
    version DateTime64(6) DEFAULT now64(6),
    INDEX bf_voter_address voter_address TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(cast_at)
ORDER BY (dao_id, proposal_id, voter_address, block_number, log_index, vote_id);

CREATE TABLE IF NOT EXISTS delegation_flow_projection
(
    delegation_id UUID,
    dao_id UUID,
    delegator_address FixedString(42),
    delegate_address LowCardinality(FixedString(42)),
    voting_power UInt256 CODEC(ZSTD(1)),
    block_number UInt64,
    log_index UInt32,
    event_type LowCardinality(String),
    created_at DateTime64(3),
    version DateTime64(6) DEFAULT now64(6),
    INDEX bf_delegate_address delegate_address TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (dao_id, delegator_address, block_number, log_index, delegation_id);

CREATE TABLE IF NOT EXISTS voting_power_snapshot_projection
(
    dao_id UUID,
    proposal_id UUID,
    actor_address FixedString(42),
    voting_power UInt256 CODEC(ZSTD(1)),
    actor_id_hint Nullable(UUID),
    computed_at DateTime64(3),
    version DateTime64(6) DEFAULT now64(6)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(computed_at)
ORDER BY (dao_id, proposal_id, actor_address);

CREATE DICTIONARY IF NOT EXISTS actor_address_redirect
(
    address String,
    current_actor_id UUID
)
PRIMARY KEY address
SOURCE(
    POSTGRESQL(
        HOST 'postgres'
        PORT 5432
        USER 'postgres'
        PASSWORD 'postgres'
        DB 'kvorum'
        QUERY '
            SELECT
              aa.address,
              aa.actor_id AS current_actor_id
            FROM actor_address aa
            UNION ALL
            SELECT
              r.from_address AS address,
              r.to_actor_id AS current_actor_id
            FROM actor_address_redirect r
            WHERE NOT EXISTS (
              SELECT 1 FROM actor_address aa WHERE aa.address = r.from_address
            )
        '
    )
)
LIFETIME(MIN 30 MAX 90)
LAYOUT(HASHED());
