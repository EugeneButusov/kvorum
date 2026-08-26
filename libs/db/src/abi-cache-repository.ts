import { sql, type Kysely } from 'kysely';
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
   *
   * `abi` and `implementation_chain` are JSON *arrays*. node-postgres serialises a bare JS array as
   * a Postgres array literal (`{…}`), which a jsonb column rejects with `invalid input syntax for
   * type json`, so they must be passed as an explicit `::jsonb`-cast JSON string. (Object-valued
   * jsonb columns work without this because node-postgres JSON-stringifies plain objects.)
   */
  async upsert(row: NewAbiCache): Promise<void> {
    const abi = toJsonb(row.abi);
    const implementationChain =
      row.implementation_chain == null ? null : toJsonb(row.implementation_chain);
    await this.db
      .insertInto('abi_cache')
      .values({
        chain_id: row.chain_id,
        address: row.address.toLowerCase(),
        abi,
        source: row.source,
        fetched_at: row.fetched_at,
        implementation_chain: implementationChain,
      })
      .onConflict((oc) =>
        oc.constraint('abi_cache_pkey').doUpdateSet({
          abi,
          source: row.source,
          fetched_at: row.fetched_at,
          implementation_chain: implementationChain,
        }),
      )
      .execute();
  }
}

/** Serialise a value to a jsonb literal so array-valued columns don't hit pg array-literal parsing. */
function toJsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}
