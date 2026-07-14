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

describeWithDb('ProposalRepository.findBindingInStates (integration)', () => {
  it('returns only binding proposals in the requested states, capped and ordered', async () => {
    await inRollback(async (trx) => {
      const [dao] = await trx
        .insertInto('dao')
        .values({
          slug: 'scan-dao',
          name: 'Scan DAO',
          primary_token_address: '0x' + 'a'.repeat(40),
          primary_chain_id: 1,
          description: 'scan',
          website_url: 'https://scan.example.com',
          forum_url: 'https://forum.scan.example.com',
          updated_at: new Date(),
        })
        .returning(['id'])
        .execute();
      const [actor] = await trx
        .insertInto('actor')
        .values({ primary_address: '0x' + 'c'.repeat(40), updated_at: new Date() })
        .returning(['id'])
        .execute();

      const base = {
        dao_id: dao!.id,
        source_type: 'compound_governor_bravo' as const,
        proposer_actor_id: actor!.id,
        description: 'body',
        description_hash: 'a'.repeat(64),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
      };
      await trx
        .insertInto('proposal')
        .values([
          {
            ...base,
            source_id: 'p-active',
            binding: true,
            state: 'active',
            state_updated_at: new Date('2026-01-02T00:00:00Z'),
            updated_at: new Date(),
          },
          {
            ...base,
            source_id: 'p-pending',
            binding: true,
            state: 'pending',
            state_updated_at: new Date('2026-01-01T00:00:00Z'),
            updated_at: new Date(),
          },
          {
            ...base,
            source_id: 'p-executed',
            binding: true,
            state: 'executed',
            state_updated_at: new Date('2026-01-03T00:00:00Z'),
            updated_at: new Date(),
          },
          {
            ...base,
            source_id: 'p-signaling',
            binding: false,
            state: 'active',
            state_updated_at: new Date('2026-01-04T00:00:00Z'),
            updated_at: new Date(),
          },
        ])
        .execute();

      const rows = await new ProposalRepository(trx).findBindingInStates(['pending', 'active'], 10);
      // Scope to this test's own fixture rows (`p-` prefix): the shared integration DB can carry
      // binding/active proposal rows committed by unrelated tests outside any rollback transaction
      // (e.g. actor-merge-repository.integration.spec.ts), so asserting the full result set isn't
      // reliable. Our fixed 2026-01-* timestamps always sort ahead of `now()`-stamped leaked rows.
      const sourceIds = rows.map((r) => r.source_id).filter((id) => id.startsWith('p-'));
      expect(sourceIds).toEqual(['p-pending', 'p-active']); // binding + in states, ordered by state_updated_at asc
    });
  });

  it('returns [] for an empty states array', async () => {
    await inRollback(async (trx) => {
      const rows = await new ProposalRepository(trx).findBindingInStates([], 10);
      expect(rows).toEqual([]);
    });
  });
});
