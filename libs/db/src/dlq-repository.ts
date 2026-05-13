import type { Kysely } from 'kysely';
import type { NewIngestionDlq, PgDatabase } from './schema/pg';

export interface DlqDepthRow {
  stage: string;
  source: string;
  count: number;
}

export class DlqRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async insert(row: NewIngestionDlq): Promise<void> {
    await this.pgDb.insertInto('ingestion_dlq').values(row).execute();
  }

  async depthByStageAndSource(): Promise<DlqDepthRow[]> {
    const rows = await this.pgDb
      .selectFrom('ingestion_dlq')
      .select(['stage', 'source', this.pgDb.fn.countAll<string>().as('count')])
      .groupBy(['stage', 'source'])
      .execute();
    return rows.map((r) => ({ stage: r.stage, source: r.source, count: Number(r.count) }));
  }
}
