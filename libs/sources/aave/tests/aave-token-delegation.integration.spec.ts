import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  pgDb,
  ZERO_DELEGATE_ADDRESS,
} from '@libs/db';
import {
  AaveTokenArchivePayloadRepository,
  AaveTokenDelegationProjectionApplier,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const SOURCE_TYPE = 'aave_token';
const CHAIN_ID = '0x1';
const DELEGATOR = '0x' + 'ab'.repeat(20);
const DELEGATEE = '0x' + 'cd'.repeat(20);

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

describeIf('aave token delegation derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let daoSourceId = '';
  let daoId = '';

  async function cleanupCh(): Promise<void> {
    await sql`ALTER TABLE archive_event_aave_token DELETE WHERE dao_source_id = ${daoSourceId}`.execute(
      chDb,
    );
    await sql`ALTER TABLE delegation_flow_raw DELETE WHERE dao_id = ${daoId}`.execute(chDb);
    await sql`ALTER TABLE delegation_flow_agg DELETE WHERE dao_id = ${daoId}`.execute(chDb);
  }

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);

    await pgDb
      .insertInto('source_type')
      .values([{ value: SOURCE_TYPE }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-token-delegation-int-${Date.now()}`,
        name: 'Aave Token Delegation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: '0x1',
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = daoRow.id;

    const source = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: SOURCE_TYPE,
        chain_id: CHAIN_ID,
        source_config: { token_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await cleanupCh();
  });

  afterAll(async () => {
    await cleanupCh();
    await sql`TRUNCATE dao, archive_event, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
  }, 30_000);

  async function seedDelegateChanged(
    n: number,
    payload: { delegator: string; delegatee: string; delegationType: number },
  ): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_token')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: String(100 + n),
        block_hash: numberedHash(1000 + n),
        tx_hash: numberedHash(n),
        log_index: 0,
        event_type: 'DelegateChanged',
        payload: JSON.stringify(payload),
      } as Parameters<ReturnType<typeof chDb.insertInto<'archive_event_aave_token'>>['values']>[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: String(100 + n),
        block_hash: numberedHash(1000 + n),
        tx_hash: numberedHash(n),
        log_index: 0,
        event_type: 'DelegateChanged',
        received_at: new Date(),
        derivation_actor_resolved_at: new Date(),
        derived_at: null,
      })
      .execute();
  }

  async function runDerivation(): Promise<void> {
    const applier = new AaveTokenDelegationProjectionApplier({
      pgDb,
      chDb,
      archive,
      dlq: new DlqRepository(pgDb),
      payloads: new AaveTokenArchivePayloadRepository(chDb),
      metrics: {
        batchLookupSeconds: () => undefined,
        chWriteSeconds: () => undefined,
        processed: () => undefined,
      },
    });
    await applier.applyBatch(await archive.findUnderived(['DelegateChanged'], 50));
  }

  async function delegationRows(): Promise<
    Array<{
      delegator_address: string;
      delegate_address: string;
      voting_power: string;
      event_type: string;
    }>
  > {
    return chDb
      .selectFrom('delegation_flow_projection')
      .select(['delegator_address', 'delegate_address', 'voting_power', 'event_type'])
      .where('dao_id', '=', daoId)
      .execute() as never;
  }

  it('projects a VOTING DelegateChanged into a delegate_changed relationship row', async () => {
    await seedDelegateChanged(1, { delegator: DELEGATOR, delegatee: DELEGATEE, delegationType: 0 });
    await runDerivation();

    const rows = await delegationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      delegator_address: DELEGATOR,
      delegate_address: DELEGATEE,
      voting_power: '0',
      event_type: 'delegate_changed',
    });
  }, 30_000);

  it('does not project a PROPOSITION DelegateChanged (no-op derive)', async () => {
    await seedDelegateChanged(2, { delegator: DELEGATOR, delegatee: DELEGATEE, delegationType: 1 });
    await runDerivation();

    expect(await delegationRows()).toHaveLength(0);
    // The archive row is still marked derived (not stuck): no DLQ entry.
    const dlq = await pgDb
      .selectFrom('ingestion_dlq')
      .select(({ fn }) => [fn.countAll<string>().as('c')])
      .executeTakeFirstOrThrow();
    expect(dlq.c).toBe('0');
  }, 30_000);

  it('maps an address(0) delegatee (undelegation) to the null-delegate sentinel', async () => {
    await seedDelegateChanged(3, {
      delegator: DELEGATOR,
      delegatee: ZERO_DELEGATE_ADDRESS,
      delegationType: 0,
    });
    await runDerivation();

    const rows = await delegationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.delegate_address).toBe(ZERO_DELEGATE_ADDRESS);
  }, 30_000);
});
