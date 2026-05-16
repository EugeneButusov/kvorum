import { type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export interface SystemStatusSnapshot {
  dlqSize: number;
  activeBackfills: number;
  lastReorgDetectedAt: Date | null;
  lastArchivedEventAt: Date | null;
}

export class SystemStatusRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async read(): Promise<SystemStatusSnapshot> {
    const [dlqRow, reorgRow, archiveRow, activeBackfills] = await Promise.all([
      this.db
        .selectFrom('ingestion_dlq')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('reorg_event')
        .select((eb) => eb.fn.max('detected_at').as('last_detected_at'))
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('archive_confirmation')
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
      lastReorgDetectedAt: reorgRow.last_detected_at ?? null,
      lastArchivedEventAt: archiveRow.last_received_at ?? null,
    };
  }
}
