import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashApiKey } from '@libs/auth';
import { silentLogger } from '@libs/chain';
import type { ChainContextRegistry, LogEvent } from '@libs/chain';
import {
  ActorRepository,
  ArchiveActorResolutionRepository,
  ArchiveDerivationRepository,
  ArchiveEventRepository,
  DaoSourceRepository,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
  chDb,
  pgDb,
} from '@libs/db';
import type { ArchiveEventType } from '@libs/domain';
import {
  computeProposalLinks,
  ForumLinkRepository,
  type LinkCandidateThread,
} from '@sources/forum';
import {
  ARAGON_VOTING_INTERFACE,
  AragonEnactmentLookup,
  AragonProposalProjectionApplier,
  AragonVoteProjectionApplier,
  AragonVotingArchivePayloadRepository,
  AragonVotingEventRepository,
  DualGovernanceArchivePayloadRepository,
  DualGovernanceEventRepository,
  DualGovernanceProposalProjectionApplier,
  DualGovernanceProposalRepository,
  DualGovernanceStateHistoryRepository,
  DualGovernanceStateProjectionApplier,
  EasyTrackArchivePayloadRepository,
  EasyTrackEventRepository,
  EasyTrackMotionProjectionApplier,
  LidoAragonVotingActorAddressDeriver,
  LidoAragonVotingArchiveWriter,
  LidoDualGovernanceArchiveWriter,
  LidoEasyTrackArchiveWriter,
  makeAragonVotingIngesterListener,
  type EasyTrackEvent,
} from '@sources/lido';
import {
  makeSnapshotOffChainArchiveWriter,
  SnapshotArchivePayloadRepository,
  SnapshotProposalProjectionApplier,
  SnapshotProposalRepository,
  SnapshotVoteChoiceRepository,
  SnapshotVoteProjectionApplier,
} from '@sources/snapshot';
import {
  createRealApp,
  describeHttpIf,
  resetClickhouse,
  resetDaoProposalApiTables,
} from '../../apps/api/tests/dao-proposal-api.e2e.helpers';

// ── one coherent Lido governance episode across all five transports ─────────────
//
// A Snapshot signaling proposal (weighted) precedes an Aragon binding vote whose description links a
// Discourse thread; the binding vote is queued while Dual Governance sits in VetoSignalling; an Easy
// Track motion runs the same week. Every proposal/vote/state/motion/link below is produced by driving
// the REAL decode→archive→derive pipeline (not seeded), then asserted via the API + projections. This
// is the deterministic (no-anvil) mixed-transport acceptance gate. Addresses are synthetic test data.

const CHAIN_ID = '0x1';
const TEST_PEPPER = Buffer.alloc(32, 7);
const BEARER_KEY = `${'kv_live_'}${'z'.repeat(32)}`;

const ARAGON_ADDRESS = '0x2e59a20f205bb85a89c53f1936454680651e618e';
const ET_ADDRESS = '0xf0211b7660680b49de1a7e9f25c65660f0a13fea';
const DG_ADDRESS = '0xc1db28b3301331277e307fdcff8de28242a4486e';
const TIMELOCK_ADDRESS = '0xce042530a70b70e0ce9ab6fd8f6b7e0c9c0d0e5f';
const ZERO = `0x${'00'.repeat(20)}`;

const SNAPSHOT_SPACE = 'lido-snapshot.eth';
const SNAPSHOT_PROPOSAL_ID = `0x${'5a'.repeat(32)}`;
const ARAGON_SOURCE_ID = '77';
const EASYTRACK_SOURCE_ID = '9';
const DG_SOURCE_ID = '10';
const DG_ADMIN_EXECUTOR = '0x23e0b465633ff5178808f4a75186e2f2f9537021';
const DG_TARGET = `0x${'11'.repeat(20)}`;

const PROPOSER = `0x${'c1'.repeat(20)}`;
const VOTER_A = `0x${'a1'.repeat(20)}`;
const VOTER_B = `0x${'b1'.repeat(20)}`;

