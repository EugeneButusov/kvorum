import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { Dao, DaoSource, PgDatabase } from './schema/pg';

// ADR-040: keep DB schema-aware read-query construction in libs/db.
export class DaoReadRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  listBaseQuery(): SelectQueryBuilder<PgDatabase, 'dao', Dao> {
    return this.db.selectFrom('dao').selectAll();
  }

  async findDaoBySlug(slug: string): Promise<Dao | undefined> {
    return this.db.selectFrom('dao').selectAll().where('slug', '=', slug).executeTakeFirst();
  }

  async listSourcesForDao(
    daoId: string,
  ): Promise<Array<Pick<DaoSource, 'source_type' | 'source_config'>>> {
    return this.db
      .selectFrom('dao_source')
      .select(['source_type', 'source_config'])
      .where('dao_id', '=', daoId)
      .execute();
  }
}
