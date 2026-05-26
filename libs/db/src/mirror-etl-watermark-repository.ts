import type { Kysely, Transaction } from 'kysely';
import type { PgDatabase } from './schema/pg';

export class MirrorEtlWatermarkRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async findByName(jobName: string): Promise<Date | undefined> {
    const row = await this.db
      .selectFrom('etl_watermark')
      .select('watermark')
      .where('job_name', '=', jobName)
      .executeTakeFirst();
    return row?.watermark;
  }

  async advance(jobName: string, to: Date): Promise<void> {
    await this.db
      .updateTable('etl_watermark')
      .set({ watermark: to, updated_at: new Date() })
      .where('job_name', '=', jobName)
      .executeTakeFirst();
  }

  async resetTo(jobName: string, watermark: Date): Promise<void> {
    await this.db
      .updateTable('etl_watermark')
      .set({ watermark, updated_at: new Date() })
      .where('job_name', '=', jobName)
      .executeTakeFirst();
  }
}