const FORUM_HOST = 'research.lido.fi';
const FORUM_TOPIC_ID = '4242';
// The Aragon proposal description references the thread → high-confidence (description_url) link.
const ARAGON_DESCRIPTION = `Binding vote. Discussion: https://${FORUM_HOST}/t/binding-vote/${FORUM_TOPIC_ID}`;

// Deterministic block clock (replaces the anvil fork): the appliers resolve block timestamps via
// registry.peek().client.send('eth_getBlockByHash', [hash]); this maps fabricated hashes → blocks.
const BLOCKS: Record<string, { number: string; unix: number }> = {};
function blockHashOf(n: number): string {
  return `0x${n.toString(16).padStart(64, '0')}`;
}
function registerBlock(n: number, unix: number): { number: bigint; hash: string } {
  const hash = blockHashOf(n);
  BLOCKS[hash] = { number: String(n), unix };
  return { number: BigInt(n), hash };
}
const stubRegistry = {
  peek: () => ({
    chainCfg: { chainId: CHAIN_ID },
    client: {
      send: (_method: string, params: unknown[]) => {
        const hash = String(params[0]).toLowerCase();
        const block = BLOCKS[hash];
        return Promise.resolve(
          block === undefined
            ? undefined
            : { hash, number: block.number, timestamp: String(block.unix) },
        );
      },
    },
  }),
} as unknown as ChainContextRegistry;

const NOOP_METRICS = {
  batchLookupSeconds: () => undefined,
  chWriteSeconds: () => undefined,
  processed: () => undefined,
};

// Episode timeline (unix seconds).
const T_SNAPSHOT = 1_770_000_000;
const T_DG_VETO = 1_770_300_000;
const T_ARAGON_START = 1_770_400_000;
const T_ARAGON_CAST = 1_770_450_000;
const T_ARAGON_OBJECTION = 1_770_460_000;
const T_ARAGON_EXECUTE = 1_770_500_000;
const T_ET_CREATE = 1_770_420_000;
const T_ET_ENACT = 1_770_700_000;

