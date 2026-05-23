import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ArchiveDerivationRepository, chDb, DlqRepository, pgDb } from '@libs/db';
import { CompTokenDelegationProjectionApplier } from '../src/comp-token/domain/comp-token-delegation-projection-applier';
import { CompTokenArchivePayloadRepository } from '../src/comp-token/persistence/comp-token-archive-payload-repository';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x7a69';
const SOURCE_TYPE = 'compound_comp_token';
const EVENT_TYPES = ['DelegateChanged', 'DelegateVotesChanged'] as const;

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

describeIf('comp token delegation derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let applier: CompTokenDelegationProjectionApplier;
  let daoId = '';
  let daoSourceId = '';
  let delegatorActorId = '';
  let delegateActorId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);

    await pgDb
      .insertInto('source_type')
      .values({ value: SOURCE_TYPE })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `compound-delegation-derivation-int-${Date.now()}`,
        name: 'Compound Delegation Derivation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = daoRow.id;

    const sourceRow = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: SOURCE_TYPE,
        source_config: { token_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = sourceRow.id;

    const delegatorActor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + 'aa'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    delegatorActorId = delegatorActor.id;

    const delegateActor = await pgDb
      .insertInto('actor')
      .values({ primary_address: '0x' + 'ab'.repeat(20), updated_at: new Date() })
      .returning('id')
      .executeTakeFirstOrThrow();
    delegateActorId = delegateActor.id;

    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: delegatorActorId,
        address: '0x' + 'aa'.repeat(20),
        is_primary: true,
        source: 'delegator_event',
      })
      .execute();
    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: delegateActorId,
        address: '0x' + 'ab'.repeat(20),
        is_primary: true,
        source: 'delegate_event',
      })
      .execute();

    applier = new CompTokenDelegationProjectionApplier({
      pgDb,
      chDb,
      archive,
      dlq: new DlqRepository(pgDb),
      payloads: new CompTokenArchivePayloadRepository(chDb),
      metrics: { batchLookupSeconds: () => undefined, processed: () => undefined },
    });
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_confirmation, actor, delegation, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE event_archive_compound_comp_token DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_confirmation, delegation, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE event_archive_compound_comp_token DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function seedConfirmedCompEvent(opts: {
    txN: number;
    eventType: 'DelegateChanged' | 'DelegateVotesChanged';
    payload: Record<string, string>;
  }): Promise<void> {
    const txHash = numberedHash(opts.txN);
    const blockHash = numberedHash(9_000 + opts.txN);
    const logIndex = opts.txN;
    const blockNumber = (1_000_000n + BigInt(opts.txN)).toString();

    await chDb
      .insertInto('event_archive_compound_comp_token')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: blockNumber,
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: logIndex,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'event_archive_compound_comp_token'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_confirmation')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: blockNumber,
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: logIndex,
        event_type: opts.eventType,
        received_at: new Date(),
        confirmation_status: 'confirmed',
        confirmed_at: new Date(),
        orphaned_at: null,
        orphaned_by_reorg_event_id: null,
        derivation_actor_resolved_at: new Date(),
        derived_at: null,
      })
      .execute();
  }

  it('projects confirmed DelegateChanged + DelegateVotesChanged rows and marks derived', async () => {
    await seedConfirmedCompEvent({
      txN: 1,
      eventType: 'DelegateChanged',
      payload: {
        delegator: '0x' + 'aa'.repeat(20),
        fromDelegate: '0x' + 'cc'.repeat(20),
        toDelegate: '0x' + 'ab'.repeat(20),
      },
    });
    await seedConfirmedCompEvent({
      txN: 2,
      eventType: 'DelegateVotesChanged',
      payload: {
        delegate: '0x' + 'ab'.repeat(20),
        previousVotes: '10',
        newVotes: '25',
      },
    });

    await applier.applyBatch(await archive.findConfirmedUndderived(EVENT_TYPES, 50));

    const rows = await pgDb
      .selectFrom('delegation')
      .selectAll()
      .orderBy('block_number', 'asc')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      dao_id: daoId,
      delegator_actor_id: delegatorActorId,
      delegate_actor_id: delegateActorId,
      voting_power: '0',
      event_type: 'delegate_changed',
    });
    expect(rows[1]).toMatchObject({
      dao_id: daoId,
      delegator_actor_id: delegateActorId,
      delegate_actor_id: delegateActorId,
      voting_power: '25',
      event_type: 'votes_changed',
    });

    const pendingRows = await archive.findConfirmedUndderived(EVENT_TYPES, 50);
    expect(pendingRows).toHaveLength(0);
  }, 30_000);

  it('routes no_delegator failure to delegation_projection_stage at threshold', async () => {
    await seedConfirmedCompEvent({
      txN: 3,
      eventType: 'DelegateChanged',
      payload: {
        delegator: '0x' + '99'.repeat(20),
        fromDelegate: '0x' + 'cc'.repeat(20),
        toDelegate: '0x' + 'ab'.repeat(20),
      },
    });
    await pgDb
      .updateTable('archive_confirmation')
      .set({ derivation_attempt_count: 4 })
      .where('tx_hash', '=', numberedHash(3))
      .execute();

    await applier.applyBatch(await archive.findConfirmedUndderived(EVENT_TYPES, 50));

    const dlqRows = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('archive_tx_hash', '=', numberedHash(3))
      .execute();
    expect(dlqRows.length).toBeGreaterThanOrEqual(1);
    expect(dlqRows[0]!.stage).toBe('delegation_projection_stage');
  }, 30_000);
});
