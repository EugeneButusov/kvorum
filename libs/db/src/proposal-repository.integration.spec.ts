import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from './client';
import { ProposalRepository } from './proposal-repository';

const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;
class RollbackSignal extends Error {}

afterAll(async () => {
  await pgDb.destroy();
});

async function inRollback(fn: (trx: typeof pgDb) => Promise<void>): Promise<void> {
  await pgDb
    .transaction()
    .execute(async (trx) => {
      await fn(trx);
      throw new RollbackSignal();
    })
    .catch((err) => {
      if (!(err instanceof RollbackSignal)) throw err;
    });
}

async function seedScanFixture(trx: typeof pgDb): Promise<{ daoId: string; actorId: string }> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: 'summ-dao',
      name: 'Summ DAO',
      primary_token_address: '0x' + 'a'.repeat(40),
      primary_chain_id: 1,
      description: 'summ',
      website_url: 'https://summ.example.com',
      forum_url: 'https://forum.summ.example.com',
      updated_at: new Date(),
    })
    .returning(['id'])
    .execute();
  const [actor] = await trx
    .insertInto('actor')
    .values({ primary_address: '0x' + 'd'.repeat(40), updated_at: new Date() })
    .returning(['id'])
    .execute();
  return { daoId: dao!.id, actorId: actor!.id };
}

describeWithDb('ProposalRepository.findById (integration)', () => {
  it('returns the row by id, or undefined when absent', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedScanFixture(trx);
      const [inserted] = await trx
        .insertInto('proposal')
        .values({
          dao_id: daoId,
          source_type: 'compound_governor_bravo',
          source_id: 'p-byid',
          proposer_actor_id: actorId,
          description: 'body',
          description_hash: 'a'.repeat(64),
          binding: true,
          voting_starts_at: null,
          voting_ends_at: null,
          voting_starts_block: '1',
          voting_ends_block: '2',
          state: 'active',
          state_updated_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date(),
        })
        .returning(['id'])
        .execute();

      const repo = new ProposalRepository(trx);
      const found = await repo.findById(inserted!.id);
      expect(found?.source_id).toBe('p-byid');
      const missing = await repo.findById('00000000-0000-0000-0000-000000000000');
      expect(missing).toBeUndefined();
    });
  });
});
