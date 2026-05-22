import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArchiveDerivationRepository, chDb, pgDb } from '@libs/db';
import { GovernorArchivePayloadRepository, GovernorProjectionApplier } from '@sources/compound';

const DB_URL = process.env['DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

const CHAIN_ID = '0x7a69';
const PROPOSER = '0x' + 'aa'.repeat(20);

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

describeIf('compound governor derivation', () => {
  let applier: GovernorProjectionApplier;
  let archive: ArchiveDerivationRepository;
  let daoSourceId: string;

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    applier = new GovernorProjectionApplier({
      pgDb,
      chDb,
      archive,
      payloads: new GovernorArchivePayloadRepository(chDb),
      metrics: { batchLookupSeconds: () => {}, processed: () => {} },
    });

    await pgDb
      .insertInto('source_type')
      .values({ value: 'compound_governor_bravo' })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: 'compound-derivation-test',
        name: 'Compound Derivation Test',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const srcRow = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoRow.id,
        source_type: 'compound_governor_bravo',
        source_config: { governor_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    daoSourceId = srcRow.id;
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_confirmation, proposal, actor RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE event_archive_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_confirmation, proposal, actor RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE event_archive_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function insertConfirmedEvent(opts: {
    eventType: 'ProposalCreated' | 'ProposalQueued' | 'ProposalExecuted' | 'ProposalCanceled';
    blockNumber: bigint;
    txHash: string;
    blockHash: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await chDb
      .insertInto('event_archive_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'event_archive_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_confirmation')
      .values({
        source_type: 'compound_governor_bravo',
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: 0,
        event_type: opts.eventType,
        received_at: new Date(),
        confirmation_status: 'confirmed',
        confirmed_at: new Date(),
        orphaned_at: null,
        orphaned_by_reorg_event_id: null,
        derived_at: null,
      })
      .execute();
  }

  it('SPEC §3.4 #5 — re-running derivation produces same final state (idempotency)', async () => {
    await insertConfirmedEvent({
      eventType: 'ProposalCreated',
      blockNumber: 1_000_000n,
      txHash: numberedHash(1),
      blockHash: numberedHash(101),
      payload: {
        proposalId: '1',
        proposer: PROPOSER,
        targets: ['0x0000000000000000000000000000000000000002'],
        values: ['0'],
        signatures: [''],
        calldatas: ['0x'],
        startBlock: '100',
        endBlock: '200',
        description: '',
      },
    });

    const rows1 = await archive.findConfirmedUndderived(10);
    await applier.applyBatch(rows1);

    const proposals = await pgDb.selectFrom('proposal').selectAll().execute();
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0]!;
    expect(proposal.source_type).toBe('compound_governor_bravo');
    expect(proposal.source_id).toBe('1');
    expect(proposal.voting_power_block).toBe('100');
    expect(proposal.voting_starts_block).toBe('100');
    expect(proposal.voting_ends_block).toBe('200');
    expect(proposal.state).toBe('pending');

    const actions = await pgDb
      .selectFrom('proposal_action')
      .selectAll()
      .orderBy('action_index', 'asc')
      .execute();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      action_index: 0,
      target_address: '0x0000000000000000000000000000000000000002',
      target_chain_id: CHAIN_ID,
      value_wei: '0',
      function_signature: '',
      calldata: '0x',
    });

    const choices = await pgDb
      .selectFrom('proposal_choice')
      .selectAll()
      .orderBy('choice_index', 'asc')
      .execute();
    expect(choices).toHaveLength(3);
    expect(choices[0]).toMatchObject({ choice_index: 0, value: 'Against' });
    expect(choices[1]).toMatchObject({ choice_index: 1, value: 'For' });
    expect(choices[2]).toMatchObject({ choice_index: 2, value: 'Abstain' });

    // Idempotency: reset derived_at and re-run — same snapshot
    await pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: null })
      .where('tx_hash', '=', numberedHash(1))
      .execute();

    const rows2 = await archive.findConfirmedUndderived(10);
    await applier.applyBatch(rows2);

    const proposalsAfterReplay = await pgDb.selectFrom('proposal').selectAll().execute();
    expect(proposalsAfterReplay).toHaveLength(1);
    expect(proposalsAfterReplay[0]!.id).toBe(proposal.id);
    expect(await pgDb.selectFrom('proposal_action').selectAll().execute()).toHaveLength(1);
    expect(await pgDb.selectFrom('proposal_choice').selectAll().execute()).toHaveLength(3);

    // Late ProposalExecuted
    await insertConfirmedEvent({
      eventType: 'ProposalExecuted',
      blockNumber: 9_000_001n,
      txHash: numberedHash(2),
      blockHash: numberedHash(102),
      payload: { proposalId: '1' },
    });

    await applier.applyBatch(await archive.findConfirmedUndderived(10));

    const executed = await pgDb.selectFrom('proposal').selectAll().executeTakeFirst();
    expect(executed!.state).toBe('executed');

    // State guard: late ProposalQueued after executed — state must stay 'executed'
    await insertConfirmedEvent({
      eventType: 'ProposalQueued',
      blockNumber: 9_000_002n,
      txHash: numberedHash(3),
      blockHash: numberedHash(103),
      payload: { proposalId: '1', eta: '123' },
    });

    await applier.applyBatch(await archive.findConfirmedUndderived(10));

    const afterLateQueued = await pgDb.selectFrom('proposal').selectAll().executeTakeFirst();
    expect(afterLateQueued!.state).toBe('executed');
    expect(await pgDb.selectFrom('proposal_action').selectAll().execute()).toHaveLength(1);
    expect(await pgDb.selectFrom('proposal_choice').selectAll().execute()).toHaveLength(3);
  }, 30_000);
});
