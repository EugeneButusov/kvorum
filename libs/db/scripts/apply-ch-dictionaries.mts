// Applies the ClickHouse dictionaries whose source is a live Postgres connection (see
// libs/db/src/ch-dictionaries.ts for why these are per-environment config rather than migrations).
//
// Operator-run, not part of the deploy: `pnpm -w db:ch:dictionaries` after db:migrate:ch when an
// environment is provisioned or its CH→PG route changes (docs/runbooks/ch-dictionaries.md).
// CREATE OR REPLACE is idempotent. The dictionary is then reloaded and asserted LOADED, so a
// ClickHouse that cannot reach Postgres fails here, loudly, instead of throwing inside
// dictGetOrNull() on every analytics request.
import { fileURLToPath } from 'node:url';
import { createClient } from '@clickhouse/client';
import { actorAddressRedirectDdl, pgSourceFromEnv } from '../src/ch-dictionaries';

async function run() {
  const pg = pgSourceFromEnv();
  const client = createClient({
    url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
    username: process.env['CLICKHOUSE_USER'] ?? 'default',
    password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
    database: process.env['CLICKHOUSE_DATABASE'] ?? 'default',
  });

  try {
    // Never log the password.
    console.log(
      `[ch-dictionaries] actor_address_redirect → postgres ${pg.user}@${pg.host}:${pg.port}/${pg.db}`,
    );
    await client.command({
      query: actorAddressRedirectDdl(pg),
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await client.command({
      query: 'SYSTEM RELOAD DICTIONARY actor_address_redirect',
      clickhouse_settings: { wait_end_of_query: 1 },
    });

    const resultSet = await client.query({
      query: `SELECT status, last_exception FROM system.dictionaries WHERE name = 'actor_address_redirect'`,
      format: 'JSONEachRow',
    });
    const rows = await resultSet.json<{ status: string; last_exception: string }>();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('actor_address_redirect is missing from system.dictionaries after creation');
    }
    if (row.status !== 'LOADED') {
      throw new Error(
        `actor_address_redirect failed to load (status=${row.status}): ${row.last_exception}\n` +
          `ClickHouse must be able to reach Postgres at ${pg.host}:${pg.port} as user "${pg.user}". ` +
          `Set CH_DICT_PG_HOST / CH_DICT_PG_PORT / CH_DICT_PG_USER / CH_DICT_PG_PASSWORD / CH_DICT_PG_DB.`,
      );
    }
    console.log('[ch-dictionaries] actor_address_redirect LOADED');
  } finally {
    await client.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await run();
  } catch (error) {
    console.error(`[ch-dictionaries] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
