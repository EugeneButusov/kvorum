// DDL for the ClickHouse dictionaries whose source is a live Postgres connection.
//
// Why these are NOT migrations: the DDL embeds the PG host/credentials ClickHouse itself uses to
// reach Postgres, which is per-environment configuration, not versioned schema — and it is not the
// address the app uses (locally the app reaches PG on localhost while ClickHouse, inside the compose
// network, must use `postgres`; a managed ClickHouse in production reaches it somewhere else again).
// clickhouse-migrations also md5-checksums every applied file and hard-exits if the content ever
// changes, so env-templating a migration would make a routine password rotation break migrations
// permanently.
//
// Applied by an operator via `pnpm -w db:ch:dictionaries` when an environment is first provisioned
// or its CH→PG route changes — see docs/runbooks/ch-dictionaries.md. CREATE OR REPLACE is
// idempotent, so re-running it is always safe.
//
// The original DDL (0001, credentials patched by 0006) hardcoded the compose values, so the
// dictionary only ever loaded locally: in production every dictGetOrNull() threw, which 500'd the
// delegation-flow and delegates endpoints.

export type PgSource = {
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
};

/**
 * The connection ClickHouse uses to reach Postgres. Defaults reproduce the compose topology so local
 * dev and CI need no env at all; production overrides them in the operator's shell.
 */
export function pgSourceFromEnv(env: NodeJS.ProcessEnv = process.env): PgSource {
  const rawPort = env['CH_DICT_PG_PORT'];
  const port = Number(rawPort ?? 5432);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`CH_DICT_PG_PORT must be a positive integer, got "${rawPort}"`);
  }
  return {
    host: env['CH_DICT_PG_HOST'] ?? 'postgres',
    port,
    user: env['CH_DICT_PG_USER'] ?? 'kvorum',
    password: env['CH_DICT_PG_PASSWORD'] ?? 'kvorum',
    db: env['CH_DICT_PG_DB'] ?? 'kvorum',
  };
}

/** Single-quoted ClickHouse string literal. Values come from env, so escape rather than trust them. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * address → current actor id, unioning direct addresses with the redirects left behind by actor
 * merges (a redirect only applies while no direct row shadows it). Mirrors the query frozen in
 * migration 0001/0006 — only the connection is configurable.
 */
export function actorAddressRedirectDdl(pg: PgSource): string {
  return `CREATE OR REPLACE DICTIONARY actor_address_redirect
(
    address String,
    current_actor_id UUID
)
PRIMARY KEY address
SOURCE(
    POSTGRESQL(
        HOST ${quote(pg.host)}
        PORT ${pg.port}
        USER ${quote(pg.user)}
        PASSWORD ${quote(pg.password)}
        DB ${quote(pg.db)}
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
LAYOUT(HASHED())`;
}
