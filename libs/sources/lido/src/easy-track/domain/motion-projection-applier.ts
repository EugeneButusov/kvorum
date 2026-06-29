import type { Kysely } from 'kysely';
import { silentLogger, type ChainContextRegistry, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  type PgDatabase,
  type ProposalActionInput,
  ProposalRepository,
} from '@libs/db';
import {
  ArchiveFailureRouter,
  EvmScriptDecodeError,
  VoteBlockTimestampFetcher,
  archiveEventTupleKey,
  type ProjectionDeriver,
} from '@sources/core';
import {
  MOTION_TERMINAL_TRANSITIONS,
  type MotionTerminalEvent,
  projectMotionCreated,
} from './motion-projector';
import type { EasyTrackEvent } from './types';
import { toProposalActions } from '../../calldata/evmscript-actions';
import {
  createForwarderRegistry,
  EXECUTE_SELECTOR,
  FORWARD_SELECTOR,
} from '../../calldata/forwarders';
import { DEFAULT_MOTION_DURATION_SECONDS, EASY_TRACK_MAINNET } from '../addresses';
import { EasyTrackArchivePayloadRepository } from '../persistence/archive-payload-repository';
import { EasyTrackMotionRepository } from '../persistence/motion-repository';

const DLQ_THRESHOLD = Number(process.env['EASY_TRACK_MOTION_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const EASY_TRACK_MOTION_PROJECTION_STAGE = 'easy_track_motion_projection_stage';

// Default Lido forwarders (Agent unwrapping) extended with the Easy Track EVMScriptExecutor, so a
// motion script that routes through the executor unwraps to its real leaf targets; direct calls and
// anything unrecognized degrade to opaque leaves (never dropped).
const EASY_TRACK_FORWARDERS = createForwarderRegistry([
  {
    address: EASY_TRACK_MAINNET.evmScriptExecutor,
    selectors: [FORWARD_SELECTOR, EXECUTE_SELECTOR],
  },
]);

const MOTION_EVENT_TYPES = [
  'MotionCreated',
  'MotionObjected',
  'MotionEnacted',
  'MotionRejected',
  'MotionCanceled',
] as const;

type MotionLifecycleEvent = Extract<EasyTrackEvent, { type: (typeof MOTION_EVENT_TYPES)[number] }>;

export type EasyTrackMotionOutcome =
  | 'derived'
  | 'skipped_idempotent'
  | 'skipped_state_guard'
  | 'deferred'
  | 'failed';

export type EasyTrackMotionFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'block_timestamp_unavailable'
  | 'unknown_dao_source'
  | 'projection_apply_error';

export interface EasyTrackMotionProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: EasyTrackMotionOutcome;
    reason: EasyTrackMotionFailureReason | null;
  }): void;
}

export interface EasyTrackMotionProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: EasyTrackArchivePayloadRepository;
  registry: ChainContextRegistry;
  metrics: EasyTrackMotionProjectionMetrics;
  logger?: Logger;
}

interface ProjectionRepositories {
  actors: ActorRepository;
  proposals: ProposalRepository;
  motions: EasyTrackMotionRepository;
  archive: ArchiveDerivationRepository;
}

/**
 * Projects Lido Easy Track motion events into the unified `proposal` model + the
 * `easy_track_motion_meta` ledger (ADR-076), under the optimistic-objection state map.
 *
 *  - MotionCreated  → insert `proposal` (state `active`, the objection window open) + a meta row.
 *    The window is `blockTimestamp + motionDuration`; the duration is reconstructed from the archived
 *    `MotionDurationChanged` timeline (genesis fallback), and the block timestamp is fetched on-chain.
 *  - MotionEnacted/Rejected/Canceled → guarded `advanceState` to `executed`/`defeated`/`canceled` +
 *    mirror the motion-meta state. Deferred (retried) when the motion's `proposal` has not derived yet.
 *  - MotionObjected → annotate the meta `objected` (proposal stays `active`); never a vote row.
 */
export class EasyTrackMotionProjectionApplier implements ProjectionDeriver {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['easy_track'] as const;
  readonly eventTypes = MOTION_EVENT_TYPES;

