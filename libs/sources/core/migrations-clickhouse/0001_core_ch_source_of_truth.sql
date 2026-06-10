-- ============================================================
-- vote_events
-- ============================================================

CREATE TABLE IF NOT EXISTS vote_events_raw
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
    voting_chain_id LowCardinality(String) DEFAULT '0x1',
    version DateTime64(6) DEFAULT now64(6),
    INDEX bf_voter_address voter_address TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(cast_at)
ORDER BY (dao_id, proposal_id, voter_address, block_number, log_index, vote_id);

CREATE TABLE IF NOT EXISTS vote_events_agg
(
    vote_id UUID,
    dao_id UUID,
    proposal_id UUID,
    voter_address FixedString(42),
    block_number UInt64,
    log_index UInt32,
    cast_at DateTime64(3),
    voting_chain_id LowCardinality(String),
    primary_choice_state AggregateFunction(argMax, Int8, DateTime64(6)),
    voting_power_state AggregateFunction(argMax, UInt256, DateTime64(6)),
    superseded_state AggregateFunction(argMax, UInt8, DateTime64(6)),
    superseded_at_state AggregateFunction(argMax, Nullable(DateTime64(3)), DateTime64(6)),
    superseded_by_vote_id_state AggregateFunction(argMax, Nullable(UUID), DateTime64(6))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(cast_at)
ORDER BY (dao_id, proposal_id, voter_address, block_number, log_index, vote_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS vote_events_mv TO vote_events_agg AS
SELECT
    vote_id,
    dao_id,
    proposal_id,
    voter_address,
    block_number,
    log_index,
    cast_at,
    voting_chain_id,
    argMaxState(primary_choice, version)         AS primary_choice_state,
    argMaxState(voting_power, version)           AS voting_power_state,
    argMaxState(superseded, version)             AS superseded_state,
    argMaxState(superseded_at, version)          AS superseded_at_state,
    argMaxState(superseded_by_vote_id, version)  AS superseded_by_vote_id_state
FROM vote_events_raw
GROUP BY vote_id, dao_id, proposal_id, voter_address, block_number, log_index, cast_at, voting_chain_id;

CREATE VIEW IF NOT EXISTS vote_events_projection AS
SELECT
    vote_id,
    dao_id,
    proposal_id,
    voter_address,
    block_number,
    log_index,
    cast_at,
    voting_chain_id,
    argMaxMerge(primary_choice_state)           AS primary_choice,
    argMaxMerge(voting_power_state)             AS voting_power,
    argMaxMerge(superseded_state)               AS superseded,
    argMaxMerge(superseded_at_state)            AS superseded_at,
    argMaxMerge(superseded_by_vote_id_state)    AS superseded_by_vote_id
FROM vote_events_agg
GROUP BY vote_id, dao_id, proposal_id, voter_address, block_number, log_index, cast_at, voting_chain_id;

-- ============================================================
-- delegation_flow
-- ============================================================

CREATE TABLE IF NOT EXISTS delegation_flow_raw
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
ENGINE = MergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (dao_id, delegator_address, block_number, log_index, delegation_id);

CREATE TABLE IF NOT EXISTS delegation_flow_agg
(
    delegation_id UUID,
    dao_id UUID,
    delegator_address FixedString(42),
    block_number UInt64,
    log_index UInt32,
    created_at DateTime64(3),
    delegate_address_state AggregateFunction(argMax, LowCardinality(FixedString(42)), DateTime64(6)),
    voting_power_state AggregateFunction(argMax, UInt256, DateTime64(6)),
    event_type_state AggregateFunction(argMax, LowCardinality(String), DateTime64(6))
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (dao_id, delegator_address, block_number, log_index, delegation_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS delegation_flow_mv TO delegation_flow_agg AS
SELECT
    delegation_id,
    dao_id,
    delegator_address,
    block_number,
    log_index,
    created_at,
    argMaxState(delegate_address, version)  AS delegate_address_state,
    argMaxState(voting_power, version)      AS voting_power_state,
    argMaxState(event_type, version)        AS event_type_state
FROM delegation_flow_raw
GROUP BY delegation_id, dao_id, delegator_address, block_number, log_index, created_at;

CREATE VIEW IF NOT EXISTS delegation_flow_projection AS
SELECT
    delegation_id,
    dao_id,
    delegator_address,
    block_number,
    log_index,
    created_at,
    argMaxMerge(delegate_address_state) AS delegate_address,
    argMaxMerge(voting_power_state)     AS voting_power,
    argMaxMerge(event_type_state)       AS event_type
FROM delegation_flow_agg
GROUP BY delegation_id, dao_id, delegator_address, block_number, log_index, created_at;

-- ============================================================
-- voting_power_snapshot
-- ============================================================

CREATE TABLE IF NOT EXISTS voting_power_snapshot_raw
(
    dao_id UUID,
    proposal_id UUID,
    actor_address FixedString(42),
    voter_address FixedString(42) DEFAULT actor_address,
    voting_power UInt256 CODEC(ZSTD(1)),
    actor_id_hint Nullable(UUID),
    computed_at DateTime64(3),
    version DateTime64(6) DEFAULT now64(6)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(computed_at)
ORDER BY (dao_id, proposal_id, actor_address);

CREATE TABLE IF NOT EXISTS voting_power_snapshot_agg
(
    dao_id UUID,
    proposal_id UUID,
    actor_address FixedString(42),
    voter_address_state AggregateFunction(argMax, FixedString(42), DateTime64(6)),
    voting_power_state AggregateFunction(argMax, UInt256, DateTime64(6)),
    actor_id_hint_state AggregateFunction(argMax, Nullable(UUID), DateTime64(6)),
    computed_at_state AggregateFunction(argMax, DateTime64(3), DateTime64(6))
)
ENGINE = AggregatingMergeTree()
ORDER BY (dao_id, proposal_id, actor_address);

CREATE MATERIALIZED VIEW IF NOT EXISTS voting_power_snapshot_mv TO voting_power_snapshot_agg AS
SELECT
    dao_id,
    proposal_id,
    actor_address,
    argMaxState(voter_address, version)  AS voter_address_state,
    argMaxState(voting_power, version)   AS voting_power_state,
    argMaxState(actor_id_hint, version)  AS actor_id_hint_state,
    argMaxState(computed_at, version)    AS computed_at_state
FROM voting_power_snapshot_raw
GROUP BY dao_id, proposal_id, actor_address;

CREATE VIEW IF NOT EXISTS voting_power_snapshot_projection AS
SELECT
    dao_id,
    proposal_id,
    actor_address,
    argMaxMerge(voter_address_state)   AS voter_address,
    argMaxMerge(voting_power_state)    AS voting_power,
    argMaxMerge(actor_id_hint_state)   AS actor_id_hint,
    argMaxMerge(computed_at_state)     AS computed_at
FROM voting_power_snapshot_agg
GROUP BY dao_id, proposal_id, actor_address;

-- ============================================================
-- actor_address_redirect dictionary
-- ============================================================

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
