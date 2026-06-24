import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import { chDb, ArchiveEventRepository, DlqRepository, pgDb } from '@libs/db';
import {
  DualGovernanceEventRepository,
  LidoDualGovernanceArchiveWriter,
  makeDualGovernanceIngesterListener,
  DUAL_GOVERNANCE_INTERFACE,
  TIMELOCK_INTERFACE,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const DG_ADDRESS = '0xc1db28b3301331277e307fdcff8de28242a4486e';
const TIMELOCK_ADDRESS = '0xce0425301c85c5ea2a0873a2dee44d78e02d2316';
const A1 = '0x1111111111111111111111111111111111111111';
const A2 = '0x2222222222222222222222222222222222222222';
const ZERO = '0x' + '00'.repeat(20);

function dgLog(eventName: string, args: unknown[]) {
  const fragment = DUAL_GOVERNANCE_INTERFACE.getEvent(eventName)!;
  const encoded = DUAL_GOVERNANCE_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}
function tlLog(eventName: string, args: unknown[]) {
  const fragment = TIMELOCK_INTERFACE.getEvent(eventName)!;
  const encoded = TIMELOCK_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}

describeIf('Lido Dual Governance ingestion integration', () => {
  let daoSourceId = '';
  let listener: ReturnType<typeof makeDualGovernanceIngesterListener>;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'dual_governance' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-dg-int-${Date.now()}`,
        name: 'Lido DG Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido Dual Governance ingestion integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const source = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: dao.id,
        source_type: 'dual_governance',
        chain_id: CHAIN_ID,
        source_config: { dual_governance_address: DG_ADDRESS, timelock_address: TIMELOCK_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    const archiveWriter = new LidoDualGovernanceArchiveWriter({
      eventRepo: new DualGovernanceEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });

    listener = makeDualGovernanceIngesterListener({
      archiveWriter,
      context: {
        daoSourceId,
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        sourceLabel: 'dual_governance',
      },
      logger: silentLogger,
      dlqRepo: new DlqRepository(pgDb),
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq RESTART IDENTITY CASCADE`.execute(pgDb);
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  // The two same-named ProposalSubmitted events (DG metadata + Timelock calls) co-fire in a real
  // submission tx and must archive as two distinct rows keyed by their own topic0.
  it('archives both ProposalSubmitted variants distinctly in one tx', async () => {
    const meta = dgLog('ProposalSubmitted', [A1, 7n, 'Upgrade staking router']);
    const calls = [[A2, 0n, '0xdeadbeef']];
    const timelock = tlLog('ProposalSubmitted', [7n, A1, calls]);
    const txHash = '0x' + '1a'.repeat(32);

    await listener([
      {
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        blockNumber: 23_095_800n,
        blockHash: '0x' + 'b1'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: DG_ADDRESS,
        topics: meta.topics,
        data: meta.data,
      },
      {
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        blockNumber: 23_095_800n,
        blockHash: '0x' + 'b1'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 1,
        address: TIMELOCK_ADDRESS,
        topics: timelock.topics,
        data: timelock.data,
      },
    ]);

    const pgRows = await pgDb
      .selectFrom('archive_event')
      .select(['event_type', 'log_index'])
      .where('source_type', '=', 'dual_governance')
      .where('tx_hash', '=', txHash)
      .orderBy('log_index')
      .execute();
    expect(pgRows.map((r) => r.event_type)).toEqual(['ProposalSubmittedMeta', 'ProposalSubmitted']);

    const chRows = await chDb
      .selectFrom('archive_event_dual_governance')
      .select(['event_type', 'log_index', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .orderBy('log_index')
      .execute();
    expect(chRows).toHaveLength(2);
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      proposerAccount: A1,
      proposalId: '7',
      metadata: 'Upgrade staking router',
    });
    expect(JSON.parse(chRows[1]!.payload)).toMatchObject({
      id: '7',
      executor: A1,
      calls: [{ target: A2, value: '0', payload: '0xdeadbeef' }],
    });
  }, 30_000);

  it('archives DualGovernanceStateChanged with State ordinals mapped to names', async () => {
    const context = [1, 1754648507, 0, A1, 0, 0, 0, ZERO, A2];
    const { topics, data } = dgLog('DualGovernanceStateChanged', [0, 1, context]);
    const txHash = '0x' + '2b'.repeat(32);

    await listener([
      {
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        blockNumber: 23_095_715n,
        blockHash: '0x' + 'c2'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: DG_ADDRESS,
        topics,
        data,
      },
    ]);

    const chRows = await chDb
      .selectFrom('archive_event_dual_governance')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();
    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.event_type).toBe('DualGovernanceStateChanged');
    expect(JSON.parse(chRows[0]!.payload)).toMatchObject({
      from: 'NotInitialized',
      to: 'Normal',
      context: { state: 'Normal', signallingEscrow: A1, configProvider: A2 },
    });
  }, 30_000);

  it('archives bulk-cancel ProposalsCancelledTill as a single boundary-carrying row', async () => {
    const { topics, data } = tlLog('ProposalsCancelledTill', [5n]);
    const txHash = '0x' + '3c'.repeat(32);

    await listener([
      {
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        blockNumber: 23_100_000n,
        blockHash: '0x' + 'd3'.repeat(32),
        txHash,
        txIndex: 0,
        logIndex: 0,
        address: TIMELOCK_ADDRESS,
        topics,
        data,
      },
    ]);

    const chRows = await chDb
      .selectFrom('archive_event_dual_governance')
      .select(['event_type', 'payload'])
      .where('chain_id', '=', CHAIN_ID)
      .where('tx_hash', '=', txHash)
      .execute();
    expect(chRows).toHaveLength(1);
    expect(chRows[0]?.event_type).toBe('ProposalsCancelledTill');
    // One row carrying the boundary id — the range is interpreted in derivation, not expanded here.
    expect(JSON.parse(chRows[0]!.payload)).toEqual({ proposalId: '5' });
  }, 30_000);
});
