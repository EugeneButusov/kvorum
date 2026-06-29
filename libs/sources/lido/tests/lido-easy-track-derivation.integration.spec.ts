import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '@libs/chain';
import type { ChainContextRegistry, LogEvent } from '@libs/chain';
import {
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DlqRepository,
  chDb,
  pgDb,
} from '@libs/db';
import {
  EasyTrackArchivePayloadRepository,
  EasyTrackEventRepository,
  EasyTrackMotionProjectionApplier,
  LidoEasyTrackArchiveWriter,
  type EasyTrackEvent,
} from '@sources/lido';

const DB_URL = process.env['DATABASE_URL'];
const CH_URL = process.env['CLICKHOUSE_URL'];
const describeIf = DB_URL && CH_URL ? describe : describe.skip;

const CHAIN_ID = '0x1';
const ET_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';
const CREATOR = '0x' + '11'.repeat(20);
const FACTORY = '0x' + '22'.repeat(20);
const DURATION = 259_200; // 72h
const MOTION_EVENT_TYPES = [
  'MotionCreated',
  'MotionObjected',
  'MotionEnacted',
  'MotionRejected',
  'MotionCanceled',
] as const;

const NOOP_METRICS = { batchLookupSeconds: () => undefined, processed: () => undefined };

// Stubbed chain: maps the block hash the projection queries to a fabricated block. Lets the real
// block-timestamp fetch run against deterministic data instead of a live node.
const BLOCKS: Record<string, { number: string; unix: number }> = {};
function blockHashOf(n: number): string {
  return '0x' + n.toString(16).padStart(64, '0');
}
const chainCtx = {
  chainCfg: { chainId: CHAIN_ID },
  client: {
    send: (_method: string, params: unknown[]) => {
      const hash = (params[0] as string).toLowerCase();
      const block = BLOCKS[hash];
      return Promise.resolve(
        block === undefined
          ? undefined
          : { hash, number: block.number, timestamp: String(block.unix) },
      );
    },
  },
};
const registry = { peek: () => chainCtx } as unknown as ChainContextRegistry;

