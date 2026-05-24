import { type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export interface SystemStatusSnapshot {
  dlqSize: number;
  activeBackfills: number;
  lastArchivedEventAt: Date | null;
}

export class SystemStatusRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async read(): Promise<SystemStatusSnapshot> {
    const [dlqRow, archiveRow, activeBackfills] = await Promise.all([
      this.db
        .selectFrom('ingestion_dlq')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('archive_event')
        .select((eb) => eb.fn.max('received_at').as('last_received_at'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('dao_source')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('backfill_started_at_block', 'is not', null)
        .executeTakeFirstOrThrow(),
    ]);

    return {
      dlqSize: Number(dlqRow.count),
      activeBackfills: Number(activeBackfills.count),
      lastArchivedEventAt: archiveRow.last_received_at ?? null,
    };
  }
}
