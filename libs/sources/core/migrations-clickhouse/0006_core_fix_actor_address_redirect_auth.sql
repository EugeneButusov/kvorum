-- Recreate actor_address_redirect dictionary with correct PG credentials.
-- The original DDL in 0001_core_ch_source_of_truth.sql used 'postgres'/'postgres'
-- which does not match the actual PG user (kvorum/kvorum). CH returns
-- "password authentication failed for user postgres" on every dict refresh.
CREATE OR REPLACE DICTIONARY actor_address_redirect
(
    address String,
    current_actor_id UUID
)
PRIMARY KEY address
SOURCE(
    POSTGRESQL(
        HOST 'postgres'
        PORT 5432
        USER 'kvorum'
        PASSWORD 'kvorum'
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
