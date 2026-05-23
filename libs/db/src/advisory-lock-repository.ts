import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export class AdvisoryLockRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async withLock<T>(lockKey: string, run: () => Promise<T>): Promise<T | undefined> {
    return this.db.connection().execute(async (conn) => {
      const lock = await sql<{ acquired: boolean }>`
        select pg_try_advisory_lock(hashtext(${lockKey})) as acquired
      `.execute(conn);
      const acquired = lock.rows[0]?.acquired ?? false;
      if (!acquired) return undefined;

      try {
        return await run();
      } finally {
        await sql`select pg_advisory_unlock(hashtext(${lockKey}))`.execute(conn);
      }
    });
  }
}