describeHttpIf('Lido mixed-transport acceptance (one episode, five transports)', () => {
  let app: INestApplication;
  let daoId = '';
  let aragonSourceId = '';
  let snapshotSourceId = '';
  let easyTrackSourceId = '';
  let dgSourceId = '';
  let aragonProposalId = '';
  const bearer = `Bearer ${BEARER_KEY}`;

  const history = new DualGovernanceStateHistoryRepository(pgDb);
  const voteRead = new VoteEventsProjectionReadRepository(chDb);

  beforeAll(async () => {
    app = await createRealApp();
    await resetDaoProposalApiTables();
    await resetClickhouse();
    await resetSourceArchives();
    for (const k of Object.keys(BLOCKS)) delete BLOCKS[k];

    await seedScaffolding();
    await driveSnapshot();
    await driveAragon();
    await driveEasyTrack();
    await driveDualGovernance();
    await driveForumLinking();
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await resetDaoProposalApiTables();
    await resetClickhouse();
    await resetSourceArchives();
  });

  // ── DAO + sources + auth (the only directly-seeded rows; everything else is derived) ──
  async function seedScaffolding(): Promise<void> {
    await pgDb
      .insertInto('source_type')
      .values([
        { value: 'aragon_voting' },
        { value: 'dual_governance' },
        { value: 'easy_track' },
        { value: 'snapshot' },
        { value: 'discourse_forum' },
      ])
      .onConflict((oc) => oc.column('value').doNothing())
      .execute();

    const user = await pgDb
      .insertInto('users')
      .values({
        email: 'lido-mt@example.com',
        display_name: 'Lido MT',
        role: 'admin',
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgDb
      .insertInto('api_key')
      .values({
        user_id: user.id,
        key_hash: hashApiKey(TEST_PEPPER, BEARER_KEY),
        prefix: 'kv_live_',
        last_four: 'zzzz',
        tier: 'authenticated_free',
        label: 'lido-mt',
      })
      .execute();

    const dao = await pgDb
      .insertInto('dao')
      .values({
        slug: 'lido',
        name: 'Lido',
        primary_token_address: `0x${'5a'.repeat(20)}`,
        primary_chain_id: '1',
        description: 'Lido DAO (mixed-transport e2e)',
        website_url: 'https://lido.fi',
        forum_url: `https://${FORUM_HOST}`,
        updated_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    daoId = dao.id;

    const sources = await pgDb
      .insertInto('dao_source')
      .values([
        {
          dao_id: daoId,
          source_type: 'aragon_voting',
          chain_id: CHAIN_ID,
          source_config: { voting_address: ARAGON_ADDRESS },
        },
        {
          dao_id: daoId,
          source_type: 'dual_governance',
          chain_id: CHAIN_ID,
          source_config: {
            dual_governance_address: DG_ADDRESS,
            timelock_address: TIMELOCK_ADDRESS,
          },
        },
        {
          dao_id: daoId,
          source_type: 'easy_track',
          chain_id: CHAIN_ID,
          source_config: { easy_track_address: ET_ADDRESS },
        },
        {
          dao_id: daoId,
          source_type: 'snapshot',
          chain_id: 'off-chain',
          source_config: { space: SNAPSHOT_SPACE },
        },
      ])
      .returning(['id', 'source_type'])
      .execute();
    aragonSourceId = sources.find((s) => s.source_type === 'aragon_voting')!.id;
    dgSourceId = sources.find((s) => s.source_type === 'dual_governance')!.id;
    easyTrackSourceId = sources.find((s) => s.source_type === 'easy_track')!.id;
    snapshotSourceId = sources.find((s) => s.source_type === 'snapshot')!.id;
  }

  // ── Snapshot: weighted signaling proposal + two votes; voter B re-casts (supersession) ──
  async function driveSnapshot(): Promise<void> {
    const proposalApplier = new SnapshotProposalProjectionApplier({
      pgDb,
      payloads: new SnapshotArchivePayloadRepository(chDb),
      archive: new ArchiveDerivationRepository(pgDb),
      logger: silentLogger,
    });
    const voteApplier = new SnapshotVoteProjectionApplier({
      payloads: new SnapshotArchivePayloadRepository(chDb),
      proposals: new ProposalRepository(pgDb),
      snapshotProposals: new SnapshotProposalRepository(pgDb),
      voteRead,
      voteWrite: new VoteEventsProjectionWriter(chDb),
      voteChoice: new SnapshotVoteChoiceRepository(chDb),
      archive: new ArchiveDerivationRepository(pgDb),
      logger: silentLogger,
    });

    const proposalRow = await archiveOffchain(
      'SnapshotProposalCreated',
      `prop:${SNAPSHOT_PROPOSAL_ID}`,
      T_SNAPSHOT,
      {
        id: SNAPSHOT_PROPOSAL_ID,
        created: T_SNAPSHOT,
        title: 'Lido Snapshot signaling: allocate treasury',
        body: 'Signaling proposal',
        choices: ['Option A', 'Option B', 'Option C'],
        type: 'weighted',
        start: T_SNAPSHOT,
        end: T_SNAPSHOT + 3600,
        state: 'closed',
        scores: [3, 1, 0],
        scores_total: 4,
        scores_state: 'final',
        author: PROPOSER,
        ipfs: 'Qm123',
        network: '1',
        flagged: false,
        strategies: [{ name: 'erc20-balance-of' }],
        space: { id: SNAPSHOT_SPACE },
      },
    );
    await proposalApplier.applyBatch([proposalRow]);

    // voter A: weighted {B:3, C:1} → primary = option B.
    const voteA = await archiveOffchain('SnapshotVoteCast', `vote:0xvoteA`, T_SNAPSHOT + 10, {
      id: '0xvoteA',
      voter: VOTER_A,
      choice: { '2': 3, '3': 1 },
      vp: 100,
      vp_by_strategy: [100],
      created: T_SNAPSHOT + 10,
      proposal: { id: SNAPSHOT_PROPOSAL_ID },
    });
    await voteApplier.applyBatch([voteA]);

    // voter B: first casts option A, then re-casts option C → the re-cast supersedes.
    const voteB1 = await archiveOffchain('SnapshotVoteCast', `vote:0xvoteB1`, T_SNAPSHOT + 20, {
      id: '0xvoteB1',
      voter: VOTER_B,
      choice: { '1': 1 },
      vp: 50,
      vp_by_strategy: [50],
      created: T_SNAPSHOT + 20,
      proposal: { id: SNAPSHOT_PROPOSAL_ID },
    });
    await voteApplier.applyBatch([voteB1]);
    const voteB2 = await archiveOffchain('SnapshotVoteCast', `vote:0xvoteB2`, T_SNAPSHOT + 900, {
      id: '0xvoteB2',
      voter: VOTER_B,
      choice: { '3': 1 },
      vp: 50,
      vp_by_strategy: [50],
      created: T_SNAPSHOT + 900,
      proposal: { id: SNAPSHOT_PROPOSAL_ID },
    });
    await voteApplier.applyBatch([voteB2]);
  }

  async function archiveOffchain(
    eventType: ArchiveEventType,
    externalId: string,
    created: number,
    payload: Record<string, unknown>,
  ) {
    const contentHash = `h-${externalId}`;
    const row = await pgDb
      .insertInto('archive_event')
      .values({
        source_type: 'snapshot',
        dao_source_id: snapshotSourceId,
        chain_id: 'off-chain',
        external_id: externalId,
        derivation_ordinal: String(created),
        content_hash: contentHash,
        version: 1,
        event_type: eventType,
        received_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await makeSnapshotOffChainArchiveWriter({ chDb })(
      {
        daoSourceId: snapshotSourceId,
        sourceType: 'snapshot',
        chainId: 'off-chain',
        sourceLabel: 'snapshot',
      },
      { externalId, contentHash, ordinal: String(created), version: 1, payload },
    );
    return {
      id: row.id,
      source_type: 'snapshot',
      dao_source_id: snapshotSourceId,
      chain_id: 'off-chain',
      external_id: externalId,
      derivation_ordinal: String(created),
      event_type: eventType,
      received_at: new Date(),
      derivation_attempt_count: 0,
    };
  }

  // ── Aragon: binding proposal (links the forum thread) + Yes vote → objection No flip → execute ──
  async function driveAragon(): Promise<void> {
    const dlq = new DlqRepository(pgDb);
    const archive = new ArchiveDerivationRepository(pgDb);
    const actorResolution = new ArchiveActorResolutionRepository(pgDb);
    const actors = new ActorRepository(pgDb);
    const proposals = new ProposalRepository(pgDb);
    const payloads = new AragonVotingArchivePayloadRepository(chDb);
    const deriver = new LidoAragonVotingActorAddressDeriver(payloads);

    const listener = makeAragonVotingIngesterListener({
      archiveWriter: new LidoAragonVotingArchiveWriter({
        eventRepo: new AragonVotingEventRepository({ chDb }),
        archiveEventRepo: new ArchiveEventRepository(pgDb),
        dlqRepo: dlq,
        logger: silentLogger,
      }),
      context: {
        daoSourceId: aragonSourceId,
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        sourceLabel: 'aragon_voting',
      },
      logger: silentLogger,
      dlqRepo: dlq,
    });

    const proposalApplier = new AragonProposalProjectionApplier({
      pgDb,
      archive,
      dlq,
      payloads,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
    const voteApplier = new AragonVoteProjectionApplier({
      archive,
      dlq,
      payloads,
      proposals,
      voteRead,
      voteWrite: new VoteEventsProjectionWriter(chDb),
      registry: stubRegistry,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });

    let tx = 0;
    const nextTx = (): string => `0x${(++tx).toString(16).padStart(64, '0')}`;
    async function emit(
      name: string,
      args: unknown[],
      block: { number: bigint; hash: string },
      logIndex: number,
    ): Promise<void> {
      const frag = ARAGON_VOTING_INTERFACE.getEvent(name)!;
      const enc = ARAGON_VOTING_INTERFACE.encodeEventLog(frag, args);
      const log: LogEvent = {
        sourceType: 'aragon_voting',
        chainId: CHAIN_ID,
        blockNumber: block.number,
        blockHash: block.hash,
        txHash: nextTx(),
        txIndex: 0,
        logIndex,
        address: ARAGON_ADDRESS,
        topics: enc.topics as string[],
        data: enc.data,
      };
      await listener([log]);
    }
    async function deriveAll(): Promise<void> {
      const rows = await actorResolution.findUnresolvedActors([...deriver.eventTypes], 5, 100);
      if (rows.length > 0) {
        const found = await deriver.fetchPayloads(rows);
        const byKey = new Map(
          found.map((p) => [`${p.chain_id}:${p.tx_hash}:${p.log_index}:${p.block_hash}`, p]),
        );
        for (const r of rows) {
          const p = byKey.get(`${r.chain_id}:${r.tx_hash}:${r.log_index}:${r.block_hash}`);
          if (p === undefined) continue;
          for (const c of deriver.extractAddresses(r.event_type, p.payload)) {
            await actors.findOrCreateActorAddress(c.address.toLowerCase(), c.source);
          }
          await actorResolution.markActorResolved(r.id);
        }
      }
      await proposalApplier.applyBatch(
        await actorResolution.findDerivableBy(
          [...proposalApplier.eventTypes] as ArchiveEventType[],
          100,
        ),
      );
      await voteApplier.applyBatch(
        await actorResolution.findDerivableBy(
          [...voteApplier.eventTypes] as ArchiveEventType[],
          100,
        ),
      );
    }

    const bStart = registerBlock(1000, T_ARAGON_START);
    await emit('StartVote', [BigInt(ARAGON_SOURCE_ID), PROPOSER, ARAGON_DESCRIPTION], bStart, 0);
    await deriveAll();
    const bCast = registerBlock(1010, T_ARAGON_CAST);
    await emit(
      'CastVote',
      [BigInt(ARAGON_SOURCE_ID), VOTER_A, true, 5_000_000_000_000_000_000_000n],
      bCast,
      0,
    );
    await deriveAll();
    // objection phase: flip Yes → No (supersession).
    const bObj = registerBlock(1020, T_ARAGON_OBJECTION);
    await emit(
      'CastVote',
      [BigInt(ARAGON_SOURCE_ID), VOTER_A, false, 5_000_000_000_000_000_000_000n],
      bObj,
      0,
    );
    await emit(
      'CastObjection',
      [BigInt(ARAGON_SOURCE_ID), VOTER_A, 5_000_000_000_000_000_000_000n],
      bObj,
      1,
    );
    await deriveAll();
    const bExec = registerBlock(1030, T_ARAGON_EXECUTE);
    await emit('ExecuteVote', [BigInt(ARAGON_SOURCE_ID)], bExec, 0);
    await deriveAll();

    const proposal = await proposals.findBySource({
      daoId,
      sourceType: 'aragon_voting',
      sourceId: ARAGON_SOURCE_ID,
    });
    aragonProposalId = proposal!.id;
  }

  // ── Easy Track: optimistic motion created → enacted ──
  async function driveEasyTrack(): Promise<void> {
    const archiveWriter = new LidoEasyTrackArchiveWriter({
      eventRepo: new EasyTrackEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    const actorResolution = new ArchiveActorResolutionRepository(pgDb);
    const applier = new EasyTrackMotionProjectionApplier({
      pgDb,
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new EasyTrackArchivePayloadRepository(chDb),
      registry: stubRegistry,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });

    async function archive(
      eventType: EasyTrackEvent['type'],
      blockNumber: number,
      unix: number,
      logIndex: number,
      payload: Record<string, unknown>,
    ): Promise<void> {
      registerBlock(blockNumber, unix);
      const log: LogEvent = {
        sourceType: 'easy_track',
        chainId: CHAIN_ID,
        blockNumber: BigInt(blockNumber),
        blockHash: blockHashOf(blockNumber),
        txHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
        txIndex: 0,
        logIndex,
        address: ET_ADDRESS,
        topics: [],
        data: '0x',
      };
      await archiveWriter.writeCore(
        {
          daoSourceId: easyTrackSourceId,
          sourceType: 'easy_track',
          chainId: CHAIN_ID,
          sourceLabel: 'easy_track',
        },
        { type: eventType, payload } as EasyTrackEvent,
        log,
      );
    }
    async function deriveAll(): Promise<void> {
      await sql`UPDATE archive_event SET derivation_actor_resolved_at = now() WHERE source_type = 'easy_track' AND chain_id = ${CHAIN_ID}`.execute(
        pgDb,
      );
      for (let pass = 0; pass < 3; pass += 1) {
        const rows = await actorResolution.findDerivableBy(
          ['MotionCreated', 'MotionObjected', 'MotionEnacted', 'MotionRejected', 'MotionCanceled'],
          100,
        );
        if (rows.length === 0) return;
        await applier.applyBatch(rows);
      }
    }

    await archive('MotionDurationChanged', 1050, T_ET_CREATE - 10, 0, { motionDuration: '259200' });
    await archive('MotionCreated', 1060, T_ET_CREATE, 0, {
      motionId: EASYTRACK_SOURCE_ID,
      creator: PROPOSER,
      evmScriptFactory: `0x${'22'.repeat(20)}`,
      evmScriptCallData: '0xc0ffee',
      evmScript: '0x',
    });
    await archive('MotionEnacted', 1200, T_ET_ENACT, 0, { motionId: EASYTRACK_SOURCE_ID });
    await deriveAll();
  }

  // ── Dual Governance: DAO-wide state transitions (Normal → VetoSignalling) for state-at-T ──
  async function driveDualGovernance(): Promise<void> {
    const archiveWriter = new LidoDualGovernanceArchiveWriter({
      eventRepo: new DualGovernanceEventRepository({ chDb }),
      archiveEventRepo: new ArchiveEventRepository(pgDb),
      dlqRepo: new DlqRepository(pgDb),
      logger: silentLogger,
    });
    const actorResolution = new ArchiveActorResolutionRepository(pgDb);
    const applier = new DualGovernanceStateProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      daoSources: new DaoSourceRepository(pgDb),
      history,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });

    async function stateChange(
      blockNumber: bigint,
      logIndex: number,
      to: string,
      enteredAt: number,
    ): Promise<void> {
      const decoded = {
        type: 'DualGovernanceStateChanged' as const,
        payload: {
          from: 'Normal',
          to,
          context: {
            state: to,
            enteredAt,
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
      const log: LogEvent = {
        sourceType: 'dual_governance',
        chainId: CHAIN_ID,
        blockNumber,
        blockHash: `0x${'b1'.repeat(32)}`,
        txHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
        txIndex: 0,
        logIndex,
        address: DG_ADDRESS,
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
        decoded,
        log,
      );
    }

    await stateChange(900n, 0, 'Normal', T_SNAPSHOT);
    await stateChange(950n, 0, 'VetoSignalling', T_DG_VETO);
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now() WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(
      pgDb,
    );
    await applier.applyBatch(
      await actorResolution.findDerivableBy(['DualGovernanceStateChanged'], 100),
    );

    // A direct DG submission (no correlating Aragon ExecuteVote) → its own dual_governance proposal.
    const proposalApplier = new DualGovernanceProposalProjectionApplier({
      archive: new ArchiveDerivationRepository(pgDb),
      dlq: new DlqRepository(pgDb),
      payloads: new DualGovernanceArchivePayloadRepository(chDb),
      proposals: new ProposalRepository(pgDb),
      actors: new ActorRepository(pgDb),
      ledger: new DualGovernanceProposalRepository(pgDb),
      enactment: new AragonEnactmentLookup(chDb),
      history,
      metrics: NOOP_METRICS,
      logger: silentLogger,
    });
    const dgTx = `0x${'1a'.repeat(32)}`;
    await writeDg(
      {
        type: 'ProposalSubmittedMeta',
        payload: {
          proposerAccount: PROPOSER,
          proposalId: DG_SOURCE_ID,
          metadata: `# DG Proposal ${DG_SOURCE_ID}`,
        },
      },
      960n,
      dgTx,
      0,
      DG_ADDRESS,
      archiveWriter,
    );
    await writeDg(
      {
        type: 'ProposalSubmitted',
        payload: {
          id: DG_SOURCE_ID,
          executor: DG_ADMIN_EXECUTOR,
          calls: [{ target: DG_TARGET, value: '0', payload: '0xabcdef' }],
        },
      },
      960n,
      dgTx,
      1,
      TIMELOCK_ADDRESS,
      archiveWriter,
    );
    await sql`UPDATE archive_event SET derivation_actor_resolved_at = now() WHERE source_type = 'dual_governance' AND chain_id = ${CHAIN_ID}`.execute(
      pgDb,
    );
    await proposalApplier.applyBatch(
      await actorResolution.findDerivableBy(
        [
          'ProposalSubmitted',
          'ProposalScheduled',
          'ProposalExecuted',
          'ProposalsCancelledTill',
          'ProposalSubmittedMeta',
        ],
        200,
      ),
    );
  }

  async function writeDg(
    decoded: { type: string; payload: unknown },
    blockNumber: bigint,
    txHash: string,
    logIndex: number,
    address: string,
    archiveWriter: LidoDualGovernanceArchiveWriter,
  ): Promise<void> {
    const log: LogEvent = {
      sourceType: 'dual_governance',
      chainId: CHAIN_ID,
      blockNumber,
      blockHash: `0x${'b1'.repeat(32)}`,
      txHash,
      txIndex: 0,
      logIndex,
      address,
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
      log,
    );
  }

  // ── Forum: thread + deterministic high-confidence link to the Aragon proposal ──
  async function driveForumLinking(): Promise<void> {
    const threadId = (
      await pgDb
        .insertInto('forum_thread')
        .values({
          dao_id: daoId,
          forum_host: FORUM_HOST,
          forum_topic_id: FORUM_TOPIC_ID,
          title: 'Discussion: binding vote',
          raw_content: '# Discussion',
          content_pipeline_version: 'v1',
          post_count: 8,
          last_activity_at: new Date(T_ARAGON_START * 1000),
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

    const proposal = await pgDb
      .selectFrom('proposal')
      .select(['id', 'title', 'description'])
      .where('id', '=', aragonProposalId)
      .executeTakeFirstOrThrow();
    const candidates: LinkCandidateThread[] = [
      {
        id: threadId,
        forumHost: FORUM_HOST,
        forumTopicId: FORUM_TOPIC_ID,
        title: 'Discussion: binding vote',
      },
    ];
    const links = computeProposalLinks(
      { id: proposal.id, title: proposal.title, description: proposal.description },
      candidates,
    );
    const linkRepo = new ForumLinkRepository(pgDb);
    for (const link of links) await linkRepo.insertLink(link);
  }

  async function resetSourceArchives(): Promise<void> {
    for (const t of [
      'archive_event_aragon_voting',
      'archive_event_easy_track',
      'archive_event_dual_governance',
      'archive_event_snapshot',
      'snapshot_vote_choice',
    ]) {
      await sql.raw(`TRUNCATE TABLE ${t}`).execute(chDb);
    }
  }

  // ─────────────────────────── assertions ───────────────────────────

  it('resolves all four governance tracks as distinct source_types', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/daos/lido/proposals')
      .set('Authorization', bearer)
      .expect(200);
    const sourceTypes = new Set(
      (res.body.data as { source_type: string }[]).map((p) => p.source_type),
    );
    expect(sourceTypes).toEqual(
      new Set(['aragon_voting', 'snapshot', 'easy_track', 'dual_governance']),
    );
  });

  it('attaches the Aragon vote and supersedes the objection-phase flip (single current vote = No)', async () => {
    const current = await voteRead.findCurrentVote({
      daoId,
      proposalId: aragonProposalId,
      voterAddress: VOTER_A,
    });
    expect(current?.primary_choice).toBe(0); // flipped Yes→No
    const all = await chDb
      .selectFrom('vote_events_projection')
      .select(['primary_choice', 'superseded'])
      .where('proposal_id', '=', aragonProposalId)
      .execute();
    expect(all.filter((r) => r.superseded === 1)).toHaveLength(1); // the prior Yes
  });

  it('maps the Aragon proposal to executed and links the forum thread (high confidence)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/aragon_voting/${ARAGON_SOURCE_ID}`)
      .set('Authorization', bearer)
      .expect(200);
    const data = res.body.data as {
      source_type: string;
      state: string;
      offchain_discussion_links?: { confidence: string; platform: string }[];
    };
    expect(data.source_type).toBe('aragon_voting');
    expect(data.state).toBe('executed');
    expect(data.offchain_discussion_links?.[0]?.confidence).toBe('high');
    expect(data.offchain_discussion_links?.[0]?.platform).toBe('discourse');
  });

  it('derives the Snapshot weighted tally + supersedes voter B re-cast', async () => {
    const snapProposal = await pgDb
      .selectFrom('proposal')
      .select('id')
      .where('dao_id', '=', daoId)
      .where('source_type', '=', 'snapshot')
      .where('source_id', '=', SNAPSHOT_PROPOSAL_ID)
      .executeTakeFirstOrThrow();
    const voteChoice = new SnapshotVoteChoiceRepository(chDb);
    // voter A weighted breakdown: {B:3,C:1} → option B index 1 = 0.75, option C index 2 = 0.25.
    const aCurrent = await voteRead.findCurrentVote({
      daoId,
      proposalId: snapProposal.id,
      voterAddress: VOTER_A,
    });
    expect(aCurrent?.primary_choice).toBe(1);
    const aChoices = await voteChoice.findByVoteId(aCurrent!.vote_id);
    expect(aChoices?.map((c) => c.weight)).toEqual(['0.75', '0.25']);
    // voter B re-cast (option C) supersedes the first (option A).
    const bCurrent = await voteRead.findCurrentVote({
      daoId,
      proposalId: snapProposal.id,
      voterAddress: VOTER_B,
    });
    expect(bCurrent?.primary_choice).toBe(2);
  });

  it('maps the Easy Track motion to an executed proposal (optimistic-objection model)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/v1/daos/lido/proposals/easy_track/${EASYTRACK_SOURCE_ID}`)
      .set('Authorization', bearer)
      .expect(200);
    expect((res.body.data as { source_type: string; state: string }).state).toBe('executed');
    const meta = await pgDb
      .selectFrom('easy_track_motion_meta as m')
      .innerJoin('proposal as p', 'p.id', 'm.proposal_id')
      .select('m.state')
      .where('p.source_id', '=', EASYTRACK_SOURCE_ID)
      .where('p.dao_id', '=', daoId)
      .executeTakeFirstOrThrow();
    expect(meta.state).toBe('enacted');
    // optimistic-objection ≠ votes: no per-voter ballots.
    const motionProposal = await pgDb
      .selectFrom('proposal')
      .select('id')
      .where('dao_id', '=', daoId)
      .where('source_type', '=', 'easy_track')
      .where('source_id', '=', EASYTRACK_SOURCE_ID)
      .executeTakeFirstOrThrow();
    const votes = await chDb
      .selectFrom('vote_events_raw')
      .select(({ fn }) => fn.countAll().as('n'))
      .where('proposal_id', '=', motionProposal.id)
      .executeTakeFirst();
    expect(Number(votes?.n ?? 0)).toBe(0);
  });

  it('records Dual Governance state history; the Aragon queue time reads as VetoSignalling (state-at-T)', async () => {
    expect(await history.currentState(daoId)).toBe('veto_signaling');
    expect(await history.stateAt(daoId, new Date(T_ARAGON_START * 1000))).toBe('veto_signaling');
    expect(await history.stateAt(daoId, new Date((T_SNAPSHOT + 100) * 1000))).toBe('normal');
  });
});