  private readonly logger: Logger;
  private readonly failures: ArchiveFailureRouter;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();

  constructor(private readonly deps: EasyTrackMotionProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.failures = new ArchiveFailureRouter({
      archive: deps.archive,
      dlq: deps.dlq,
      stage: EASY_TRACK_MOTION_PROJECTION_STAGE,
      source: 'indexer.easy_track_motion_projection',
      logEvent: 'easy_track_motion_derivation_failed',
      threshold: DLQ_THRESHOLD,
      logger: this.logger,
    });
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(rows);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const byKey = new Map(payloads.map((payload) => [archiveEventTupleKey(payload), payload]));

    // Only MotionCreated needs the on-chain block time (the objection-window start). easy_track is
    // mainnet-only, so the batch shares one chain.
    const createdRows = rows.filter((row) => row.event_type === 'MotionCreated');
    const blockTimestamps = await this.fetchCreatedTimestamps(createdRows);

    for (const row of rows) {
      const payload = byKey.get(archiveEventTupleKey(row));
      if (payload === undefined) {
        await this.fail(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      let event: MotionLifecycleEvent;
      try {
        event = parseMotionEvent(row.event_type, payload.payload);
      } catch (error) {
        await this.fail(row, 'decode_error', error);
        continue;
      }

      try {
        await this.apply(row, event, blockTimestamps);
      } catch (error) {
        await this.fail(row, 'projection_apply_error', error);
      }
    }
  }

  private async fetchCreatedTimestamps(
    createdRows: readonly ArchiveDerivationRow[],
  ): Promise<Map<string, Date>> {
    if (createdRows.length === 0) return new Map();
    const chainId = createdRows[0]!.chain_id;
    const chainCtx = this.deps.registry.peek(chainId);
    if (chainCtx === undefined) return new Map(); // each created row → block_timestamp_unavailable
    return this.blockTimestamps.fetchBatch(
      chainCtx,
      createdRows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
    );
  }

  private async apply(
    row: ArchiveDerivationRow,
    event: MotionLifecycleEvent,
    blockTimestamps: Map<string, Date>,
  ): Promise<void> {
    switch (event.type) {
      case 'MotionCreated':
        return this.applyCreated(row, event.payload, blockTimestamps);
      case 'MotionObjected':
        return this.applyObjected(row, event.payload.motionId);
      case 'MotionEnacted':
      case 'MotionRejected':
      case 'MotionCanceled':
        return this.applyTerminal(row, event.type, event.payload.motionId);
    }
  }

  private async applyCreated(
    row: ArchiveDerivationRow,
    payload: Extract<EasyTrackEvent, { type: 'MotionCreated' }>['payload'],
    blockTimestamps: Map<string, Date>,
  ): Promise<void> {
    const blockTimestamp = blockTimestamps.get(
      this.blockTimestamps.resultKey(row.block_number, row.block_hash),
    );
    if (blockTimestamp === undefined) {
      await this.fail(
        row,
        'block_timestamp_unavailable',
        new Error(`block timestamp unavailable for ${row.block_number}`),
      );
      return;
    }

    const durationSeconds =
      (await this.deps.payloads.findDurationAsOf(row.chain_id, row.block_number)) ??
      String(DEFAULT_MOTION_DURATION_SECONDS);
    const objectionEndsAt = new Date(blockTimestamp.getTime() + Number(durationSeconds) * 1000);

    const projection = projectMotionCreated(payload, {
      sourceType: row.source_type,
      blockNumber: row.block_number,
      blockTimestamp,
      objectionEndsAt,
      confirmedAt: row.received_at,
    });

    await this.transaction(async (repos) => {
      const daoId = await repos.proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

      const creator = await repos.actors.findOrCreateActorAddress(
        projection.creatorAddress,
        'proposer_event',
      );
      const result = await repos.proposals.insertProposal({
        ...projection.proposal,
        dao_id: daoId,
        proposer_actor_id: creator.id,
      });

      if (result.inserted) {
        await repos.motions.insert({ ...projection.meta, proposal_id: result.proposalId! });
        await this.insertMotionActions(repos, result.proposalId!, row.chain_id, payload.evmScript);
        this.record(row, 'derived', null);
      } else {
        this.record(row, 'skipped_idempotent', null);
      }
      await repos.archive.markDerived(row.id);
    });
  }

  // Decode the motion's enacting EVMScript into `proposal_action` rows. Best-effort: a malformed
  // top-level script (never produced by a real motion — the contract validates) logs and leaves the
  // proposal action-less; a DB write error propagates to fail the row. Inner calls degrade to opaque
  // leaves inside the decoder, so partial/unknown scripts still record every target.
  private async insertMotionActions(
    repos: ProjectionRepositories,
    proposalId: string,
    chainId: string,
    evmScript: string,
  ): Promise<void> {
    let actions: ProposalActionInput[];
    try {
      actions = toProposalActions(evmScript, chainId, EASY_TRACK_FORWARDERS);
    } catch (error) {
      if (error instanceof EvmScriptDecodeError) {
        this.logger.error('easy_track_evmscript_decode_failed', {
          proposal_id: proposalId,
          reason: error.reason,
        });
        return;
      }
      throw error;
    }
    if (actions.length > 0) await repos.proposals.insertActions(proposalId, actions);
  }

  private async applyObjected(row: ArchiveDerivationRow, motionId: string): Promise<void> {
    await this.transaction(async (repos) => {
      const proposal = await this.findMotionProposal(repos, row, motionId);
      if (proposal === undefined) {
        this.record(row, 'deferred', null); // its MotionCreated has not derived yet
        return;
      }
      await repos.motions.annotateObjected(proposal.id);
      this.record(row, 'derived', null);
      await repos.archive.markDerived(row.id);
    });
  }

  private async applyTerminal(
    row: ArchiveDerivationRow,
    eventType: MotionTerminalEvent,
    motionId: string,
  ): Promise<void> {
    const transition = MOTION_TERMINAL_TRANSITIONS[eventType];
    await this.transaction(async (repos) => {
      const proposal = await this.findMotionProposal(repos, row, motionId);
      if (proposal === undefined) {
        this.record(row, 'deferred', null); // its MotionCreated has not derived yet
        return;
      }
      const advanced = await repos.proposals.advanceState({
        daoId: proposal.dao_id,
        sourceType: row.source_type,
        sourceId: motionId,
        targetState: transition.proposalState,
        stateUpdatedAt: row.received_at,
      });
      await repos.motions.setState(proposal.id, transition.motionState);
      this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);
      await repos.archive.markDerived(row.id);
    });
  }

  private async findMotionProposal(
    repos: ProjectionRepositories,
    row: ArchiveDerivationRow,
    motionId: string,
  ): Promise<{ id: string; dao_id: string } | undefined> {
    const daoId = await repos.proposals.findDaoIdForSource(row.dao_source_id);
    if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);
    return repos.proposals.findBySource({ daoId, sourceType: row.source_type, sourceId: motionId });
  }

  private async transaction(fn: (repos: ProjectionRepositories) => Promise<void>): Promise<void> {
    return this.deps.pgDb.transaction().execute((tx) =>
      fn({
        actors: new ActorRepository(tx),
        proposals: new ProposalRepository(tx),
        motions: new EasyTrackMotionRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
  }

  private async fail(
    row: ArchiveDerivationRow,
    reason: EasyTrackMotionFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.failures.route(row, reason, error);
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: EasyTrackMotionOutcome,
    reason: EasyTrackMotionFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseMotionEvent(eventType: string, payloadJson: string): MotionLifecycleEvent {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  switch (eventType) {
    case 'MotionCreated':
      return { type: 'MotionCreated', payload: payload as never };
    case 'MotionObjected':
      return { type: 'MotionObjected', payload: payload as never };
    case 'MotionEnacted':
      return { type: 'MotionEnacted', payload: payload as never };
    case 'MotionRejected':
      return { type: 'MotionRejected', payload: payload as never };
    case 'MotionCanceled':
      return { type: 'MotionCanceled', payload: payload as never };
    default:
      throw new Error(`unsupported easy track motion event_type ${eventType}`);
  }
}
