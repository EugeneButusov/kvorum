import type { Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export class DaoSourceRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findBySourceType(sourceType: string) {
    return this.db
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ])
      .where('dao_source.source_type', '=', sourceType)
      .execute();
  }
}
