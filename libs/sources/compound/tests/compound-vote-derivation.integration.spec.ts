import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ArchiveDerivationRepository,
  chDb,
  DlqRepository,
  pgDb,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import { GovernorArchivePayloadRepository, GovernorVoteProjectionApplier } from '@sources/compound';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const describeIf = DB_URL && CH_URL && ANVIL_URL ? describe : describe.skip;

const CHAIN_ID = '0x7a69';
const SOURCE_TYPE = 'compound_governor_bravo';
const EVENT_TYPE = 'VoteCast';

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

async function rpcSend<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ANVIL_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error !== undefined) {
    throw new Error(`rpc ${method} failed: ${json.error.message ?? 'unknown error'}`);
  }
  return json.result as T;
}

describeIf('compound vote derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let applier: GovernorVoteProjectionApplier;
  let daoId = '';
  let daoSourceId = '';
  let proposerActorId = '';
  let voterActorId = '';
  let anvilBlockNumber = '0';
  let anvilBlockTimestamp = new Date(0);

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
        slug: `compound-vote-derivation-int-${Date.now()}`,
        name: 'Compound Vote Derivation Integration',
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
        chain_id: CHAIN_ID,
        source_config: { governor_address: '0x' + '11'.repeat(20) },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = sourceRow.id;

    const proposerActor = await pgDb
      .insertInto('actor')
      .values({
        primary_address: '0x' + 'aa'.repeat(20),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    proposerActorId = proposerActor.id;

    const voterActor = await pgDb
      .insertInto('actor')
      .values({
        primary_address: '0x' + 'ab'.repeat(20),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    voterActorId = voterActor.id;

    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: proposerActorId,
        address: '0x' + 'aa'.repeat(20),
        is_primary: true,
        source: 'proposer_event',
      })
      .execute();
    await pgDb
      .insertInto('actor_address')
      .values({
        actor_id: voterActorId,
        address: '0x' + 'ab'.repeat(20),
        is_primary: true,
        source: 'voter_event',
      })
      .execute();

    anvilBlockNumber = BigInt(await rpcSend<string>('eth_blockNumber', [])).toString();
    const anvilBlock = await rpcSend<{ timestamp: string }>('eth_getBlockByNumber', [
      `0x${BigInt(anvilBlockNumber).toString(16)}`,
      false,
    ]);
    anvilBlockTimestamp = new Date(Number(BigInt(anvilBlock.timestamp)) * 1000);

    applier = new GovernorVoteProjectionApplier({
      archive,
      dlq: new DlqRepository(pgDb),
      payloads: new GovernorArchivePayloadRepository(chDb),
      proposals: new ProposalRepository(pgDb),
      voteRead: new VoteEventsProjectionReadRepository(chDb),
      voteWrite: new VoteEventsProjectionWriter(chDb),
      metrics: { batchLookupSeconds: () => undefined, processed: () => undefined },
      registry: {
        peek: (chainId: string) =>
          chainId === CHAIN_ID
            ? ({
                client: { send: rpcSend },
                chainCfg: { chainId: CHAIN_ID },
              } as never)
            : undefined,
      } as never,
    });
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_compound_governor_bravo DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function seedConfirmedVoteCast(opts?: { txN?: number; proposalId?: string }) {
    const txN = opts?.txN ?? 1;
    const txHash = numberedHash(txN);
    const blockHash = numberedHash(10_000 + txN);
    const logIndex = txN;
    const proposalId = opts?.proposalId ?? '42';

    await chDb
      .insertInto('archive_event_compound_governor_bravo')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: anvilBlockNumber,
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: logIndex,
        event_type: EVENT_TYPE,
        payload: JSON.stringify({
          voter: '0x' + 'ab'.repeat(20),
          proposalId,
          primaryChoice: 1,
          votingPowerReported: '123',
          compound: { supportRaw: true, reason: 'integration reason' },
        }),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_compound_governor_bravo'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: anvilBlockNumber,
        block_hash: blockHash,
        tx_hash: txHash,
        log_index: logIndex,
        event_type: EVENT_TYPE,
        received_at: new Date(),
        derivation_actor_resolved_at: new Date(),
        derived_at: null,
      })
      .execute();

    return { txHash };
  }

  it('projects confirmed VoteCast to vote_events_projection and is idempotent on replay', async () => {
    const proposal = await pgDb
      .insertInto('proposal')
      .values({
        dao_id: daoId,
        source_type: SOURCE_TYPE,
        source_id: '42',
        proposer_actor_id: proposerActorId,
        title: 'Test Proposal',
        description: 'desc',
        description_hash: 'a'.repeat(64),
        binding: true,
        voting_starts_at: null,
        voting_ends_at: null,
        voting_starts_block: '10',
        voting_ends_block: '20',
        voting_power_block: '10',
        state: 'pending',
        state_updated_at: new Date(),
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const { txHash } = await seedConfirmedVoteCast({ txN: 1, proposalId: '42' });
    const rows = await archive.findUnderived([EVENT_TYPE], 50);
    await applier.applyBatch(rows);

    const votes = await chDb
      .selectFrom('vote_events_projection')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .where('superseded', '=', 0)
      .execute();
    const confirmation = await pgDb
      .selectFrom('archive_event')
      .select('derived_at')
      .where('tx_hash', '=', txHash)
      .executeTakeFirstOrThrow();

    expect(votes).toHaveLength(1);
    expect(votes[0]!.proposal_id).toBe(proposal.id);
    expect(votes[0]!.voter_address).toBe('0x' + 'ab'.repeat(20));
    expect(votes[0]!.voting_chain_id).toBe(CHAIN_ID);
    expect(votes[0]!.voting_power).toBe('123');
    expect(votes[0]!.primary_choice).toBe(1);
    expect(votes[0]!.cast_at.getTime()).toBe(anvilBlockTimestamp.getTime());
    expect(confirmation.derived_at).not.toBeNull();

    await pgDb
      .updateTable('archive_event')
      .set({ derived_at: null })
      .where('tx_hash', '=', txHash)
      .execute();

    await applier.applyBatch(await archive.findUnderived([EVENT_TYPE], 50));

    expect(
      await chDb
        .selectFrom('vote_events_projection')
        .selectAll()
        .where('proposal_id', '=', proposal.id)
        .where('superseded', '=', 0)
        .execute(),
    ).toHaveLength(1);
  }, 30_000);

  it('routes no_proposal failure to vote_projection_stage at threshold', async () => {
    await seedConfirmedVoteCast({ txN: 2, proposalId: '404' });
    await pgDb
      .updateTable('archive_event')
      .set({ derivation_attempt_count: 4 })
      .where('tx_hash', '=', numberedHash(2))
      .execute();

    await applier.applyBatch(await archive.findUnderived([EVENT_TYPE], 50));

    const dlqRows = await pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('archive_tx_hash', '=', numberedHash(2))
      .execute();
    expect(dlqRows.length).toBeGreaterThanOrEqual(1);
    expect(dlqRows[0]!.stage).toBe('vote_projection_stage');
  }, 30_000);
});
