import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { LogEvent } from '@libs/chain';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  DualGovernanceArchivePayloadRepository,
  DualGovernanceEventRepository,
  DualGovernanceStateHistoryRepository,
  DualGovernanceStateProjectionApplier,
  LidoDualGovernanceArchiveWriter,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const DG_ADDRESS = '0xc1db28b3301331277e307fdcff8de28242a4486e';
const ZERO = '0x' + '00'.repeat(20);

const NOOP_METRICS = { batchLookupSeconds: () => undefined, processed: () => undefined };

describeIf('Lido Dual Governance state-history derivation integration', () => {
  let daoId = '';
  let daoSourceId = '';
  let archiveWriter: LidoDualGovernanceArchiveWriter;
  let applier: DualGovernanceStateProjectionApplier;
  let actorResolution: ArchiveActorResolutionRepository;
  let history: DualGovernanceStateHistoryRepository;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'dual_governance' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-dg-deriv-${Date.now()}`,
        name: 'Lido DG Derivation',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido DG state-history derivation integration test',
        website_url: 'https://example.com',
        forum_url: 'https://forum.example.com',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    const source = await pgDb
      .insertInto('dao_source')
      .values({
        dao_id: daoId,
        source_type: 'dual_governance',
        chain_id: CHAIN_ID,
        source_config: { dual_governance_address: DG_ADDRESS, timelock_address: DG_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    history = new DualGovernanceStateHistoryRepository(pgDb);
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    archiveWriter = new LidoDualGovernanceArchiveWriter({
      eventRepo: new DualGovernanceEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    applier = new DualGovernanceStateProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      daoSources: new DaoSourceRepository(pgDb),
      history,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
  }, 30_000);

  beforeEach(async () => {
    await sql`TRUNCATE archive_event, ingestion_dlq, dual_governance_state_history RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq, dual_governance_state_history RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_dual_governance DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function archiveStateChange(opts: {
    blockNumber: bigint;
    txHash: string;
    logIndex: number;
    to: string;
    enteredAt: number;
  }): Promise<void> {
    const decoded = {
      type: 'DualGovernanceStateChanged' as const,
      payload: {
        from: 'Normal',
        to: opts.to,
        context: {
          state: opts.to,
          enteredAt: opts.enteredAt,
          vetoSignallingActivatedAt: 0,
          signallingEscrow: ZERO,
          rageQuitRound: 0,
          vetoSignallingReactivationTime: 0,
          normalOrVetoCooldownExitedAt: 0,
          rageQuitEscrow: ZERO,
          configProvider: ZERO,
        },
      },
    };
    const logRef: LogEvent = {
      sourceType: 'dual_governance',
      chainId: CHAIN_ID,
      blockNumber: opts.blockNumber,
      blockHash: '0x' + 'b1'.repeat(32),
      txHash: opts.txHash,
      txIndex: 0,
      logIndex: opts.logIndex,
      address: DG_ADDRESS,
      topics: [],
      data: '0x',
    };
    await archiveWriter.writeCore(
      {
        daoSourceId,
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        sourceLabel: 'dual_governance',
      },
      decoded,
      logRef,
    );
  }

  async function deriveAll() {
    // Stand in for the actor sweep: stamp the state events resolved so they pass the projection gate.
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now()
              WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(pgDb);
    const rows = await actorResolution.findDerivableBy(['DualGovernanceStateChanged'], 100);
    await applier.applyBatch(rows);
    return rows;
  }

  it('derives append-only history; current state + state-at-T are single lookups', async () => {
    const txA = '0x' + '1a'.repeat(32);
    const txB = '0x' + '2b'.repeat(32);
    await archiveStateChange({
      blockNumber: 100n,
      txHash: txA,
      logIndex: 0,
      to: 'Normal',
      enteredAt: 1_754_648_507,
    });
    // Two transitions chained in one tx (lazy activateNextState) — distinct log_index.
    await archiveStateChange({
      blockNumber: 200n,
      txHash: txB,
      logIndex: 0,
      to: 'VetoSignallingDeactivation',
      enteredAt: 1_754_648_600,
    });
    await archiveStateChange({
      blockNumber: 200n,
      txHash: txB,
      logIndex: 1,
      to: 'VetoCooldown',
      enteredAt: 1_754_648_700,
    });

    await deriveAll();

    const rows = await pgDb
      .selectFrom('dual_governance_state_history')
      .select(['state', 'tx_hash', 'log_index'])
      .where('dao_id', '=', daoId)
      .orderBy('transition_at')
      .execute();
    expect(rows.map((r) => r.state)).toEqual([
      'normal',
      'veto_signaling_deactivation',
      'veto_cooldown',
    ]);

    expect(await history.currentState(daoId)).toBe('veto_cooldown');
    expect(await history.stateAt(daoId, new Date(1_754_648_550 * 1000))).toBe('normal');
  }, 30_000);

  it('is idempotent — re-deriving the same rows writes no duplicates', async () => {
    const tx = '0x' + '3c'.repeat(32);
    await archiveStateChange({
      blockNumber: 300n,
      txHash: tx,
      logIndex: 0,
      to: 'Normal',
      enteredAt: 1_754_648_507,
    });

    const rows = await deriveAll();
    await applier.applyBatch(rows); // replay the same batch

    const count = await pgDb
      .selectFrom('dual_governance_state_history')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  }, 30_000);
});
