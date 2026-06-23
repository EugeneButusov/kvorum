import type { ChainContextRegistry, Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import {
  ArchiveFailureRouter,
  VoteBlockTimestampFetcher,
  ProjectionError,
  archiveEventTupleKey,
  buildVoteRows,
  isNewerVote,
} from '@sources/core';
import type { CastVotePayload } from './types';
import { projectAragonVoteCast } from './vote-projector';
import type { AragonVotingArchivePayloadRepository } from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['VOTE_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const VOTE_PROJECTION_STAGE = 'vote_projection_stage';

export type AragonVoteDerivationOutcome =
  | 'derived'
  | 'skipped_idempotent'
  | 'skipped_objection_marker'
  | 'failed';

export type AragonVoteDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'no_proposal'
  | 'block_timestamp_unavailable';

export interface AragonVoteProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  chWriteSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AragonVoteDerivationOutcome;
    reason: AragonVoteDerivationFailureReason | null;
  }): void;
}

export interface AragonVoteProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AragonVotingArchivePayloadRepository;
  proposals: ProposalRepository;
  voteRead: VoteEventsProjectionReadRepository;
  voteWrite: VoteEventsProjectionWriter;
  registry: ChainContextRegistry;
  metrics: AragonVoteProjectionMetrics;
  logger?: Logger;
}

/**
 * Projects Lido Aragon votes into CH `vote_events_raw`.
 *
 *  - CastVote      → one vote row (`voting_power = stake`, `primary_choice` from
 *    `supports`); ADR-021 supersession via buildVoteRows covers main-phase
 *    re-votes AND objection-phase Yes→No flips identically.
 *  - CastObjection → phase marker; co-fires with CastVote(supports=false) so it
 *    yields NO vote row. The `skipped_objection_marker` metric (labelled
 *    event_type=CastObjection) is the non-silent signal: ops compare its count to
 *    CastVote(false) to detect any non-co-firing objection.
 */
export class AragonVoteProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aragon_voting'] as const;
  readonly eventTypes = ['CastVote', 'CastObjection'] as const;

  private readonly logger: Logger;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();
  private readonly failures: ArchiveFailureRouter;

  constructor(private readonly deps: AragonVoteProjectionApplierDeps) {
    this.logger = deps.logger ?? silentLogger;
    this.failures = new ArchiveFailureRouter({
      archive: deps.archive,
      dlq: deps.dlq,
      stage: VOTE_PROJECTION_STAGE,
      source: 'indexer.vote_projection',
      logEvent: 'aragon_vote_derivation_failed',
      threshold: DLQ_THRESHOLD,
      logger: this.logger,
    });
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    // Objection markers carry no vote row and need no block timestamp — drain them
    // first so a missing chain context never wrongly fails them.
    const objections = rows.filter((row) => row.event_type === 'CastObjection');
    const castVotes = rows.filter((row) => row.event_type === 'CastVote');

    for (const row of objections) {
      this.record(row, 'skipped_objection_marker', null);
      try {
        await this.deps.archive.markDerived(row.id);
      } catch (error) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', error);
      }
    }

    if (castVotes.length === 0) return;

    const chainId = castVotes[0]!.chain_id;
    const chainCtx = this.deps.registry.peek(chainId);
    if (chainCtx === undefined) {
      for (const row of castVotes) {
        await this.failAndMaybeDlq(
          row,
          'block_timestamp_unavailable',
          new Error('chain context missing'),
        );
      }
      return;
    }

    const lookupStartedAt = Date.now();
    const payloads = await this.deps.payloads.fetchPayloads(castVotes);
    this.deps.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(
      payloads.map((payload) => [archiveEventTupleKey(payload), payload]),
    );

    const timestamps = await this.blockTimestamps.fetchBatch(
      chainCtx,
      castVotes.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
    );

    for (const row of castVotes) {
      const payload = payloadByKey.get(archiveEventTupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }

      const castAt = timestamps.get(
        this.blockTimestamps.resultKey(row.block_number, row.block_hash),
      );
      if (castAt === undefined) {
        await this.failAndMaybeDlq(
          row,
          'block_timestamp_unavailable',
          new Error(`block timestamp unavailable for ${row.block_number}`),
        );
        continue;
      }

      await this.apply(row, payload.payload, castAt);
    }
  }

  private async apply(row: ArchiveDerivationRow, payloadJson: string, castAt: Date): Promise<void> {
    let event: CastVotePayload;
    try {
      event = JSON.parse(payloadJson) as CastVotePayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    try {
      const daoId = await this.deps.proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) throw new Error(`unknown dao_source ${row.dao_source_id}`);

      const proposal = await this.deps.proposals.findBySource({
        daoId,
        sourceType: row.source_type,
        sourceId: event.voteId,
      });
      if (proposal === undefined) throw new ProjectionError('no_proposal');

      const voterAddress = event.voter.toLowerCase();
      const current = await this.deps.voteRead.findCurrentVote({
        daoId,
        proposalId: proposal.id,
        voterAddress,
      });
      // Re-deriving the already-current row is a no-op, not a supersession (else
      // buildVoteRows emits a self-superseding row that collapses to zero current).
      if (current !== undefined && current.vote_id === row.id) {
        await this.deps.archive.markDerived(row.id);
        this.record(row, 'skipped_idempotent', null);
        return;
      }

      const incoming = projectAragonVoteCast(event);
      const incomingIsNewer = isNewerVote(castAt, row.block_number, row.log_index, current);
      const voteRows = buildVoteRows({
        row,
        daoId,
        proposalId: proposal.id,
        voterAddress,
        castAt,
        incoming,
        current,
        incomingIsNewer,
      });

      const writeStartedAt = Date.now();
      await this.deps.voteWrite.insertBatch(voteRows);
      this.deps.metrics.chWriteSeconds((Date.now() - writeStartedAt) / 1000);

      try {
        await this.deps.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return;
      }

      this.record(row, incomingIsNewer ? 'derived' : 'skipped_idempotent', null);
    } catch (error) {
      const reason: AragonVoteDerivationFailureReason =
        error instanceof ProjectionError && error.reason === 'no_proposal'
          ? 'no_proposal'
          : 'projection_apply_error';
      await this.failAndMaybeDlq(row, reason, error);
    }
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: AragonVoteDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.failures.route(row, reason, error);
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: AragonVoteDerivationOutcome,
    reason: AragonVoteDerivationFailureReason | null,
  ): void {
    this.deps.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}
