import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  AaveGovernanceActorAddressDeriver,
  AaveGovernanceArchivePayloadRepository,
  AaveGovernanceProjectionApplier,
} from '@sources/aave';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const SOURCE_TYPE = 'aave_governance_v3';
const PROPOSAL_ID = '101';
const PROPOSER = '0x1111111111111111111111111111111111111111';
const DESCRIPTION_HASH = '12'.repeat(32);

function numberedHash(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}

/** Block time of the VotingActivated event (block 102) — the anchor of the derived voting window. */
const ACTIVATION_BLOCK_TIME = new Date('2024-03-01T12:00:00Z');
const VOTING_DURATION_SECONDS = 86_400;

/**
 * Serves the activation block's header. VoteBlockTimestampFetcher cross-checks the returned hash and
 * number against the request, so both must echo back or the timestamp is discarded as a mismatch.
 */
const fakeRegistry = {
  peek: () => ({
    chainCfg: { chainId: CHAIN_ID },
    client: {
      send: (method: string, params: unknown[]) => {
        if (method !== 'eth_getBlockByHash') return Promise.resolve(null);
        const hash = String((params as [string])[0] ?? '').toLowerCase();
        if (hash !== numberedHash(1003).toLowerCase()) return Promise.resolve(null);
        return Promise.resolve({
          hash,
          number: '0x66', // 102
          timestamp: '0x' + Math.floor(ACTIVATION_BLOCK_TIME.getTime() / 1000).toString(16),
        });
      },
    },
  }),
} as never;

