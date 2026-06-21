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
    // Deterministic order on the (source_type, chain_id) business key — without it Postgres
    // returns heap order, which is unstable across inserts/deletes and makes both the response
    // and its ETag non-deterministic.
    return this.db
      .selectFrom('dao_source')
      .select(['source_type', 'source_config'])
      .where('dao_id', '=', daoId)
      .orderBy('source_type', 'asc')
      .orderBy('chain_id', 'asc')
      .execute();
  }

  async findSourceByDaoSlugAndType(
    daoSlug: string,
    sourceType: string,
  ): Promise<Pick<DaoSource, 'id' | 'dao_id' | 'source_type' | 'source_config'> | undefined> {
    return this.db
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
      ])
      .where('dao.slug', '=', daoSlug)
      .where('dao_source.source_type', '=', sourceType)
      .executeTakeFirst();
  }
}
