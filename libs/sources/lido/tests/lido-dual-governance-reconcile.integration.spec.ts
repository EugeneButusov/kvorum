import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { LogEvent } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DaoSourceRepository,
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
  DualGovernanceReconcileRepository,
  DualGovernanceStateHistoryRepository,
  DualGovernanceStateProjectionApplier,
  DualGovernanceStateReconciler,
  LidoDualGovernanceArchiveWriter,
} from '@sources/lido';
import {
  DUAL_GOVERNANCE_GETTERS_INTERFACE,
  TIMELOCK_GETTERS_INTERFACE,
} from '../src/dual-governance/abi/getters';

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

function stateContext(over: Partial<Record<string, number>> = {}) {
  return {
    state: 'placeholder',
    enteredAt: 1_754_648_507,
    vetoSignallingActivatedAt: 0,
    signallingEscrow: '0x' + '00'.repeat(20),
    rageQuitRound: 0,
    vetoSignallingReactivationTime: 0,
    normalOrVetoCooldownExitedAt: 0,
    rageQuitEscrow: '0x' + '00'.repeat(20),
    configProvider: '0x' + '22'.repeat(20),
    ...over,
  };
}

describeIf('Lido Dual Governance reconcile + vetoed integration', () => {
  let daoId = '';
  let dgSourceId = '';
  let aragonSourceId = '';
  let archiveWriter: LidoDualGovernanceArchiveWriter;
  let proposalApplier: DualGovernanceProposalProjectionApplier;
  let stateApplier: DualGovernanceStateProjectionApplier;
  let actorResolution: ArchiveActorResolutionRepository;
  let proposals: ProposalRepository;
  let ledger: DualGovernanceProposalRepository;
  let history: DualGovernanceStateHistoryRepository;
  let reconcileRepo: DualGovernanceReconcileRepository;
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
        slug: `lido-dg-reconcile-${Date.now()}`,
        name: 'Lido DG Reconcile',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido DG reconcile integration test',
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
    history = new DualGovernanceStateHistoryRepository(pgDb);
    reconcileRepo = new DualGovernanceReconcileRepository(pgDb);
    actors = new ActorRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    archiveWriter = new LidoDualGovernanceArchiveWriter({
      eventRepo: new DualGovernanceEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    proposalApplier = new DualGovernanceProposalProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      proposals,
      actors,
      ledger,
      enactment: new AragonEnactmentLookup(chDb),
      history,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
    stateApplier = new DualGovernanceStateProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      daoSources: new DaoSourceRepository(pgDb),
      history,
      ledger,
      proposals,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE proposal_action, dual_governance_reconcile_state, dual_governance_state_history, dual_governance_proposal, proposal, archive_event, ingestion_dlq, actor_address, actor RESTART IDENTITY CASCADE`.execute(
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
    await sql`TRUNCATE dao, proposal_action, dual_governance_reconcile_state, dual_governance_state_history, dual_governance_proposal, proposal, archive_event, ingestion_dlq, actor_address, actor RESTART IDENTITY CASCADE`.execute(
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

  async function deriveFlow(): Promise<void> {
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now()
              WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(pgDb);
    const rows = await actorResolution.findDerivableBy([...FLOW_TYPES], 200);
    await proposalApplier.applyBatch(rows);
  }

  async function deriveState(): Promise<void> {
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now()
              WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(pgDb);
    const rows = await actorResolution.findDerivableBy(['DualGovernanceStateChanged'], 200);
    await stateApplier.applyBatch(rows);
  }

  async function archiveStateChange(
    to: string,
    context: ReturnType<typeof stateContext>,
    opts: { blockNumber: bigint; txHash: string; logIndex: number },
  ): Promise<void> {
    await archiveDg(
      { type: 'DualGovernanceStateChanged', payload: { from: 'Normal', to, context } },
      { ...opts, address: DG_ADDRESS },
    );
  }

  it('fills veto timestamps from the event Context and answers state-at-T (§5)', async () => {
    await archiveStateChange(
      'VetoSignalling',
      stateContext({ enteredAt: 1_760_000_000, vetoSignallingActivatedAt: 1_760_000_000 }),
      { blockNumber: 100n, txHash: '0x' + 'a1'.repeat(32), logIndex: 0 },
    );
    await deriveState();

    const row = await pgDb
      .selectFrom('dual_governance_state_history')
      .selectAll()
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('veto_signaling');
    expect(row.veto_signaling_started_at).toEqual(new Date(1_760_000_000 * 1000));
    expect(row.rage_quit_eth_amount).toBeNull();

    // state-at-T: before the transition → no state; at/after → veto_signaling.
    expect(await history.stateAt(daoId, new Date(1_759_000_000 * 1000))).toBeUndefined();
    expect(await history.stateAt(daoId, new Date(1_761_000_000 * 1000))).toBe('veto_signaling');
  }, 30_000);

  it('vetoes a queued proposal covered by a rage-quit, leaves an out-of-window one queued (ADR-031)', async () => {
    // Two direct submissions; Aragon coverage past every DG block below (submissions, cancel) so no
    // coverage-gate defer (no co-tx ExecuteVote → direct).
    await archiveAragonExecuteVote({
      blockNumber: '2300',
      txHash: '0x' + 'ee'.repeat(32),
      voteId: '999',
    });
    await Promise.all(submitted('8', '0x' + '81'.repeat(32), 2000n, 0));
    await Promise.all(submitted('9', '0x' + '82'.repeat(32), 2001n, 0));
    await deriveFlow();

    // Deterministically bracket the rage-quit time: prop 8 submitted before, prop 9 after.
    const rageQuitAt = new Date('2026-03-01T00:00:00Z');
    await sql`UPDATE dual_governance_proposal SET submitted_at = ${new Date('2026-02-01T00:00:00Z')} WHERE dg_proposal_id = 8`.execute(
      pgDb,
    );
    await sql`UPDATE dual_governance_proposal SET submitted_at = ${new Date('2026-04-01T00:00:00Z')} WHERE dg_proposal_id = 9`.execute(
      pgDb,
    );

    await archiveStateChange(
      'RageQuit',
      stateContext({
        enteredAt: Math.floor(rageQuitAt.getTime() / 1000),
        vetoSignallingActivatedAt: Math.floor(rageQuitAt.getTime() / 1000) - 3600,
        rageQuitRound: 1,
      }),
      { blockNumber: 2100n, txHash: '0x' + '83'.repeat(32), logIndex: 0 },
    );
    await deriveState();

    const covered = await proposals.findBySource({
      daoId,
      sourceType: 'dual_governance',
      sourceId: '8',
    });
    const safe = await proposals.findBySource({
      daoId,
      sourceType: 'dual_governance',
      sourceId: '9',
    });
    expect(covered?.state).toBe('vetoed');
    expect(safe?.state).toBe('queued');

    // Precedence: a bulk-cancel inside the rage-quit window keeps the proposal vetoed, not canceled.
    await archiveDg(
      { type: 'ProposalsCancelledTill', payload: { proposalId: '8' } },
      { blockNumber: 2200n, txHash: '0x' + '84'.repeat(32), logIndex: 0 },
    );
    await deriveFlow();
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '8' }))
        ?.state,
    ).toBe('vetoed');
  }, 30_000);

  it('an emergency-mode event does not corrupt normal-path state (KNOWN-003, structural)', async () => {
    await archiveAragonExecuteVote({
      blockNumber: '5000',
      txHash: '0x' + 'ce'.repeat(32),
      voteId: '997',
    });
    await Promise.all(submitted('5', '0x' + '51'.repeat(32), 5000n, 0));
    await deriveFlow();
    const before = await proposals.findBySource({
      daoId,
      sourceType: 'dual_governance',
      sourceId: '5',
    });
    expect(before?.state).toBe('queued');

    // Archive an emergency event + derive everything: no deriver maps it to state.
    await archiveDg(
      { type: 'EmergencyModeActivated', payload: {} },
      { blockNumber: 5100n, txHash: '0x' + '52'.repeat(32), logIndex: 0 },
    );
    await deriveFlow();
    await deriveState();

    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '5' }))
        ?.state,
    ).toBe('queued');
    const stateRows = await pgDb
      .selectFrom('dual_governance_state_history')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(Number(stateRows.n)).toBe(0); // emergency event produced no state-history transition
  }, 30_000);

  it('reconciler watermarks the DAO and surfaces drift without writing state', async () => {
    const fakeClient = {
      send: vi.fn().mockImplementation((_m: string, params: [{ to: string }, string]) => {
        if (params[0].to === DG_ADDRESS) {
          // effective VetoSignalling(2) ahead of persisted Normal(1) → drift.
          return Promise.resolve(
            DUAL_GOVERNANCE_GETTERS_INTERFACE.encodeFunctionResult('getStateDetails', [
              [2, 1, 0, 0, 0, 0, 0, 0],
            ]),
          );
        }
        return Promise.resolve(
          TIMELOCK_GETTERS_INTERFACE.encodeFunctionResult('isEmergencyModeActive', [false]),
        );
      }),
    };
    const reconciler = new DualGovernanceStateReconciler(silentLogger, ['dual_governance']);
    const result = await reconciler.reconcileRow({
      row: {
        id: daoId,
        source_id: DG_ADDRESS,
        source_type: 'dual_governance',
        chain_id: CHAIN_ID,
        dg_address: DG_ADDRESS,
        timelock_address: TIMELOCK_ADDRESS,
      },
      proposals: reconcileRepo,
      confirmedThreshold: 988n,
      confirmedThresholdTag: '0x3dc',
      chainCtx: { client: fakeClient as never, chainCfg: { chainId: CHAIN_ID } },
    });

    expect(result).toEqual({ outcome: 'state_drift' });
    const cursor = await pgDb
      .selectFrom('dual_governance_reconcile_state')
      .selectAll()
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(cursor.last_reconcile_check_block).toBe('988');
    expect(cursor.last_effective_state).toBe('veto_signaling');
    // No DG state-history row was written by the reconciler (surface-only).
    const stateRows = await pgDb
      .selectFrom('dual_governance_state_history')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(Number(stateRows.n)).toBe(0);
  }, 30_000);

  it('is idempotent — re-deriving the rage-quit reproduces the same vetoed state', async () => {
    await archiveAragonExecuteVote({
      blockNumber: '6000',
      txHash: '0x' + 'cf'.repeat(32),
      voteId: '996',
    });
    await Promise.all(submitted('6', '0x' + '61'.repeat(32), 6000n, 0));
    await deriveFlow();
    await sql`UPDATE dual_governance_proposal SET submitted_at = ${new Date('2026-02-01T00:00:00Z')} WHERE dg_proposal_id = 6`.execute(
      pgDb,
    );
    await archiveStateChange(
      'RageQuit',
      stateContext({ enteredAt: Math.floor(new Date('2026-03-01T00:00:00Z').getTime() / 1000) }),
      { blockNumber: 6100n, txHash: '0x' + '62'.repeat(32), logIndex: 0 },
    );
    await deriveState();
    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '6' }))
        ?.state,
    ).toBe('vetoed');

    // Replay both streams.
    await sql`UPDATE archive_event SET derived_at = NULL WHERE source_type = 'dual_governance'`.execute(
      pgDb,
    );
    await deriveFlow();
    await deriveState();

    expect(
      (await proposals.findBySource({ daoId, sourceType: 'dual_governance', sourceId: '6' }))
        ?.state,
    ).toBe('vetoed');
    const historyRows = await pgDb
      .selectFrom('dual_governance_state_history')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(Number(historyRows.n)).toBe(1); // append-only history deduped under replay
  }, 30_000);
});
