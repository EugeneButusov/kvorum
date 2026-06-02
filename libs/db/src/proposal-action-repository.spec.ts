import { sql } from 'kysely';
import { pgDb } from './client';
import { ProposalActionRepository } from './proposal-action-repository';

// These tests require a running Postgres instance. They are skipped when
// DATABASE_URL is not set so the suite passes in pure typecheck CI steps.
const describeWithDb = process.env['DATABASE_URL'] != null ? describe : describe.skip;

class RollbackSignal extends Error {}

let uniqueSeq = 0;
function uniqueHexId(): string {
  uniqueSeq += 1;
  const n = (BigInt(Date.now()) << 20n) + BigInt(uniqueSeq);
  return n.toString(16);
}

function uniqueAddress(): string {
  return `0x${uniqueHexId().padStart(40, '0').slice(-40)}`;
}

// ── Test-data helpers ─────────────────────────────────────────────────────────

/**
 * Insert the minimal chain (dao → actor → proposal) needed to satisfy FKs,
 * then return the proposal id. Must be called inside a transaction.
 */
async function insertMinimalProposal(trx: typeof pgDb): Promise<string> {
  const [dao] = await trx
    .insertInto('dao')
    .values({
      slug: `repo-spec-dao-${Date.now()}`,
      name: 'Repo Spec DAO',
      primary_token_address: uniqueAddress(),
      primary_chain_id: '1',
      description: 'test',
      website_url: 'https://example.com',
      forum_url: 'https://example.com',
      updated_at: new Date(),
    })
    .returning(['id'])
    .execute();

  const [actor] = await trx
    .insertInto('actor')
    .values({ primary_address: uniqueAddress(), updated_at: new Date() })
    .returning(['id'])
    .execute();

  const now = new Date();
  const [proposal] = await trx
    .insertInto('proposal')
    .values({
      dao_id: dao!.id,
      source_type: 'compound_governor_bravo',
      source_id: `spec-${uniqueHexId()}`,
      proposer_actor_id: actor!.id,
      description: 'test proposal',
      description_hash: 'a'.repeat(64),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '1000',
      voting_ends_block: '2000',
      voting_power_block: '1000',
      state: 'active',
      state_updated_at: now,
      updated_at: now,
    })
    .returning(['id'])
    .execute();

  return proposal!.id;
}

/** Insert a pending proposal_action row and return its id. */
async function insertPendingAction(
  trx: typeof pgDb,
  proposalId: string,
  overrides: {
    action_index?: number;
    calldata?: string;
    function_signature?: string | null;
    next_decode_at?: Date | null;
    decode_attempt_count?: number;
  } = {},
): Promise<string> {
  const [row] = await trx
    .insertInto('proposal_action')
    .values({
      proposal_id: proposalId,
      action_index: overrides.action_index ?? 0,
      target_address: '0x' + 'c'.repeat(40),
      target_chain_id: '1',
      value_wei: '0',
      calldata: overrides.calldata ?? '0xa9059cbb',
      function_signature: overrides.function_signature ?? null,
      next_decode_at: overrides.next_decode_at ?? null,
      decode_attempt_count: overrides.decode_attempt_count ?? 0,
    })
    .returning(['id'])
    .execute();
  return row!.id;
}

afterAll(async () => {
  await pgDb.destroy();
});

// ── Suites ────────────────────────────────────────────────────────────────────

