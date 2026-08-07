import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { SimilarProposalsRepository } from './similar-proposals-repository.js';
import { EMBEDDING_VERSION } from '../schemas/proposal-embedding-input.js';
import './schema'; // merge proposal_embedding into PgDatabase

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

/** A 1536-dim pgvector literal — zeros except the given component indices. Distinct directions give
 *  distinct cosine similarities (all-equal-component vectors are parallel → useless for ranking). */
function mkVec(components: Record<number, number>): string {
  const arr = new Array(1536).fill(0) as number[];
  for (const [i, v] of Object.entries(components)) arr[Number(i)] = v;
  return `[${arr.join(',')}]`;
}

const TARGET = mkVec({ 0: 1 }); // [1,0,…]
const NEAR = mkVec({ 0: 1, 1: 0.1 }); // cosine ≈ 0.995
const MID = mkVec({ 0: 1, 1: 1 }); // cosine ≈ 0.707
const FAR = mkVec({ 1: 1 }); // cosine = 0 (orthogonal)

async function seedDao(
  trx: typeof pgDb,
  slug: string,
): Promise<{ daoId: string; actorId: string }> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug,
      name: slug,
      primary_token_address: '0x' + '1'.repeat(40),
      primary_chain_id: 1,
      description: 's',
      website_url: `https://${slug}.example.com`,
      forum_url: `https://forum.${slug}.example.com`,
      updated_at: new Date(),
    })
    .returning(['id'])
    .execute();
  const [actor] = await trx
    .insertInto('actor')
    .values({
      primary_address:
        '0x' +
        slug
          .replace(/[^a-f0-9]/g, '0')
          .padEnd(40, '0')
          .slice(0, 40),
      updated_at: new Date(),
    })
    .returning(['id'])
    .execute();
  return { daoId: dao!.id, actorId: actor!.id };
}

async function insertProposal(
  trx: typeof pgDb,
  daoId: string,
  actorId: string,
  sourceId: string,
  sourceType = 'compound_governor_bravo',
): Promise<string> {
  const [row] = await trx
    .insertInto('proposal')
    .values({
      dao_id: daoId,
      source_type: sourceType,
      source_id: sourceId,
      proposer_actor_id: actorId,
      title: `Proposal ${sourceId}`,
      description: 'body',
      description_hash: 'a'.repeat(64),
      binding: true,
      state: 'active',
      state_updated_at: new Date(),
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '1',
      voting_ends_block: '2',
      updated_at: new Date(),
    } as never)
    .returning(['id'])
    .execute();
  return row!.id as string;
}

async function embed(trx: typeof pgDb, proposalId: string, vector: string): Promise<void> {
  await trx
    .insertInto('proposal_embedding')
    .values({
      proposal_id: proposalId,
      embedding_version: EMBEDDING_VERSION,
      input_hash: `sha256:${proposalId}`,
      embedding: vector,
      generated_at: new Date(),
      cost_usd: '0.0001',
    })
    .execute();
}

describeWithDb('SimilarProposalsRepository.findSimilar (integration)', () => {
  it('ranks by cosine similarity, excludes self, monotonic descending', async () => {
    await inRollback(async (trx) => {
      const a = await seedDao(trx, 'sim-dao-a');
      const b = await seedDao(trx, 'sim-dao-b');
      const target = await insertProposal(trx, a.daoId, a.actorId, 't');
      const mid = await insertProposal(trx, a.daoId, a.actorId, 'mid');
      const near = await insertProposal(trx, b.daoId, b.actorId, 'near');
      const far = await insertProposal(trx, b.daoId, b.actorId, 'far');
      await embed(trx, target, TARGET);
      await embed(trx, mid, MID);
      await embed(trx, near, NEAR);
      await embed(trx, far, FAR);

      const rows = await new SimilarProposalsRepository(trx).findSimilar(target, { limit: 10 });

      expect(rows.map((r) => r.source_id)).toEqual(['near', 'mid', 'far']); // most → least similar
      expect(rows.map((r) => r.source_id)).not.toContain('t'); // self excluded
      expect(rows[0]!.similarity).toBeGreaterThan(rows[1]!.similarity);
      expect(rows[1]!.similarity).toBeGreaterThan(rows[2]!.similarity);
      expect(rows[0]!.dao_slug).toBe('sim-dao-b'); // cross-DAO by default
      expect(rows[0]!.title).toBe('Proposal near');
    });
  });

  it('narrows to a single DAO when the dao filter is set', async () => {
    await inRollback(async (trx) => {
      const a = await seedDao(trx, 'sim-dao-a');
      const b = await seedDao(trx, 'sim-dao-b');
      const target = await insertProposal(trx, a.daoId, a.actorId, 't');
      const mid = await insertProposal(trx, a.daoId, a.actorId, 'mid');
      const near = await insertProposal(trx, b.daoId, b.actorId, 'near');
      const far = await insertProposal(trx, b.daoId, b.actorId, 'far');
      await embed(trx, target, TARGET);
      await embed(trx, mid, MID);
      await embed(trx, near, NEAR);
      await embed(trx, far, FAR);

      const rows = await new SimilarProposalsRepository(trx).findSimilar(target, {
        dao: 'sim-dao-b',
        limit: 10,
      });
      expect(rows.map((r) => r.source_id)).toEqual(['near', 'far']);
      expect(rows.every((r) => r.dao_slug === 'sim-dao-b')).toBe(true);
    });
  });

  it('returns [] when the target proposal has no current-version embedding', async () => {
    await inRollback(async (trx) => {
      const a = await seedDao(trx, 'sim-dao-a');
      const target = await insertProposal(trx, a.daoId, a.actorId, 't'); // no embed()
      const other = await insertProposal(trx, a.daoId, a.actorId, 'other');
      await embed(trx, other, NEAR);
      expect(await new SimilarProposalsRepository(trx).findSimilar(target, { limit: 10 })).toEqual(
        [],
      );
    });
  });
});
