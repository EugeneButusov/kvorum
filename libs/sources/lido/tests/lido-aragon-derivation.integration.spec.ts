import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import {
  ARAGON_VOTING_INTERFACE,
  AragonVoteProjectionApplier,
  AragonVotingArchivePayloadRepository,
  AragonVotingEventRepository,
  AragonProposalProjectionApplier,
  LidoAragonVotingActorAddressDeriver,
  LidoAragonVotingArchiveWriter,
  makeAragonVotingIngesterListener,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const ANVIL_URL = process.env['ANVIL_RPC_URL'];
const describeIf = DB_URL && CH_URL && ANVIL_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const VOTING_ADDRESS = '0x2e59a20f205bb85a89c53f1936454680651e618e';
const NOOP = {
  batchLookupSeconds: () => undefined,
  chWriteSeconds: () => undefined,
  processed: () => undefined,
};

async function rpcSend<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ANVIL_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message?: string } };
  if (json.error !== undefined) throw new Error(`rpc ${method} failed: ${json.error.message}`);
  return json.result as T;
}

async function currentBlock(): Promise<{ number: bigint; hash: string }> {
  const number = BigInt(await rpcSend<string>('eth_blockNumber', []));
  const block = await rpcSend<{ hash: string }>('eth_getBlockByNumber', [
    `0x${number.toString(16)}`,
    false,
  ]);
  return { number, hash: block.hash };
}

function encodeLog(eventName: string, args: unknown[]) {
  const fragment = ARAGON_VOTING_INTERFACE.getEvent(eventName)!;
  const encoded = ARAGON_VOTING_INTERFACE.encodeEventLog(fragment, args);
  return { topics: encoded.topics as string[], data: encoded.data };
}