describeWithDb('ProposalActionRepository — filter', () => {
  it('findPendingDecodeForUpdate returns only pending rows with eligible next_decode_at', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        const repo = new ProposalActionRepository(trx as never);

        const pendingId = await insertPendingAction(trx, proposalId, { next_decode_at: null });

        // future next_decode_at — not yet eligible
        const futureAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await insertPendingAction(trx, proposalId, { action_index: 1, next_decode_at: futureAt });

        // decoded — must be excluded
        const [decoded] = await trx
          .insertInto('proposal_action')
          .values({
            proposal_id: proposalId,
            action_index: 2,
            target_address: '0x' + 'd'.repeat(40),
            target_chain_id: '1',
            value_wei: '0',
            calldata: '0x',
            decode_status: 'decoded',
          })
          .returning(['id'])
          .execute();

        const rows = await repo.findPendingDecodeForUpdate(trx, 10);

        expect(rows.map((r) => r.id)).toContain(pendingId);
        expect(rows.map((r) => r.id)).not.toContain(decoded!.id);
        // The future-scheduled row is also excluded
        expect(rows).toHaveLength(1);
        expect(rows[0]?.source_type).toBe('compound_governor_bravo');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithDb('ProposalActionRepository — markDecoded', () => {
  it('sets decoded_function, decoded_arguments, decode_status=decoded, and decode_attempted_at', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        const actionId = await insertPendingAction(trx, proposalId);
        const repo = new ProposalActionRepository(trx as never);

        await repo.markDecoded(trx, actionId, {
          function: 'transfer(address,uint256)',
          arguments: { to: '0xabc', amount: '1000' },
        });

        const row = await trx
          .selectFrom('proposal_action')
          .select(['decoded_function', 'decode_status', 'decode_attempted_at'])
          .where('id', '=', actionId)
          .executeTakeFirstOrThrow();

        expect(row.decoded_function).toBe('transfer(address,uint256)');
        expect(row.decode_status).toBe('decoded');
        expect(row.decode_attempted_at).not.toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithDb('ProposalActionRepository — markUndecodable', () => {
  it('increments decode_attempt_count and sets next_decode_at', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        const actionId = await insertPendingAction(trx, proposalId);
        const repo = new ProposalActionRepository(trx as never);

        const retryAt = new Date(Date.now() + 20 * 60 * 60 * 1000);
        await repo.markUndecodable(trx, actionId, { retryAt });

        const row = await trx
          .selectFrom('proposal_action')
          .select(['decode_attempt_count', 'next_decode_at', 'decode_status'])
          .where('id', '=', actionId)
          .executeTakeFirstOrThrow();

        expect(row.decode_attempt_count).toBe(1);
        expect(row.decode_status).toBe('pending');
        expect(row.next_decode_at).not.toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('flips to undecodable and clears next_decode_at at attempt 10 (R9)', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        // Set count to 9 so the next markUndecodable pushes it to 10
        const actionId = await insertPendingAction(trx, proposalId, { decode_attempt_count: 9 });
        const repo = new ProposalActionRepository(trx as never);

        await repo.markUndecodable(trx, actionId, { retryAt: new Date(Date.now() + 86400000) });

        const row = await trx
          .selectFrom('proposal_action')
          .select(['decode_attempt_count', 'next_decode_at', 'decode_status'])
          .where('id', '=', actionId)
          .executeTakeFirstOrThrow();

        expect(row.decode_attempt_count).toBe(10);
        expect(row.decode_status).toBe('undecodable');
        expect(row.next_decode_at).toBeNull();

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('COALESCE: functionSignatureGuess does not overwrite an existing non-NULL function_signature', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        const actionId = await insertPendingAction(trx, proposalId, {
          function_signature: '_setPendingAdmin(address)',
        });
        const repo = new ProposalActionRepository(trx as never);

        // Caller passes a different guess — must not overwrite the original
        await repo.markUndecodable(trx, actionId, {
          retryAt: new Date(Date.now() + 86400000),
          functionSignatureGuess: 'someOtherFn()',
        });

        const row = await trx
          .selectFrom('proposal_action')
          .select(['function_signature'])
          .where('id', '=', actionId)
          .executeTakeFirstOrThrow();

        expect(row.function_signature).toBe('_setPendingAdmin(address)');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });

  it('COALESCE: functionSignatureGuess is written when function_signature was NULL', async () => {
    await expect(
      pgDb.transaction().execute(async (trx) => {
        const proposalId = await insertMinimalProposal(trx);
        const actionId = await insertPendingAction(trx, proposalId, { function_signature: null });
        const repo = new ProposalActionRepository(trx as never);

        await repo.markUndecodable(trx, actionId, {
          retryAt: new Date(Date.now() + 86400000),
          functionSignatureGuess: 'guessedFn(address)',
        });

        const row = await trx
          .selectFrom('proposal_action')
          .select(['function_signature'])
          .where('id', '=', actionId)
          .executeTakeFirstOrThrow();

        expect(row.function_signature).toBe('guessedFn(address)');

        throw new RollbackSignal();
      }),
    ).rejects.toThrow(RollbackSignal);
  });
});

describeWithDb('ProposalActionRepository — SKIP LOCKED (R2)', () => {
  // This test verifies the concurrent-transaction locking behaviour. T1 holds a
  // row lock; T2 must skip the locked row rather than blocking.
  it('second transaction gets 0 rows while first holds the lock', async () => {
    // Insert fixture data outside any transaction so it persists across connections.
    const proposalId = await pgDb.transaction().execute(insertMinimalProposal);
    const actionId = await pgDb
      .transaction()
      .execute((trx) => insertPendingAction(trx, proposalId));

    const repo = new ProposalActionRepository(pgDb);

    let releaseT1!: () => void;
    let t1Locked!: () => void;

    const releaseSignal = new Promise<void>((res) => {
      releaseT1 = res;
    });
    const lockedSignal = new Promise<void>((res) => {
      t1Locked = res;
    });

    // T1: acquire the lock and hold it until we signal release.
    const t1Done = pgDb.transaction().execute(async (trx1) => {
      const rows = await repo.findPendingDecodeForUpdate(trx1, 10);
      expect(rows.some((r) => r.id === actionId)).toBe(true);
      t1Locked(); // lock acquired
      await releaseSignal;
      throw new RollbackSignal(); // rollback so the row stays pending
    });

    await lockedSignal; // wait until T1 has the lock

    // T2: must not see the locked row.
    const t2Rows = await pgDb
      .transaction()
      .execute((trx2) => repo.findPendingDecodeForUpdate(trx2, 10));
    expect(t2Rows.every((r) => r.id !== actionId)).toBe(true);

    // Release T1 and clean up.
    releaseT1();
    await expect(t1Done).rejects.toThrow(RollbackSignal);

    // Cleanup fixture rows.
    await pgDb.deleteFrom('proposal_action').where('proposal_id', '=', proposalId).execute();
    await sql`
      DELETE FROM proposal WHERE id = ${proposalId}
    `.execute(pgDb);
    // dao + actor rows are left behind — they don't affect other tests.
  });
});