describeIf('aave governance derivation integration', () => {
  let archive: ArchiveDerivationRepository;
  let actorResolution: ArchiveActorResolutionRepository;
  let actors: ActorRepository;
  let dlq: DlqRepository;
  let payloads: AaveGovernanceArchivePayloadRepository;
  let actorDeriver: AaveGovernanceActorAddressDeriver;
  let daoSourceId = '';

  beforeAll(async () => {
    archive = new ArchiveDerivationRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    actors = new ActorRepository(pgDb);
    dlq = new DlqRepository(pgDb);
    payloads = new AaveGovernanceArchivePayloadRepository(chDb);
    actorDeriver = new AaveGovernanceActorAddressDeriver(payloads);

    await pgDb
      .insertInto('source_type')
      .values({ value: SOURCE_TYPE })
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const daoRow = await pgDb
      .insertInto('dao')
      .values({
        slug: `aave-derivation-int-${Date.now()}`,
        name: 'Aave Derivation Integration',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const sourceRow = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoRow.id,
        source_type: SOURCE_TYPE,
        chain_id: CHAIN_ID,
        source_config: { governance_address: '0x9aee0b04504cef83a65ac3f0e838d0593bcb2bc7' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = sourceRow.id;
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, proposal, actor, ingestion_dlq, ingestion_dlq_resolved RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_aave_governance_v3 DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function insertArchivedEvent(opts: {
    eventType:
      | 'ProposalCreated'
      | 'VotingActivated'
      | 'ProposalQueued'
      | 'ProposalExecuted'
      | 'ProposalCanceled'
      | 'ProposalFailed'
      | 'PayloadSent';
    blockNumber: bigint;
    logIndex: number;
    txHash: string;
    blockHash: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aave_governance_v3')
      .values({
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: opts.logIndex,
        event_type: opts.eventType,
        payload: JSON.stringify(opts.payload),
        received_at: new Date(`2026-01-01T00:00:0${opts.logIndex}Z`),
      } as Parameters<
        ReturnType<typeof chDb.insertInto<'archive_event_aave_governance_v3'>>['values']
      >[0])
      .execute();

    await pgDb
      .insertInto('archive_event')
      .values({
        source_type: SOURCE_TYPE,
        dao_source_id: daoSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber.toString(),
        block_hash: opts.blockHash,
        tx_hash: opts.txHash,
        log_index: opts.logIndex,
        event_type: opts.eventType,
        received_at: new Date(`2026-01-01T00:00:0${opts.logIndex}Z`),
        derived_at: null,
      })
      .execute();
  }

  async function resolveActors(): Promise<void> {
    const rows = await actorResolution.findUnresolvedActors(actorDeriver.eventTypes, 5, 50);
    const byKey = new Map(
      (await actorDeriver.fetchPayloads(rows)).map((payload) => [
        `${payload.chain_id}:${payload.tx_hash}:${payload.log_index}:${payload.block_hash}`,
        payload,
      ]),
    );

    for (const row of rows) {
      const payload = byKey.get(
        `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`,
      );
      expect(payload).toBeDefined();
      const candidates = actorDeriver.extractAddresses(row.event_type, payload!.payload);
      for (const candidate of candidates) {
        await actors.findOrCreateActorAddress(candidate.address, candidate.source);
      }
      await actorResolution.markActorResolved(row.id);
    }
  }

  it('derives an archived Aave proposal lifecycle into proposal state, metadata, payloads, and title enrichment', async () => {
    await insertArchivedEvent({
      eventType: 'ProposalCreated',
      blockNumber: 100n,
      logIndex: 0,
      txHash: numberedHash(1),
      blockHash: numberedHash(1001),
      payload: {
        proposalId: PROPOSAL_ID,
        creator: PROPOSER,
        accessLevel: 2,
        ipfsHash: `0x${DESCRIPTION_HASH}`,
      },
    });
    await insertArchivedEvent({
      eventType: 'PayloadSent',
      blockNumber: 101n,
      logIndex: 1,
      txHash: numberedHash(2),
      blockHash: numberedHash(1002),
      payload: {
        proposalId: PROPOSAL_ID,
        payloadId: '55',
        payloadsController: '0x2222222222222222222222222222222222222222',
        chainId: '0x89',
        payloadNumberOnProposal: '0',
        numberOfPayloadsOnProposal: '1',
      },
    });
    await insertArchivedEvent({
      eventType: 'VotingActivated',
      blockNumber: 102n,
      logIndex: 2,
      txHash: numberedHash(3),
      blockHash: numberedHash(1003),
      payload: {
        proposalId: PROPOSAL_ID,
        votingDuration: 86400,
      },
    });
    await insertArchivedEvent({
      eventType: 'ProposalQueued',
      blockNumber: 103n,
      logIndex: 3,
      txHash: numberedHash(4),
      blockHash: numberedHash(1004),
      payload: {
        proposalId: PROPOSAL_ID,
        votesFor: '1234567890123456789',
        votesAgainst: '987654321',
      },
    });
    await insertArchivedEvent({
      eventType: 'ProposalExecuted',
      blockNumber: 104n,
      logIndex: 4,
      txHash: numberedHash(5),
      blockHash: numberedHash(1005),
      payload: { proposalId: PROPOSAL_ID },
    });

    await resolveActors();

    const applier = new AaveGovernanceProjectionApplier({
      pgDb,
      archive,
      dlq,
      payloads,
      ipfsFetcher: {
        fetchTitleDescription: vi.fn().mockResolvedValue({
          kind: 'resolved',
          title: 'Loaded title',
          description: 'Loaded body',
        }),
      } as never,
      registry: fakeRegistry,
      metrics: {
        batchLookupSeconds: () => undefined,
        processed: () => undefined,
        ipfsTitleFetch: () => undefined,
      },
      logger: silentLogger,
    });

    await applier.applyBatch(await actorResolution.findDerivableBy(applier.eventTypes, 20));

    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('source_type', '=', SOURCE_TYPE)
      .where('source_id', '=', PROPOSAL_ID)
      .executeTakeFirstOrThrow();
    expect(proposal).toMatchObject({
      source_type: SOURCE_TYPE,
      source_id: PROPOSAL_ID,
      title: 'Loaded title',
      description: 'Loaded body',
      description_hash: DESCRIPTION_HASH,
      binding: true,
      // v3 voting runs on the voting machine's chain, so mainnet reports no start/end block and the
      // TimestampFillerService (which requires one) can never resolve this window — it comes from
      // VotingActivated instead.
      voting_starts_block: null,
      voting_ends_block: null,
      state: 'executed',
    });

    // Window derived from the activation block's time + votingDuration, even though the proposal has
    // already advanced to `executed` and the state guard blocks the transition back to `active`.
    expect(proposal.voting_starts_at).toEqual(ACTIVATION_BLOCK_TIME);
    expect(proposal.voting_ends_at).toEqual(
      new Date(ACTIVATION_BLOCK_TIME.getTime() + VOTING_DURATION_SECONDS * 1000),
    );

    const metadata = await pgDb
      .selectFrom('aave_proposal_metadata')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();
    expect(metadata).toMatchObject({
      proposal_id: proposal.id,
      voting_chain_id: null,
      voting_machine_address: null,
      voting_strategy_address: null,
      creation_block: '100',
    });

    const payloadRows = await pgDb
      .selectFrom('aave_proposal_payload')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .orderBy('payload_index', 'asc')
      .execute();
    expect(payloadRows).toEqual([
      expect.objectContaining({
        proposal_id: proposal.id,
        payload_index: 0,
        target_chain_id: '0x89',
        payloads_controller_address: '0x2222222222222222222222222222222222222222',
        payload_id: '55',
        status: 'declared',
      }),
    ]);

    const choices = await pgDb
      .selectFrom('proposal_choice')
      .select(['choice_index', 'value'])
      .where('proposal_id', '=', proposal.id)
      .orderBy('choice_index', 'asc')
      .execute();
    expect(choices).toEqual([
      { choice_index: 0, value: 'Against' },
      { choice_index: 1, value: 'For' },
    ]);

    const actorsCreated = await pgDb
      .selectFrom('actor')
      .innerJoin('actor_address', 'actor_address.actor_id', 'actor.id')
      .select(['actor.primary_address', 'actor_address.source'])
      .execute();
    expect(actorsCreated).toEqual([{ primary_address: PROPOSER, source: 'proposer_event' }]);

    const archiveRows = await pgDb
      .selectFrom('archive_event')
      .select(['derived_at', 'derivation_actor_resolved_at'])
      .orderBy('block_number', 'asc')
      .execute();
    expect(archiveRows).toHaveLength(5);
    for (const row of archiveRows) {
      expect(row.derived_at).not.toBeNull();
      expect(row.derivation_actor_resolved_at).not.toBeNull();
    }

    expect(await pgDb.selectFrom('ingestion_dlq').selectAll().execute()).toHaveLength(0);
    const resolvedDlqRows = await pgDb.selectFrom('ingestion_dlq_resolved').selectAll().execute();
    expect(resolvedDlqRows).toHaveLength(1);
    expect(resolvedDlqRows[0]).toMatchObject({
      stage: 'aave_ipfs_title_fetch',
      source: 'indexer.aave_governance_v3',
      resolution_kind: 'retry_succeeded',
      resolved_by: 'indexer.aave_ipfs_title_fetch',
    });

    await pgDb.updateTable('archive_event').set({ derived_at: null }).execute();
    await applier.applyBatch(await actorResolution.findDerivableBy(applier.eventTypes, 20));

    expect(await pgDb.selectFrom('proposal').selectAll().execute()).toHaveLength(1);
    expect(await pgDb.selectFrom('aave_proposal_metadata').selectAll().execute()).toHaveLength(1);
    expect(await pgDb.selectFrom('aave_proposal_payload').selectAll().execute()).toHaveLength(1);
    expect(await pgDb.selectFrom('proposal_choice').selectAll().execute()).toHaveLength(2);
    expect(await pgDb.selectFrom('ingestion_dlq_resolved').selectAll().execute()).toHaveLength(1);
  }, 30_000);
});
