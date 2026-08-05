import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { ProposalEmbeddingRepository } from './proposal-embedding-repository.js';
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

/** A 1536-dim vector literal in pgvector text form, every component = `v`. */
function vec(v: number): string {
  return `[${Array(1536).fill(v).join(',')}]`;
}

async function seedDaoActor(trx: typeof pgDb): Promise<{ daoId: string; actorId: string }> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: 'emb-dao',
      name: 'Embedding DAO',
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
    .values({ primary_address: '0x' + 'f'.repeat(40), updated_at: new Date() })
    .returning(['id'])
    .execute();
  return { daoId: dao!.id, actorId: actor!.id };
}

async function insertProposal(
  trx: typeof pgDb,
  daoId: string,
  actorId: string,
  sourceId: string,
): Promise<string> {
  const [proposal] = await trx
    .insertInto('proposal')
    .values({
      dao_id: daoId,
      source_type: 'compound_governor_bravo',
      source_id: sourceId,
      proposer_actor_id: actorId,
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
  return proposal!.id as string;
}

describeWithDb('proposal_embedding (pgvector integration)', () => {
  it('has the ivfflat cosine index from the migration', async () => {
    const res = await sql<{ indexdef: string }>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'proposal_embedding_embedding_ivfflat'
    `.execute(pgDb);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.indexdef.toLowerCase()).toContain('ivfflat');
  });

  it('stores a 1536-dim vector and answers a cosine nearest-neighbour query', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedDaoActor(trx);
      const near = await insertProposal(trx, daoId, actorId, 'p-near');
      const far = await insertProposal(trx, daoId, actorId, 'p-far');

      await trx
        .insertInto('proposal_embedding')
        .values([
          {
            proposal_id: near,
            embedding_version: 'text-embedding-3-small/v1',
            input_hash: 'sha256:near',
            embedding: vec(0.1),
            generated_at: new Date(),
            cost_usd: '0.0001',
          },
          {
            proposal_id: far,
            embedding_version: 'text-embedding-3-small/v1',
            input_hash: 'sha256:far',
            embedding: vec(-0.1), // opposite direction → max cosine distance
            generated_at: new Date(),
            cost_usd: '0.0001',
          },
        ])
        .execute();

      const ranked = await sql<{ proposal_id: string; distance: string }>`
        SELECT proposal_id, (embedding <=> ${vec(0.1)}::vector) AS distance
        FROM proposal_embedding
        WHERE proposal_id IN (${near}, ${far})
        ORDER BY distance ASC
      `.execute(trx);

      expect(ranked.rows.map((r) => r.proposal_id)).toEqual([near, far]);
      expect(Number(ranked.rows[0]!.distance)).toBeCloseTo(0, 5); // identical vector → ~0 distance
      expect(Number(ranked.rows[1]!.distance)).toBeGreaterThan(1); // opposite → large distance
    });
  });
});

describeWithDb('ProposalEmbeddingRepository (integration)', () => {
  const VERSION = 'text-embedding-3-small/v1';

  it('upserts (insert, then overwrite in place) and finds by proposal+version', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seedDaoActor(trx);
      const proposalId = await insertProposal(trx, daoId, actorId, 'p-embed');
      const repo = new ProposalEmbeddingRepository(trx);

      expect(await repo.findByProposalVersion(proposalId, VERSION)).toBeUndefined();

      await repo.upsert({
        proposal_id: proposalId,
        embedding_version: VERSION,
        input_hash: 'sha256:one',
        embedding: vec(0.1),
        generated_at: new Date(),
        cost_usd: '0.0001',
      });
      expect((await repo.findByProposalVersion(proposalId, VERSION))?.input_hash).toBe(
        'sha256:one',
      );

      // Same key, new hash + vector → overwrite in place, not a second row.
      await repo.upsert({
        proposal_id: proposalId,
        embedding_version: VERSION,
        input_hash: 'sha256:two',
        embedding: vec(0.2),
        generated_at: new Date(),
        cost_usd: '0.0002',
      });
      expect((await repo.findByProposalVersion(proposalId, VERSION))?.input_hash).toBe(
        'sha256:two',
      );

      const count = await trx
        .selectFrom('proposal_embedding')
        .select(sql<string>`count(*)`.as('n'))
        .where('proposal_id', '=', proposalId)
        .where('embedding_version', '=', VERSION)
        .executeTakeFirstOrThrow();
      expect(Number(count.n)).toBe(1);
    });
  });
});
