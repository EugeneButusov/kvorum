import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Dao, DaoSource, PgDatabase, SourceType } from './schema/pg';

export interface CreateDaoInput {
  slug: string;
  name: string;
  primaryTokenAddress: string;
  primaryChainId: string;
}

export interface AddDaoSourceInput {
  daoId: string;
  sourceType: SourceType;
  chainId: string;
  sourceConfig: unknown;
}

export class DaoAdminRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async createDao(input: CreateDaoInput): Promise<Dao> {
    return this.db
      .insertInto('dao')
      .values({
        slug: input.slug,
        name: input.name,
        primary_token_address: input.primaryTokenAddress,
        primary_chain_id: input.primaryChainId,
        description: '',
        website_url: '',
        forum_url: '',
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findDaoBySlug(slug: string): Promise<Pick<Dao, 'id' | 'slug'> | undefined> {
    return this.db
      .selectFrom('dao')
      .select(['id', 'slug'])
      .where('slug', '=', slug)
      .executeTakeFirst();
  }

  async addSource(input: AddDaoSourceInput): Promise<DaoSource> {
    return this.db
      .insertInto('dao_source')
      .values({
        dao_id: input.daoId,
        source_type: input.sourceType,
        chain_id: input.chainId,
        source_config: input.sourceConfig,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateSourceConfig(daoSourceId: string, sourceConfig: unknown): Promise<number> {
    const result = await this.db
      .updateTable('dao_source')
      .set({ source_config: sourceConfig })
      .where('id', '=', daoSourceId)
      .executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0n);
  }

  async findSourceById(
    daoSourceId: string,
  ): Promise<{ id: string; source_type: SourceType; source_config: unknown } | undefined> {
    return this.db
      .selectFrom('dao_source')
      .select(['id', 'source_type', 'source_config'])
      .where('id', '=', daoSourceId)
      .executeTakeFirst();
  }

  async sourceTypeExists(sourceType: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('source_type')
      .select(sql<number>`1`.as('ok'))
      .where('value', '=', sourceType)
      .executeTakeFirst();
    return row != null;
  }
}
