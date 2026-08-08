import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { ForumThreadReadRepository } from './forum-thread-read-repository';

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
      slug: 'forum-scan-dao',
      name: 'Forum Scan DAO',
      primary_token_address: '0x' + 'a'.repeat(40),
      primary_chain_id: 1,
      description: 'f',
      website_url: 'https://f.example.com',
      forum_url: 'https://forum.f.example.com',
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
  over: { source_id: string; state: string },
): Promise<string> {
  const [row] = await trx
    .insertInto('proposal')
    .values({
      dao_id: daoId,
      source_type: 'compound_governor_bravo',
      source_id: over.source_id,
      proposer_actor_id: actorId,
      description: 'body',
      description_hash: 'a'.repeat(64),
      binding: true,
      state: over.state,
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

async function insertThread(
  trx: typeof pgDb,
  daoId: string,
  over: { topic: string; rawContent: string | null },
): Promise<string> {
  const [row] = await trx
    .insertInto('forum_thread')
    .values({
      dao_id: daoId,
      forum_host: 'forum.example.com',
      forum_topic_id: over.topic,
      title: `Thread ${over.topic}`,
      raw_content: over.rawContent,
      content_pipeline_version: 'turndown@1+rules-v1',
      post_count: 3,
      last_activity_at: new Date(),
    })
    .returning(['id'])
    .execute();
  return row!.id;
}

async function link(
  trx: typeof pgDb,
  proposalId: string,
  threadId: string,
  confidence: 'high' | 'medium' | 'low',
): Promise<void> {
  await trx
    .insertInto('proposal_forum_link')
    .values({
      proposal_id: proposalId,
      forum_thread_id: threadId,
      confidence,
      link_method: 'test',
    })
    .execute();
}

describeWithDb('ForumThreadReadRepository.findSynthesisCandidates (integration)', () => {
  it('returns only content-bearing threads linked high/medium to a pending/active proposal', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const active = await insertProposal(trx, daoId, actorId, {
        source_id: 'p-active',
        state: 'active',
      });
      const pending = await insertProposal(trx, daoId, actorId, {
        source_id: 'p-pending',
        state: 'pending',
      });
      const closed = await insertProposal(trx, daoId, actorId, {
        source_id: 'p-closed',
        state: 'executed',
      });

      // included
      const tHigh = await insertThread(trx, daoId, { topic: '1', rawContent: 'content' });
      await link(trx, active, tHigh, 'high');
      const tMediumPending = await insertThread(trx, daoId, { topic: '2', rawContent: 'content' });
      await link(trx, pending, tMediumPending, 'medium');

      // excluded — low confidence
      const tLow = await insertThread(trx, daoId, { topic: '3', rawContent: 'content' });
      await link(trx, active, tLow, 'low');
      // excluded — linked to a closed proposal
      const tClosed = await insertThread(trx, daoId, { topic: '4', rawContent: 'content' });
      await link(trx, closed, tClosed, 'high');
      // excluded — no raw_content
      const tEmpty = await insertThread(trx, daoId, { topic: '5', rawContent: null });
      await link(trx, active, tEmpty, 'high');
      // excluded — not linked at all
      await insertThread(trx, daoId, { topic: '6', rawContent: 'content' });

      const rows = await new ForumThreadReadRepository(trx).findSynthesisCandidates(
        ['pending', 'active'],
        50,
      );
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([tHigh, tMediumPending]));
    });
  });

  it('returns nothing for an empty state list', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const active = await insertProposal(trx, daoId, actorId, {
        source_id: 'p1',
        state: 'active',
      });
      const t = await insertThread(trx, daoId, { topic: '9', rawContent: 'content' });
      await link(trx, active, t, 'high');
      expect(await new ForumThreadReadRepository(trx).findSynthesisCandidates([], 50)).toEqual([]);
    });
  });
});

const CLOSED_STATES = [
  'succeeded',
  'defeated',
  'queued',
  'executed',
  'canceled',
  'expired',
  'vetoed',
] as never;

describeWithDb(
  'ForumThreadReadRepository.findRecentlyClosedSynthesisCandidates (integration)',
  () => {
    it('returns content-bearing threads linked high/medium to a proposal closed within the window', async () => {
      await inRollback(async (trx) => {
        const { daoId, actorId } = await seed(trx);
        const closed = await insertProposal(trx, daoId, actorId, {
          source_id: 'p-closed',
          state: 'executed',
        });
        const active = await insertProposal(trx, daoId, actorId, {
          source_id: 'p-active',
          state: 'active',
        });

        // included — linked high to a recently-closed proposal
        const tClosedHigh = await insertThread(trx, daoId, { topic: '1', rawContent: 'content' });
        await link(trx, closed, tClosedHigh, 'high');
        // excluded — still active (the voting-phase pass handles it, not the close pass)
        const tActive = await insertThread(trx, daoId, { topic: '2', rawContent: 'content' });
        await link(trx, active, tActive, 'high');
        // excluded — low confidence
        const tLow = await insertThread(trx, daoId, { topic: '3', rawContent: 'content' });
        await link(trx, closed, tLow, 'low');
        // excluded — no raw_content
        const tEmpty = await insertThread(trx, daoId, { topic: '4', rawContent: null });
        await link(trx, closed, tEmpty, 'high');

        const since = new Date(Date.now() - 60 * 60 * 1000); // 1h grace window
        const rows = await new ForumThreadReadRepository(trx).findRecentlyClosedSynthesisCandidates(
          CLOSED_STATES,
          since,
          50,
        );
        expect(new Set(rows.map((r) => r.id))).toEqual(new Set([tClosedHigh]));
      });
    });

    it('excludes proposals whose close predates the grace window', async () => {
      await inRollback(async (trx) => {
        const { daoId, actorId } = await seed(trx);
        const closed = await insertProposal(trx, daoId, actorId, {
          source_id: 'p-old',
          state: 'executed',
        });
        const t = await insertThread(trx, daoId, { topic: '5', rawContent: 'content' });
        await link(trx, closed, t, 'high');

        // `since` is after the proposal's state_updated_at (= now), so nothing qualifies.
        const since = new Date(Date.now() + 60 * 60 * 1000);
        const rows = await new ForumThreadReadRepository(trx).findRecentlyClosedSynthesisCandidates(
          CLOSED_STATES,
          since,
          50,
        );
        expect(rows).toEqual([]);
      });
    });
  },
);
