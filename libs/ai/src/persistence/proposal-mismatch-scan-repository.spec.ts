import { afterAll, describe, expect, it } from 'vitest';
import { pgDb } from '@libs/db';
import { ProposalMismatchScanRepository } from './proposal-mismatch-scan-repository.js';

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
      slug: 'mismatch-dao',
      name: 'Mismatch DAO',
      primary_token_address: '0x' + 'a'.repeat(40),
      primary_chain_id: 1,
      description: 'm',
      website_url: 'https://m.example.com',
      forum_url: 'https://forum.m.example.com',
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
  base: Record<string, unknown>,
  over: { source_id: string; binding: boolean; state: string; stateAt: string },
): Promise<string> {
  const [row] = await trx
    .insertInto('proposal')
    .values({
      ...base,
      source_id: over.source_id,
      binding: over.binding,
      state: over.state,
      state_updated_at: new Date(over.stateAt),
      updated_at: new Date(),
    } as never)
    .returning(['id'])
    .execute();
  return row!.id as string;
}

async function addAction(
  trx: typeof pgDb,
  proposalId: string,
  index: number,
  decodeStatus: 'pending' | 'decoded' | 'undecodable',
): Promise<void> {
  await trx
    .insertInto('proposal_action')
    .values({
      proposal_id: proposalId,
      action_index: index,
      target_address: '0x' + 'b'.repeat(40),
      target_chain_id: '1',
      value_wei: '0',
      function_signature: 'setReserveFactor(uint256)',
      calldata: '0xdead',
      decoded_function: decodeStatus === 'decoded' ? 'setReserveFactor' : null,
      decoded_arguments: decodeStatus === 'decoded' ? { value: '1' } : null,
      decode_status: decodeStatus,
    })
    .execute();
}

describeWithDb('ProposalMismatchScanRepository.findCandidates (integration)', () => {
  it('returns only binding proposals whose actions are ALL decoded, in states, ordered', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const base = {
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        proposer_actor_id: actorId,
        description: 'body',
        description_hash: 'a'.repeat(64),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
      };

      // included — binding, active, every action decoded
      const pOk1 = await insertProposal(trx, base, {
        source_id: 'p-ok1',
        binding: true,
        state: 'active',
        stateAt: '2026-01-01T00:00:00Z',
      });
      await addAction(trx, pOk1, 0, 'decoded');
      await addAction(trx, pOk1, 1, 'decoded');
      const pOk2 = await insertProposal(trx, base, {
        source_id: 'p-ok2',
        binding: true,
        state: 'active',
        stateAt: '2026-01-02T00:00:00Z',
      });
      await addAction(trx, pOk2, 0, 'decoded');

      // excluded — has a pending action
      const pPending = await insertProposal(trx, base, {
        source_id: 'p-pending',
        binding: true,
        state: 'active',
        stateAt: '2026-01-03T00:00:00Z',
      });
      await addAction(trx, pPending, 0, 'decoded');
      await addAction(trx, pPending, 1, 'pending');

      // excluded — has an undecodable action (strict "all decoded")
      const pUndec = await insertProposal(trx, base, {
        source_id: 'p-undecodable',
        binding: true,
        state: 'active',
        stateAt: '2026-01-04T00:00:00Z',
      });
      await addAction(trx, pUndec, 0, 'undecodable');

      // excluded — non-binding
      const pNonBinding = await insertProposal(trx, base, {
        source_id: 'p-nonbinding',
        binding: false,
        state: 'active',
        stateAt: '2026-01-05T00:00:00Z',
      });
      await addAction(trx, pNonBinding, 0, 'decoded');

      // excluded — wrong state
      const pWrong = await insertProposal(trx, base, {
        source_id: 'p-executed',
        binding: true,
        state: 'executed',
        stateAt: '2026-01-06T00:00:00Z',
      });
      await addAction(trx, pWrong, 0, 'decoded');

      // excluded — no actions at all (nothing to compare against)
      await insertProposal(trx, base, {
        source_id: 'p-noactions',
        binding: true,
        state: 'active',
        stateAt: '2026-01-07T00:00:00Z',
      });

      const rows = await new ProposalMismatchScanRepository(trx).findCandidates(['active'], 10);
      const sourceIds = rows.map((r) => r.source_id).filter((id) => id.startsWith('p-'));
      expect(sourceIds).toEqual(['p-ok1', 'p-ok2']);
    });
  });

  it('returns [] for an empty states array', async () => {
    await inRollback(async (trx) => {
      const rows = await new ProposalMismatchScanRepository(trx).findCandidates([], 10);
      expect(rows).toEqual([]);
    });
  });
});

