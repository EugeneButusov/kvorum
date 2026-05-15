import type { Kysely } from 'kysely';
import type { AbiCache, NewAbiCache, PgDatabase } from './schema/pg';

export class AbiCacheRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findByAddress(chainId: string, address: string): Promise<AbiCache | undefined> {
    return this.db
      .selectFrom('abi_cache')
      .selectAll()
      .where('chain_id', '=', chainId)
      .where('address', '=', address.toLowerCase())
      .executeTakeFirst();
  }

  /**
   * Upsert an ABI cache row. Normalises address to lowercase.
   * Allowed source values: 'bundled_library' | 'proxy_resolved' | 'etherscan'
   */
  async upsert(row: NewAbiCache): Promise<void> {
    const normalised: NewAbiCache = { ...row, address: row.address.toLowerCase() };
    await this.db
      .insertInto('abi_cache')
      .values(normalised)
      .onConflict((oc) =>
        oc.constraint('abi_cache_pkey').doUpdateSet({
          abi: normalised.abi as never,
          source: normalised.source,
          fetched_at: normalised.fetched_at,
          implementation_chain: normalised.implementation_chain ?? null,
        }),
      )
      .execute();
  }
}
