import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { LogEvent } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  ProposalRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  AragonEnactmentLookup,
  DualGovernanceArchivePayloadRepository,
  DualGovernanceEventRepository,
  DualGovernanceProposalProjectionApplier,
  DualGovernanceProposalRepository,
  LidoDualGovernanceArchiveWriter,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const DG_ADDRESS = '0xc1db28b3301331277e307fdcff8de28242a4486e';
const TIMELOCK_ADDRESS = '0xce0425301c85c5ea2a0873a2dee44d78e02d2316';
const ADMIN_EXECUTOR = '0x23e0b465633ff5178808f4a75186e2f2f9537021';
const PROPOSER = '0x' + '99'.repeat(20);
const TARGET = '0x' + '11'.repeat(20);

const NOOP_METRICS = { batchLookupSeconds: () => undefined, processed: () => undefined };
const FLOW_TYPES = [
  'ProposalSubmitted',
  'ProposalScheduled',
  'ProposalExecuted',
  'ProposalsCancelledTill',
  'ProposalSubmittedMeta',
] as const;

describeIf('Lido Dual Governance proposal-flow correlation integration', () => {
  let daoId = '';
  let dgSourceId = '';
  let aragonSourceId = '';
  let archiveWriter: LidoDualGovernanceArchiveWriter;
  let applier: DualGovernanceProposalProjectionApplier;
  let actorResolution: ArchiveActorResolutionRepository;
  let proposals: ProposalRepository;
  let ledger: DualGovernanceProposalRepository;
  let actors: ActorRepository;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'dual_governance' }, { value: 'aragon_voting' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-dg-flow-${Date.now()}`,
        name: 'Lido DG Flow',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido DG proposal-flow integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    const dgSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
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
    dgSourceId = dgSource.id;

    const aragonSource = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: 'aragon_voting',
        chain_id: CHAIN_ID,
        source_config: { voting_address: '0x2e59a20f205bb85a89c53f1936454680651e618e' },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    aragonSourceId = aragonSource.id;

    proposals = new ProposalRepository(pgDb);
    ledger = new DualGovernanceProposalRepository(pgDb);
    actors = new ActorRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    archiveWriter = new LidoDualGovernanceArchiveWriter({
      eventRepo: new DualGovernanceEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    applier = new DualGovernanceProposalProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      proposals,
      actors,
      ledger,
      enactment: new AragonEnactmentLookup(chDb),
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE proposal_action, dual_governance_proposal, proposal, archive_event, ingestion_dlq, actor_address, actor RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, proposal_action, dual_governance_proposal, proposal, archive_event, ingestion_dlq, actor_address, actor RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
    await sql`ALTER TABLE archive_event_aragon_voting DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  type Decoded = { type: string; payload: unknown };

  async function archiveDg(
    decoded: Decoded,
    opts: { blockNumber: bigint; txHash: string; logIndex: number; address?: string },
  ): Promise<void> {
    const logRef: LogEvent = {
      sourceType: 'dual_governance',
      chainId: CHAIN_ID,
      blockNumber: opts.blockNumber,
      blockHash: '0x' + 'b1'.repeat(32),
      txHash: opts.txHash,
      txIndex: 0,
      logIndex: opts.logIndex,
      address: opts.address ?? TIMELOCK_ADDRESS,
      topics: [],
      data: '0x',
    };
    await archiveWriter.writeCore(
      {
        daoSourceId: dgSourceId,
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        sourceLabel: 'dual_governance',
      },
      decoded as never,
      logRef,
    );
  }

  // Stand in for the Aragon ingester: write an ExecuteVote(voteId) to the aragon-voting CH archive in
  // the same tx as the DG submission (the on-chain reality verified in VERIFICATION.md).
  async function archiveAragonExecuteVote(opts: {
    blockNumber: string;
    txHash: string;
    voteId: string;
    logIndex?: number;
  }): Promise<void> {
    await chDb
      .insertInto('archive_event_aragon_voting')
      .values({
        dao_source_id: aragonSourceId,
        chain_id: CHAIN_ID,
        block_number: opts.blockNumber,
        block_hash: '0x' + 'b1'.repeat(32),
        tx_hash: opts.txHash,
        log_index: opts.logIndex ?? 5,
        event_type: 'ExecuteVote',
        payload: JSON.stringify({ voteId: opts.voteId }),
      })
      .execute();
  }

  // Stand in for AA3: an Aragon proposal already advanced to `executed` on ExecuteVote.
  async function seedAragonProposal(voteId: string): Promise<string> {
    const creator = await actors.findOrCreateActorAddress('0x' + '01'.repeat(20), 'proposer_event');
    const result = await proposals.insertProposal({
      dao_id: daoId,
      source_type: 'aragon_voting',
      source_id: voteId,
      proposer_actor_id: creator.id,
      title: `Aragon vote ${voteId}`,
      description: 'aragon body',
      description_hash: 'h'.repeat(64),
      binding: true,
      voting_starts_at: null,
      voting_ends_at: null,
      voting_starts_block: '900',
      voting_ends_block: null,
      state: 'executed',
      state_updated_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
    return result.proposalId!;
  }

  async function deriveFlow(): Promise<void> {
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now()
              WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(pgDb);
    const rows = await actorResolution.findDerivableBy([...FLOW_TYPES], 200);
    await applier.applyBatch(rows);
  }

  function submitted(id: string, tx: string, block: bigint, logIndex: number) {
    return [
      archiveDg(
        {
          type: 'ProposalSubmittedMeta',
          payload: { proposerAccount: PROPOSER, proposalId: id, metadata: `# Proposal ${id}` },
        },
        { blockNumber: block, txHash: tx, logIndex, address: DG_ADDRESS },
      ),
      archiveDg(
        {
          type: 'ProposalSubmitted',
          payload: {
            id,
            executor: ADMIN_EXECUTOR,
            calls: [{ target: TARGET, value: '0', payload: '0xabcdef' }],
          },
        },
        { blockNumber: block, txHash: tx, logIndex: logIndex + 1 },
      ),
    ];
  }

  it('correlates an Aragon-routed submission, reclassifies executed→queued, then executes', async () => {
    const aragonProposalId = await seedAragonProposal('201');
    const tx = '0x' + '1a'.repeat(32);
    await archiveAragonExecuteVote({ blockNumber: '1000', txHash: tx, voteId: '201' });
    await Promise.all(submitted('7', tx, 1000n, 0));
    await deriveFlow();

    // Correlated → no new dual_governance proposal; the Aragon proposal is reclassified queued.
    const after = await proposals.findBySource({
      daoId,
      sourceType: 'aragon_voting',
      sourceId: '201',
    });
    expect(after?.state).toBe('queued');
    const ledgerRow = await ledger.findByDgId(daoId, '7');
    expect(ledgerRow).toMatchObject({
      origin: 'aragon',
      proposal_id: aragonProposalId,
      aragon_source_id: '201',
      status: 'submitted',
    });
    const actions = await pgDb
      .selectFrom('proposal_action')
      .select(['payload_index', 'target_address'])
      .where('proposal_id', '=', aragonProposalId)
      .execute();
    expect(actions).toEqual([{ payload_index: 1, target_address: TARGET }]);

    // ProposalExecuted advances to executed.
    await archiveDg(
      { type: 'ProposalExecuted', payload: { id: '7' } },
      { blockNumber: 1100n, txHash: '0x' + '1b'.repeat(32), logIndex: 0 },
    );
    await deriveFlow();
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'aragon_voting', sourceId: '201' }))
        ?.state,
    ).toBe('executed');
    expect((await ledger.findByDgId(daoId, '7'))?.status).toBe('executed');
  }, 30_000);

  it('creates its own proposal for a direct submission (proposer from Meta)', async () => {
    const tx = '0x' + '2c'.repeat(32);
    // Coverage present (an unrelated aragon event at/after the block) but no co-tx ExecuteVote.
    await archiveAragonExecuteVote({
      blockNumber: '2000',
      txHash: '0x' + 'ee'.repeat(32),
      voteId: '999',
    });
    await Promise.all(submitted('8', tx, 2000n, 0));
    await deriveFlow();

    const direct = await proposals.findBySource({
      daoId,
      sourceType: 'dual_governance',
      sourceId: '8',
    });
    expect(direct).toMatchObject({ state: 'queued', binding: true, title: 'Proposal 8' });
    const proposerAddr = await pgDb
      .selectFrom('actor_address')
      .select('address')
      .where('actor_id', '=', direct!.proposer_actor_id)
      .executeTakeFirst();
    expect(proposerAddr?.address).toBe(PROPOSER);
    expect((await ledger.findByDgId(daoId, '8'))?.origin).toBe('direct');
  }, 30_000);

  it('bulk-cancel cancels every non-executed proposal in range', async () => {
    // Aragon coverage past the cancel block (3100) so the cancel's coverage gate is satisfied.
    await archiveAragonExecuteVote({
      blockNumber: '3200',
      txHash: '0x' + 'ef'.repeat(32),
      voteId: '998',
    });
    await Promise.all(submitted('3', '0x' + '31'.repeat(32), 3000n, 0));
    await Promise.all(submitted('4', '0x' + '32'.repeat(32), 3001n, 0));
    await deriveFlow();

    // Cancel everything up to id 4.
    await archiveDg(
      { type: 'ProposalsCancelledTill', payload: { proposalId: '4' } },
      { blockNumber: 3100n, txHash: '0x' + '33'.repeat(32), logIndex: 0 },
    );
    await deriveFlow();

    expect((await ledger.findByDgId(daoId, '3'))?.status).toBe('cancelled');
    expect((await ledger.findByDgId(daoId, '4'))?.status).toBe('cancelled');
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '3' }))
        ?.state,
    ).toBe('canceled');
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '4' }))
        ?.state,
    ).toBe('canceled');
  }, 30_000);

  it('defers a submission until the Aragon archive covers its block, then correlates', async () => {
    const tx = '0x' + '4d'.repeat(32);
    await Promise.all(submitted('9', tx, 4000n, 0)); // no aragon coverage yet
    await deriveFlow();
    expect(await ledger.findByDgId(daoId, '9')).toBeUndefined();
    const undived = await pgDb
      .selectFrom('archive_event')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('event_type', '=', 'ProposalSubmitted')
      .where('derived_at', 'is', null)
      .executeTakeFirstOrThrow();
    expect(Number(undived.n)).toBe(1); // deferred, not derived

    // Aragon archive catches up + the proposal lands → correlation succeeds.
    await seedAragonProposal('210');
    await archiveAragonExecuteVote({ blockNumber: '4000', txHash: tx, voteId: '210' });
    await deriveFlow();
    expect((await ledger.findByDgId(daoId, '9'))?.origin).toBe('aragon');
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'aragon_voting', sourceId: '210' }))
        ?.state,
    ).toBe('queued');
  }, 30_000);

  it('is idempotent — re-deriving writes no duplicate ledger rows or actions', async () => {
    await seedAragonProposal('201');
    const tx = '0x' + '5e'.repeat(32);
    await archiveAragonExecuteVote({ blockNumber: '5000', txHash: tx, voteId: '201' });
    await Promise.all(submitted('7', tx, 5000n, 0));
    await deriveFlow();
    // Replay: clear the watermark and derive again.
    await sql`UPDATE archive_event SET derived_at = NULL WHERE source_type = 'dual_governance'`.execute(
      pgDb,
    );
    await deriveFlow();

    const ledgerCount = await pgDb
      .selectFrom('dual_governance_proposal')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(Number(ledgerCount.n)).toBe(1);
    const aragonProposalId = (await proposals.findBySource({
      daoId,
      sourceType: 'aragon_voting',
      sourceId: '201',
    }))!.id;
    const actionCount = await pgDb
      .selectFrom('proposal_action')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('proposal_id', '=', aragonProposalId)
      .executeTakeFirstOrThrow();
    expect(Number(actionCount.n)).toBe(1);
  }, 30_000);
});
