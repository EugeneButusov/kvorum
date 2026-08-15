import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { ProposalEmbeddingScanRepository } from './proposal-embedding-scan-repository.js';

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

async function seed(trx: typeof pgDb): Promise<{ daoId: string; actorId: string }> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: 'embed-scan-dao',
      name: 'Embed Scan DAO',
      primary_token_address: '0x' + 'a'.repeat(40),
      primary_chain_id: 1,
      description: 'e',
      website_url: 'https://e.example.com',
      forum_url: 'https://forum.e.example.com',
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

function proposal(daoId: string, actorId: string, source_id: string, state: string) {
  return {
    dao_id: daoId,
    proposer_actor_id: actorId,
    source_type: 'compound_governor_bravo',
    source_id,
    description: 'body',
    description_hash: 'a'.repeat(64),
    binding: true,
    state,
    state_updated_at: new Date(),
    voting_starts_at: null,
    voting_ends_at: null,
    voting_starts_block: '1',
    voting_ends_block: '2',
    updated_at: new Date(),
  };
}

describeWithDb('ProposalEmbeddingScanRepository.findAllForBackfill (integration)', () => {
  it('covers every proposal above `pending`, excluding pending, keyset-paginated', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const rows = await trx
        .insertInto('proposal')
        .values([
          proposal(daoId, actorId, 'e-active', 'active'),
          proposal(daoId, actorId, 'e-executed', 'executed'),
          proposal(daoId, actorId, 'e-defeated', 'defeated'),
          proposal(daoId, actorId, 'e-pending', 'pending'), // excluded
        ])
        .returning(['id', 'source_id'])
        .execute();
      const expected = new Set(rows.filter((r) => r.source_id !== 'e-pending').map((r) => r.id));
      const pendingId = rows.find((r) => r.source_id === 'e-pending')!.id;

      const repo = new ProposalEmbeddingScanRepository(trx);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await repo.findAllForBackfill(cursor, 2);
        if (page.length === 0) break;
        seen.push(...page.map((r) => r.id));
        cursor = page[page.length - 1]!.id;
      }
      expect(new Set(seen.filter((id) => expected.has(id)))).toEqual(expected);
      expect(seen).not.toContain(pendingId);
      expect(seen.length).toBe(new Set(seen).size);
    });
  });

  it('scopes to daoSlugs when provided', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const [other] = await trx
        .insertInto('dao')
        .values({
          slug: 'embed-other',
          name: 'O',
          primary_token_address: '0x' + 'b'.repeat(40),
          primary_chain_id: 1,
          description: 'o',
          website_url: 'https://o.example.com',
          forum_url: 'https://f.o.example.com',
          updated_at: new Date(),
        })
        .returning(['id'])
        .execute();
      const [inScope] = await trx
        .insertInto('proposal')
        .values(proposal(daoId, actorId, 'in', 'executed'))
        .returning(['id'])
        .execute();
      await trx
        .insertInto('proposal')
        .values(proposal(other!.id, actorId, 'out', 'executed'))
        .execute();

      const ids = await new ProposalEmbeddingScanRepository(trx).findAllForBackfill(null, 100, [
        'embed-scan-dao',
      ]);
      expect(ids.map((r) => r.id)).toEqual([inScope!.id]);
    });
  });
});
