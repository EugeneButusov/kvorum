ALTER TABLE voting_power_snapshot_raw
  ADD COLUMN IF NOT EXISTS voter_address FixedString(42) DEFAULT actor_address AFTER actor_address;

ALTER TABLE voting_power_snapshot_agg
  ADD COLUMN IF NOT EXISTS voter_address_state
    AggregateFunction(argMax, FixedString(42), DateTime64(6))
    AFTER actor_address;

ALTER TABLE voting_power_snapshot_mv MODIFY QUERY
SELECT
    dao_id,
    proposal_id,
    actor_address,
    argMaxState(voter_address, version)   AS voter_address_state,
    argMaxState(voting_power, version)    AS voting_power_state,
    argMaxState(actor_id_hint, version)   AS actor_id_hint_state,
    argMaxState(computed_at, version)     AS computed_at_state
FROM voting_power_snapshot_raw
GROUP BY dao_id, proposal_id, actor_address;

CREATE OR REPLACE VIEW voting_power_snapshot_projection AS
SELECT
    dao_id,
    proposal_id,
    actor_address,
    argMaxMerge(voter_address_state)    AS voter_address,
    argMaxMerge(voting_power_state)     AS voting_power,
    argMaxMerge(actor_id_hint_state)    AS actor_id_hint,
    argMaxMerge(computed_at_state)      AS computed_at
FROM voting_power_snapshot_agg
GROUP BY dao_id, proposal_id, actor_address;
