import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { ProposalSummaryScanRepository } from './proposal-summary-scan-repository.js';

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

async function seedFixture(trx: typeof pgDb): Promise<{ daoId: string; actorId: string }> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: 'summ-scan-dao',
      name: 'Summ Scan DAO',
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
    .values({ primary_address: '0x' + 'e'.repeat(40), updated_at: new Date() })
    .returning(['id'])
    .execute();
  return { daoId: dao!.id, actorId: actor!.id };
}

describeWithDb('ProposalSummaryScanRepository.findCandidates (integration)', () => {
  it('returns binding OR snapshot-signaling proposals in states, excluding others, ordered', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedFixture(trx);
      const base = {
        dao_id: daoId,
        proposer_actor_id: actorId,
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
          // included — binding on-chain proposals in the states
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'p-pending',
            binding: true,
            state: 'pending',
            state_updated_at: new Date('2026-01-01T00:00:00Z'),
            updated_at: new Date(),
          },
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'p-active',
            binding: true,
            state: 'active',
            state_updated_at: new Date('2026-01-02T00:00:00Z'),
            updated_at: new Date(),
          },
          // included — non-binding Snapshot signaling proposal
          {
            ...base,
            source_type: 'snapshot',
            source_id: 'p-snapshot',
            binding: false,
            state: 'active',
            state_updated_at: new Date('2026-01-03T00:00:00Z'),
            updated_at: new Date(),
          },
          // excluded — wrong state
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'p-executed',
            binding: true,
            state: 'executed',
            state_updated_at: new Date('2026-01-04T00:00:00Z'),
            updated_at: new Date(),
          },
          // excluded — non-binding AND not a snapshot source
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'p-nonbinding-other',
            binding: false,
            state: 'active',
            state_updated_at: new Date('2026-01-05T00:00:00Z'),
            updated_at: new Date(),
          },
        ])
        .execute();

      const rows = await new ProposalSummaryScanRepository(trx).findCandidates(
        ['pending', 'active'],
        10,
      );
      const sourceIds = rows.map((r) => r.source_id).filter((id) => id.startsWith('p-'));
      expect(sourceIds).toEqual(['p-pending', 'p-active', 'p-snapshot']);
    });
  });

  it('returns [] for an empty states array', async () => {
    await inRollback(async (trx) => {
      const rows = await new ProposalSummaryScanRepository(trx).findCandidates([], 10);
      expect(rows).toEqual([]);
    });
  });
});

describeWithDb('ProposalSummaryScanRepository.findAllForBackfill (integration)', () => {
  it('covers binding OR signaling proposals in EVERY state (incl. terminal), keyset-paginated', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedFixture(trx);
      const base = {
        dao_id: daoId,
        proposer_actor_id: actorId,
        description: 'body',
        description_hash: 'a'.repeat(64),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
        updated_at: new Date(),
      };
      const rows = await trx
        .insertInto('proposal')
        .values([
          // included — binding, terminal (the windowed scan excludes terminal states)
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'bf-executed',
            binding: true,
            state: 'executed',
            state_updated_at: new Date(),
          },
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'bf-defeated',
            binding: true,
            state: 'defeated',
            state_updated_at: new Date(),
          },
          // included — snapshot signaling, terminal
          {
            ...base,
            source_type: 'snapshot',
            source_id: 'bf-snapshot',
            binding: false,
            state: 'canceled',
            state_updated_at: new Date(),
          },
          // excluded — non-binding, non-snapshot
          {
            ...base,
            source_type: 'compound_governor_bravo',
            source_id: 'bf-nonbinding',
            binding: false,
            state: 'executed',
            state_updated_at: new Date(),
          },
        ])
        .returning(['id', 'source_id'])
        .execute();
      const expected = new Set(
        rows.filter((r) => r.source_id !== 'bf-nonbinding').map((r) => r.id),
      );

      const repo = new ProposalSummaryScanRepository(trx);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await repo.findAllForBackfill(cursor, 2);
        if (page.length === 0) break;
        seen.push(...page.map((r) => r.id));
        cursor = page[page.length - 1]!.id;
      }
      const seenExpected = seen.filter((id) => expected.has(id));
      expect(new Set(seenExpected)).toEqual(expected);
      expect(
        seen.filter((id) => rows.some((r) => r.id === id && r.source_id === 'bf-nonbinding')),
      ).toEqual([]);
      expect(seen.length).toBe(new Set(seen).size); // no page overlap
    });
  });

  it('scopes to daoSlugs when provided', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedFixture(trx);
      const [other] = await trx
        .insertInto('dao')
        .values({
          slug: 'summ-other',
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
      const base = (dao_id: string) => ({
        dao_id,
        proposer_actor_id: actorId,
        source_type: 'compound_governor_bravo',
        description: 'b',
        description_hash: 'a'.repeat(64),
        binding: true,
        state: 'executed',
        state_updated_at: new Date(),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
        updated_at: new Date(),
      });
      const [inScope] = await trx
        .insertInto('proposal')
        .values({ ...base(daoId), source_id: 's-in' })
        .returning(['id'])
        .execute();
      await trx
        .insertInto('proposal')
        .values({ ...base(other!.id), source_id: 's-out' })
        .execute();

      const ids = await new ProposalSummaryScanRepository(trx).findAllForBackfill(null, 100, [
        'summ-scan-dao',
      ]);
      expect(ids.map((r) => r.id)).toEqual([inScope!.id]);
    });
  });
});
