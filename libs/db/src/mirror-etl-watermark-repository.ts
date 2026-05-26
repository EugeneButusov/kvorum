import type { Kysely, Transaction } from 'kysely';
import type { PgDatabase } from './schema/pg';

export class MirrorEtlWatermarkRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async findByName(name: string): Promise<Date | undefined> {
    const row = await this.db
      .selectFrom('etl_watermark')
      .select('watermark')
      .where('name', '=', name)
      .executeTakeFirst();
    return row?.watermark;
  }

  async advance(name: string, to: Date): Promise<void> {
    await this.db
      .updateTable('etl_watermark')
      .set({ watermark: to, updated_at: new Date() })
      .where('name', '=', name)
      .executeTakeFirst();
  }

  async resetTo(name: string, watermark: Date): Promise<void> {
    await this.db
      .updateTable('etl_watermark')
      .set({ watermark, updated_at: new Date() })
      .where('name', '=', name)
      .executeTakeFirst();
  }
}
