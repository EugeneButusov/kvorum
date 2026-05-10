import { Kysely, PostgresDialect } from 'kysely';
import { ClickhouseDialect } from '@founderpath/kysely-clickhouse';
import { Pool } from 'pg';
import type { PgDatabase } from './schema/pg';
import type { ClickHouseDatabase } from './schema/clickhouse';

// numeric (OID 1700) and bigint (OID 20) are intentionally returned as string
// by the pg driver. Do NOT register custom pg-types parsers for these OIDs —
// string precision is load-bearing for numeric(78,0) value_wei and bigint block
// numbers, and SPEC §4.7 wire format expects big-int strings as a passthrough.
export const pgDb = new Kysely<PgDatabase>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: process.env['DATABASE_URL'],
    }),
  }),
});

export const chDb = new Kysely<ClickHouseDatabase>({
  dialect: new ClickhouseDialect({
    options: {
      url: process.env['CLICKHOUSE_URL'] ?? 'http://localhost:8123',
      username: process.env['CLICKHOUSE_USER'] ?? 'default',
      password: process.env['CLICKHOUSE_PASSWORD'] ?? '',
      database: process.env['CLICKHOUSE_DATABASE'] ?? 'default',
      clickhouse_settings: {
        // Prevents part explosion when F1/I1 write one event at a time.
        // wait_for_async_insert=1 ensures the caller gets confirmation before
        // proceeding to the Postgres write (ADR-041 PG-first-then-CH protocol).
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    },
  }),
});