describeIf('Lido Easy Track motion derivation integration', () => {
  let daoId = '';
  let daoSourceId = '';
  let archiveWriter: LidoEasyTrackArchiveWriter;
  let applier: EasyTrackMotionProjectionApplier;
  let actorResolution: ArchiveActorResolutionRepository;

  beforeAll(async () => {
    await pgDb
      .insertInto('source_type')
      .values([{ value: 'easy_track' }])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: `lido-et-deriv-${Date.now()}`,
        name: 'Lido Easy Track Derivation',
        primary_token_address: '0x' + '00'.repeat(20),
        primary_chain_id: CHAIN_ID,
        description: 'Lido Easy Track motion derivation integration test',
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
        source_type: 'easy_track',
        chain_id: CHAIN_ID,
        source_config: { easy_track_address: ET_ADDRESS },
        active_from_block: null,
        active_to_block: null,
        backfill_started_at_block: null,
        backfill_head_block: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoSourceId = source.id;

    archiveWriter = new LidoEasyTrackArchiveWriter({
      eventRepo: new EasyTrackEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    actorResolution = new ArchiveActorResolutionRepository(pgDb);
    applier = new EasyTrackMotionProjectionApplier({
      pgDb,
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new EasyTrackArchivePayloadRepository(chDb),
      registry,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
  }, 30_000);

  beforeEach(async () => {
    for (const key of Object.keys(BLOCKS)) delete BLOCKS[key];
    await sql`TRUNCATE archive_event, ingestion_dlq, proposal, actor, actor_address, easy_track_motion_meta RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_easy_track DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  afterAll(async () => {
    await sql`TRUNCATE dao, archive_event, ingestion_dlq, proposal, actor, actor_address, easy_track_motion_meta RESTART IDENTITY CASCADE`.execute(
      pgDb,
    );
    await sql`ALTER TABLE archive_event_easy_track DELETE WHERE chain_id = ${CHAIN_ID}`.execute(
      chDb,
    );
  });

  async function archive(
    eventType: EasyTrackEvent['type'],
    blockNumber: number,
    logIndex: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const blockHash = blockHashOf(blockNumber);
    const logRef: LogEvent = {
      sourceType: 'easy_track',
      chainId: CHAIN_ID,
      blockNumber: BigInt(blockNumber),
      blockHash,
      txHash: '0x' + blockNumber.toString(16).padStart(2, '0').repeat(32).slice(0, 64),
      txIndex: 0,
      logIndex,
      address: ET_ADDRESS,
      topics: [],
      data: '0x',
    };
    await archiveWriter.writeCore(
      { daoSourceId, sourceType: 'easy_track', chainId: CHAIN_ID, sourceLabel: 'easy_track' },
      { type: eventType, payload } as EasyTrackEvent,
      logRef,
    );
  }

  function registerBlock(blockNumber: number, unix: number): void {
    BLOCKS[blockHashOf(blockNumber)] = { number: String(blockNumber), unix };
  }

  // Drive the projection until no derivable rows remain, so a terminal event whose MotionCreated lands
  // later in the same batch (deferred) catches up — mirrors the worker running repeatedly.
  async function deriveAll(): Promise<void> {
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now()
              WHERE source_type = 'easy_track' AND chain_id = ${CHAIN_ID}`.execute(pgDb);
    for (let pass = 0; pass < 3; pass += 1) {
      const rows = await actorResolution.findDerivableBy([...MOTION_EVENT_TYPES], 100);
      if (rows.length === 0) return;
      await applier.applyBatch(rows);
    }
  }

  it('derives MotionCreated → active binding proposal + meta + decoded proposal_action rows', async () => {
    const createdAt = 1_767_225_600; // 2026-01-01T00:00:00Z
    const actionTarget = '0x' + '33'.repeat(20);
    // spec-1 EVMScript: one direct call to actionTarget with calldata 0xabcdef.
    const evmScript = '0x00000001' + '33'.repeat(20) + '00000003' + 'abcdef';
    registerBlock(100, createdAt);
    await archive('MotionDurationChanged', 50, 0, { motionDuration: String(DURATION) });
    await archive('MotionCreated', 100, 0, {
      motionId: '1',
      creator: CREATOR,
      evmScriptFactory: FACTORY,
      evmScriptCallData: '0xc0ffee',
      evmScript,
    });

    await deriveAll();

    const proposal = await pgDb
      .selectFrom('proposal')
      .selectAll()
      .where('dao_id', '=', daoId)
      .where('source_type', '=', 'easy_track')
      .where('source_id', '=', '1')
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('active');
    expect(proposal.binding).toBe(true);
    expect(proposal.title).toBe('Easy Track motion #1');
    expect(proposal.voting_starts_at).toEqual(new Date(createdAt * 1000));
    expect(proposal.voting_ends_at).toEqual(new Date((createdAt + DURATION) * 1000));

    const meta = await pgDb
      .selectFrom('easy_track_motion_meta')
      .selectAll()
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();
    expect(meta.motion_id).toBe('1');
    expect(meta.factory_address).toBe(FACTORY);
    expect(meta.state).toBe('active');
    expect(meta.objection_ends_at).toEqual(new Date((createdAt + DURATION) * 1000));

    // The motion's EVMScript is decoded into proposal_action rows.
    const actions = await pgDb
      .selectFrom('proposal_action')
      .select(['action_index', 'target_address', 'calldata'])
      .where('proposal_id', '=', proposal.id)
      .orderBy('action_index')
      .execute();
    expect(actions).toEqual([
      { action_index: 0, target_address: actionTarget, calldata: '0xabcdef' },
    ]);

    // The optimistic-objection model writes no per-voter ballots.
    const voteCount = await chDb
      .selectFrom('vote_events_raw')
      .select(({ fn }) => fn.countAll().as('n'))
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirst();
    expect(Number(voteCount?.n ?? 0)).toBe(0);
  }, 30_000);

  it('advances MotionEnacted → proposal executed + motion enacted', async () => {
    registerBlock(100, 1_767_225_600);
    await archive('MotionDurationChanged', 50, 0, { motionDuration: String(DURATION) });
    await archive('MotionCreated', 100, 0, {
      motionId: '2',
      creator: CREATOR,
      evmScriptFactory: FACTORY,
      evmScriptCallData: '0x',
      evmScript: '0x',
    });
    await archive('MotionEnacted', 300, 0, { motionId: '2' });

    await deriveAll();

    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'state'])
      .where('dao_id', '=', daoId)
      .where('source_id', '=', '2')
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('executed');
    const meta = await pgDb
      .selectFrom('easy_track_motion_meta')
      .select('state')
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();
    expect(meta.state).toBe('enacted');
  }, 30_000);

  it('objection then rejection → proposal defeated + motion rejected, still no votes', async () => {
    registerBlock(100, 1_767_225_600);
    await archive('MotionDurationChanged', 50, 0, { motionDuration: String(DURATION) });
    await archive('MotionCreated', 100, 0, {
      motionId: '3',
      creator: CREATOR,
      evmScriptFactory: FACTORY,
      evmScriptCallData: '0x',
      evmScript: '0x',
    });
    await archive('MotionObjected', 150, 0, {
      motionId: '3',
      objector: CREATOR,
      weight: '1000',
      newObjectionsAmount: '2500',
      newObjectionsAmountPct: '60',
    });
    await archive('MotionRejected', 200, 0, { motionId: '3' });

    await deriveAll();

    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'state'])
      .where('dao_id', '=', daoId)
      .where('source_id', '=', '3')
      .executeTakeFirstOrThrow();
    expect(proposal.state).toBe('defeated');
    const meta = await pgDb
      .selectFrom('easy_track_motion_meta')
      .select('state')
      .where('proposal_id', '=', proposal.id)
      .executeTakeFirstOrThrow();
    expect(meta.state).toBe('rejected');
  }, 30_000);

  it('is idempotent — re-deriving writes no duplicate proposal', async () => {
    registerBlock(100, 1_767_225_600);
    await archive('MotionDurationChanged', 50, 0, { motionDuration: String(DURATION) });
    await archive('MotionCreated', 100, 0, {
      motionId: '4',
      creator: CREATOR,
      evmScriptFactory: FACTORY,
      evmScriptCallData: '0x',
      evmScript: '0x',
    });

    await deriveAll();
    await sql`UPDATE archive_event SET derived_at = NULL WHERE source_type = 'easy_track'`.execute(
      pgDb,
    );
    await deriveAll();

    const count = await pgDb
      .selectFrom('proposal')
      .select(({ fn }) => fn.countAll().as('n'))
      .where('dao_id', '=', daoId)
      .where('source_id', '=', '4')
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  }, 30_000);
});
