import { ClickhouseDialect } from '@founderpath/kysely-clickhouse';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { ClickHouseDatabase } from './schema/clickhouse';
import type { PgDatabase } from './schema/pg';

// numeric (OID 1700) and bigint (OID 20) are intentionally returned as string
// by the pg driver. Do NOT register custom pg-types parsers for these OIDs —
// string precision is load-bearing for numeric(78,0) value_wei and bigint block
// numbers, and SPEC §4.7 wire format expects big-int strings as a passthrough.
export const pgPool = new Pool({
  connectionString: process.env['DATABASE_URL'],
});

// An idle pooled client can emit 'error' when the server drops the connection
// (Postgres restart, idle timeout, network blip). `pg` re-emits an 'error' with
// no listener as an uncaught exception, which crashes the whole process. Log and
// swallow it — the pool discards the broken client and the next acquire opens a
// fresh connection. KNOWN-001: replace console with a structured logger in M2.
pgPool.on('error', (err: Error) => {
  console.error('[pg-pool] idle client error (connection recycled):', err.message);
});

export const pgDb = new Kysely<PgDatabase>({
  dialect: new PostgresDialect({ pool: pgPool }),
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
