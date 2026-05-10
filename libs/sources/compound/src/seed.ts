import type { Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

export async function seedCompound(db: Kysely<PgDatabase>): Promise<void> {
  await db
    .insertInto('dao')
    .values({
      slug: 'compound',
      name: 'Compound',
      primary_token_address: '0xc00e94cb662c3520282e6f5717214004a7f26888',
      primary_chain_id: 1,
      description:
        'Compound is an algorithmic, autonomous interest rate protocol built for developers, to unlock a universe of open financial applications.',
      website_url: 'https://compound.finance',
      forum_url: 'https://gov.compound.finance',
      updated_at: new Date(),
    })
    .onConflict((oc) => oc.column('slug').doNothing())
    .execute();

  const dao = await db
    .selectFrom('dao')
    .select(['id'])
    .where('slug', '=', 'compound')
    .executeTakeFirstOrThrow();

  await db
    .insertInto('dao_source')
    .values({
      dao_id: dao.id,
      source_type: 'compound_governor',
      source_config: { governor_address: '0xc0Da02939E1441F497fd74F78cE7Decb17B66529' },
      // I1 probes for the first event at backfill start and persists the block
      // back to active_from_block — hard-coding a block number here risks
      // scanning empty history (too low) or missing early proposals (too high).
      active_from_block: null,
    })
    .onConflict((oc) => oc.columns(['dao_id', 'source_type']).doNothing())
    .execute();
}
