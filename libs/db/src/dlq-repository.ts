import type { Kysely } from 'kysely';
import type { NewIngestionDlq, PgDatabase } from './schema/pg';

export class DlqRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async insert(row: NewIngestionDlq): Promise<void> {
    await this.pgDb.insertInto('ingestion_dlq').values(row).execute();
  }
}