describeWithDb('ProposalMismatchScanRepository.findAllForBackfill (integration)', () => {
  async function drainAll(
    repo: ProposalMismatchScanRepository,
    pageSize: number,
    daoSlugs?: string[],
  ): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await repo.findAllForBackfill(cursor, pageSize, daoSlugs);
      if (page.length === 0) break;
      ids.push(...page.map((r) => r.id));
      cursor = page[page.length - 1]!.id;
    }
    return ids;
  }

  it('covers binding+all-decoded proposals in EVERY state (incl. terminal), keyset-paginated', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const base = {
        dao_id: daoId,
        source_type: 'compound_governor_bravo',
        proposer_actor_id: actorId,
        description: 'body',
        description_hash: 'a'.repeat(64),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
      };
      const mk = async (source_id: string, state: string, binding: boolean) => {
        const id = await insertProposal(trx, base, {
          source_id,
          binding,
          state,
          stateAt: '2026-01-01T00:00:00Z',
        });
        return id;
      };
      // included — binding, all-decoded, across active AND terminal states (the windowed scan misses these)
      const active = await mk('bf-active', 'active', true);
      await addAction(trx, active, 0, 'decoded');
      const executed = await mk('bf-executed', 'executed', true);
      await addAction(trx, executed, 0, 'decoded');
      const defeated = await mk('bf-defeated', 'defeated', true);
      await addAction(trx, defeated, 0, 'decoded');
      // excluded — pending action / undecodable / non-binding / no actions
      const pending = await mk('bf-pending', 'executed', true);
      await addAction(trx, pending, 0, 'pending');
      const undec = await mk('bf-undec', 'executed', true);
      await addAction(trx, undec, 0, 'undecodable');
      const nonbinding = await mk('bf-nonbinding', 'executed', false);
      await addAction(trx, nonbinding, 0, 'decoded');
      await mk('bf-noactions', 'executed', true);

      const repo = new ProposalMismatchScanRepository(trx);
      const ids = await drainAll(repo, 2); // pageSize 2 forces multiple pages
      expect(new Set(ids)).toEqual(new Set([active, executed, defeated]));
      expect(ids.length).toBe(new Set(ids).size); // no overlap across pages
    });
  });

  it('scopes to daoSlugs when provided', async () => {
    await inRollback(async (trx) => {
      const { daoId, actorId } = await seed(trx);
      const [other] = await trx
        .insertInto('dao')
        .values({
          slug: 'other-dao',
          name: 'Other',
          primary_token_address: '0x' + 'c'.repeat(40),
          primary_chain_id: 1,
          description: 'o',
          website_url: 'https://o.example.com',
          forum_url: 'https://forum.o.example.com',
          updated_at: new Date(),
        })
        .returning(['id'])
        .execute();
      const base = (dao_id: string) => ({
        dao_id,
        source_type: 'compound_governor_bravo',
        proposer_actor_id: actorId,
        description: 'body',
        description_hash: 'a'.repeat(64),
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '1',
        voting_ends_block: '2',
      });
      const inScope = await insertProposal(trx, base(daoId), {
        source_id: 'in-scope',
        binding: true,
        state: 'executed',
        stateAt: '2026-01-01T00:00:00Z',
      });
      await addAction(trx, inScope, 0, 'decoded');
      const outScope = await insertProposal(trx, base(other!.id), {
        source_id: 'out-scope',
        binding: true,
        state: 'executed',
        stateAt: '2026-01-01T00:00:00Z',
      });
      await addAction(trx, outScope, 0, 'decoded');

      const repo = new ProposalMismatchScanRepository(trx);
      const ids = await repo.findAllForBackfill(null, 100, ['mismatch-dao']);
      expect(ids.map((r) => r.id)).toEqual([inScope]);
    });
  });
});
