import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

export type DaoSourceLockResult<T> = { status: 'executed'; value: T } | { status: 'contended' };

export async function withDaoSourceAdvisoryLock<T>(input: {
  db: Kysely<PgDatabase>;
  daoSourceId: string;
  run: () => Promise<T>;
}): Promise<DaoSourceLockResult<T>> {
  const { db, daoSourceId, run } = input;

  const lockRow = await sql<{ locked: boolean }>`
    select pg_try_advisory_lock(hashtextextended(${daoSourceId}::text, 0)) as locked
  `.execute(db);

  if (lockRow.rows[0]?.locked !== true) {
    return { status: 'contended' };
  }

  try {
    return { status: 'executed', value: await run() };
  } finally {
    await sql`
      select pg_advisory_unlock(hashtextextended(${daoSourceId}::text, 0))
    `.execute(db);
  }
}