describeIf('Lido Aragon Voting derivation integration', () => {
  let daoSourceId = '';
  let listener: ReturnType<typeof makeAragonVotingIngesterListener>;
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let actors: ActorRepository;
  let proposals: ProposalRepository;
  let payloads: AragonVotingArchivePayloadRepository;
  let deriver: LidoAragonVotingActorAddressDeriver;
  let proposalApplier: AragonProposalProjectionApplier;
  let voteApplier: AragonVoteProjectionApplier;

  let txCounter = 0;
  function nextTxHash(): string {
    txCounter += 1;
    return '0x' + txCounter.toString(16).padStart(64, '0');
  }

  async function writeEvent(
    eventName: string,
    args: unknown[],
    block: { number: bigint; hash: string },
    logIndex: number,
  ): Promise<void> {
    const { topics, data } = encodeLog(eventName, args);
    await listener([
      {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: block.number,
        blockHash: block.hash,
        txHash: nextTxHash(),
        txIndex: 0,
        logIndex,
        address: VOTING_ADDRESS,
        topics,
        data,
      },
    ]);
  }

  async function runActorSweep(): Promise<void> {
    const rows = await actorResolution.findUnresolvedActors([...deriver.eventTypes], 5, 100);
    if (rows.length === 0) return;
    const found = await deriver.fetchPayloads(rows);
    const byKey = new Map(
      found.map((p) => [`${p.chain_id}:${p.tx_hash}:${p.log_index}:${p.block_hash}`, p]),
    );
    for (const row of rows) {
      const payload = byKey.get(
        `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`,
      );
      if (payload === undefined) continue;
      for (const c of deriver.extractAddresses(row.event_type, payload.payload)) {
        await actors.findOrCreateActorAddress(c.address.toLowerCase(), c.source);
      }
      await actorResolution.markActorResolved(row.id);
    }
  }

  async function deriveProposals(): Promise<void> {
    const rows = await actorResolution.findDerivableBy(
      [...proposalApplier.eventTypes] as ArchiveEventType[],
      100,
    );
    await proposalApplier.applyBatch(rows);
  }

  async function deriveVotes(): Promise<void> {
    const rows = await actorResolution.findDerivableBy(
      [...voteApplier.eventTypes] as ArchiveEventType[],
      100,
    );
    await voteApplier.applyBatch(rows);
  }

  async function deriveAll(): Promise<void> {
    await runActorSweep();
    await deriveProposals();
    await deriveVotes();
  }

  async function proposalIdFor(sourceId: string): Promise<string> {
    const daoId = await proposals.findDaoIdForSource(daoSourceId);
    const proposal = await proposals.findBySource({
      daoId: daoId!,
      sourceType: 'aragon_voting',
      sourceId,
    });
    if (proposal === undefined) throw new Error(`no proposal for ${sourceId}`);
    return proposal.id;
  }

  async function currentVotes(proposalId: string) {
    return chDb
      .selectFrom('vote_events_projection')
      .select(['voter_address', 'primary_choice', 'voting_power', 'superseded'])
      .where('proposal_id', '=', proposalId)
      .where('superseded', '=', 0)
      .execute();
  }

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'aragon_voting' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-aragon-deriv-${Date.now()}`,
        name: 'Lido Aragon Derivation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'derivation integration test',
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
        source_type: 'aragon_voting',
        chain_id: CHAIN_ID,
        source_config: { voting_address: VOTING_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    const dlq = new DlqRepository(pgDb);
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    actors = new ActorRepository(pgDb);
    proposals = new ProposalRepository(pgDb);
    payloads = new AragonVotingArchivePayloadRepository(chDb);
    deriver = new LidoAragonVotingActorAddressDeriver(payloads);

    const archiveWriter = new LidoAragonVotingArchiveWriter({
      eventRepo: new AragonVotingEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: dlq,
      logger: silentLogger,
    });
    listener = makeAragonVotingIngesterListener({
      archiveWriter,
      context: {
        daoSourceId,
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        sourceLabel: 'aragon_voting',
      },
      logger: silentLogger,
      dlqRepo: dlq,
    });

    proposalApplier = new AragonProposalProjectionApplier({
      pgDb,
      archive,
      dlq,
      payloads,
      metrics: NOOP,
      logger: silentLogger,
    });
    voteApplier = new AragonVoteProjectionApplier({
      archive,
      dlq,
      payloads,
      proposals,
      voteRead: new VoteEventsProjectionReadRepository(chDb),
      voteWrite: new VoteEventsProjectionWriter(chDb),
      registry: {
        peek: (chainId: string) =>
          chainId === CHAIN_ID
            ? ({ client: { send: rpcSend }, chainCfg: { chainId: CHAIN_ID } } as never)
            : undefined,
      } as never,
      metrics: NOOP,
      logger: silentLogger,
    });
  }, 30_000);

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  beforeEach(async () => {
    txCounter = 0;
    await sql`TRUNCATE archive_event, proposal, actor, ingestion_dlq RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  it('derives StartVote → active proposal + metadata seed + binary choices (GET data path)', async () => {
    const block = await currentBlock();
    await writeEvent(
      'StartVote',
      [100n, '0x' + '11'.repeat(20), 'Omnibus vote: enable X'],
      block,
      0,
    );
    await deriveAll();

    const proposalId = await proposalIdFor('100');
    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('active');
    expect(proposal.title).toBe('Omnibus vote: enable X');
    expect(proposal.binding).toBe(true);

    const metadata = await pgDb
      .selectFrom('aragon_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', proposalId)
      .executeTakeFirstOrThrow();
    expect(metadata.app_address).toBe(VOTING_ADDRESS);
    expect(metadata.support_required_pct).toBeNull();
    expect(metadata.min_accept_quorum_pct).toBeNull();

    const choices = await pgDb
      .selectFrom('proposal_choice')
      .select(['choice_index', 'value'])
      .where('proposal_id', '=', proposalId)
      .orderBy('choice_index', 'asc')
      .execute();
    expect(choices).toEqual([
      { choice_index: 0, value: 'No' },
      { choice_index: 1, value: 'Yes' },
    ]);
  }, 30_000);

  it('ExecuteVote advances state to executed and stamps executed_at; gate drains the no-actor row', async () => {
    const block = await currentBlock();
    await writeEvent('StartVote', [101n, '0x' + '11'.repeat(20), 'v'], block, 0);
    await deriveAll();
    await writeEvent('ExecuteVote', [101n], block, 1);
    await deriveAll();

    const proposalId = await proposalIdFor('101');
    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('id', '=', proposalId)
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('executed');

    const metadata = await pgDb
      .selectFrom('aragon_proposal_metadata')
      .select('executed_at')
      .where('proposal_id', '=', proposalId)
      .executeTakeFirstOrThrow();
    expect(metadata.executed_at).not.toBeNull();

    const underived = await pgDb
      .selectFrom('archive_event')
      .select('id')
      .where('event_type', '=', 'ExecuteVote')
      .where('derived_at', 'is', null)
      .execute();
    expect(underived).toHaveLength(0);
  }, 30_000);

  it('drains Change* config events as no-ops (zero-underived gate)', async () => {
    const block = await currentBlock();
    await writeEvent('ChangeSupportRequired', [500000000000000000n], block, 0);
    await writeEvent('ChangeVoteTime', [259200n], block, 1);
    await deriveAll();

    const underived = await pgDb
      .selectFrom('archive_event')
      .select('id')
      .where('derived_at', 'is', null)
      .execute();
    expect(underived).toHaveLength(0);
    // no proposal rows produced by config events
    expect(await pgDb.selectFrom('proposal').selectAll().execute()).toHaveLength(0);
  }, 30_000);

  it('derives a CastVote into a vote row with stake power and Yes choice', async () => {
    const block = await currentBlock();
    const voter = '0x' + '22'.repeat(20);
    const stake = 5_000_000_000_000_000_000_000n;
    await writeEvent('StartVote', [102n, '0x' + '11'.repeat(20), 'v'], block, 0);
    await writeEvent('CastVote', [102n, voter, true, stake], block, 1);
    await deriveAll();

    const proposalId = await proposalIdFor('102');
    const votes = await currentVotes(proposalId);
    expect(votes).toHaveLength(1);
    expect(votes[0]?.voter_address.toLowerCase()).toContain('22');
    expect(votes[0]?.primary_choice).toBe(1);
    expect(BigInt(votes[0]!.voting_power)).toBe(stake);
  }, 30_000);

  it('objection-phase Yes→No flip supersedes; co-fired CastObjection yields no extra row', async () => {
    const voter = '0x' + '33'.repeat(20);
    const stake = 1_000_000_000_000_000_000_000n;

    const mainBlock = await currentBlock();
    await writeEvent('StartVote', [103n, '0x' + '11'.repeat(20), 'v'], mainBlock, 0);
    await writeEvent('CastVote', [103n, voter, true, stake], mainBlock, 1);
    await deriveAll();

    const proposalId = await proposalIdFor('103');
    expect((await currentVotes(proposalId))[0]?.primary_choice).toBe(1);

    // Objection phase: advance to a newer block, voter flips to No (CastVote false co-fired with CastObjection).
    await rpcSend('evm_mine', []);
    const objBlock = await currentBlock();
    await writeEvent('CastVote', [103n, voter, false, stake], objBlock, 0);
    await writeEvent('CastObjection', [103n, voter, stake], objBlock, 1);
    await deriveAll();

    const current = await currentVotes(proposalId);
    expect(current).toHaveLength(1);
    expect(current[0]?.primary_choice).toBe(0); // flipped to No

    // exactly one row was the objection-marker skip; no objection vote row exists
    const allRows = await chDb
      .selectFrom('vote_events_projection')
      .select(['primary_choice', 'superseded'])
      .where('proposal_id', '=', proposalId)
      .execute();
    // one current No + one superseded Yes
    expect(allRows.filter((r) => r.superseded === 1)).toHaveLength(1);
  }, 30_000);

  it('Era-1 main-phase No vote derives cleanly without any objection event', async () => {
    const block = await currentBlock();
    const voter = '0x' + '44'.repeat(20);
    await writeEvent('StartVote', [104n, '0x' + '11'.repeat(20), 'v'], block, 0);
    await writeEvent('CastVote', [104n, voter, false, 7n], block, 1);
    await deriveAll();

    const proposalId = await proposalIdFor('104');
    const votes = await currentVotes(proposalId);
    expect(votes).toHaveLength(1);
    expect(votes[0]?.primary_choice).toBe(0);
  }, 30_000);
});
