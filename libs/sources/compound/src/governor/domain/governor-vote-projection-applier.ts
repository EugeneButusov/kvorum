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
  VoteBlockTimestampFetcher,
  ProjectionError,
  buildVoteRows,
  isNewerVote,
} from '@sources/core';
import type { VoteCastPayload } from './types';
import {
  GovernorArchivePayloadRepository,
  type GovernorArchivePayloadRow,
} from '../persistence/governor-archive-payload-repository';

const DEFAULT_BATCH_SIZE = 25;
const DLQ_THRESHOLD = Number(process.env['VOTE_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const VOTE_PROJECTION_STAGE = 'vote_projection_stage';

export type CompoundVoteDerivationOutcome = 'derived' | 'skipped_idempotent' | 'failed';
export type CompoundVoteDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'no_proposal'
  | 'block_timestamp_unavailable';

export interface GovernorVoteProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  chWriteSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: CompoundVoteDerivationOutcome;
    reason: CompoundVoteDerivationFailureReason | null;
  }): void;
}

export interface GovernorVoteProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: GovernorArchivePayloadRepository;
  proposals: ProposalRepository;
  voteRead: VoteEventsProjectionReadRepository;
  voteWrite: VoteEventsProjectionWriter;
  metrics: GovernorVoteProjectionMetrics;
  registry: ChainContextRegistry;
  logger?: Logger;
}

export class GovernorVoteProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = [
    'compound_governor_bravo',
    'compound_governor_alpha',
    'compound_governor_oz',
  ] as const;
  readonly eventTypes = ['VoteCast'] as const;

  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: GovernorArchivePayloadRepository;
  private readonly proposals: ProposalRepository;
  private readonly metrics: GovernorVoteProjectionMetrics;
  private readonly registry: ChainContextRegistry;
  private readonly logger: Logger;
  private readonly voteEventsProjectionReadRepository: VoteEventsProjectionReadRepository;
  private readonly voteEventsProjectionWriter: VoteEventsProjectionWriter;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();

  constructor(deps: GovernorVoteProjectionApplierDeps) {
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.proposals = deps.proposals;
    this.metrics = deps.metrics;
    this.registry = deps.registry;
    this.logger = deps.logger ?? silentLogger;
    this.voteEventsProjectionReadRepository = deps.voteRead;
    this.voteEventsProjectionWriter = deps.voteWrite;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const cappedRows = rows.slice(
      0,
      Number(process.env['VOTE_DERIVATION_BATCH_SIZE'] ?? DEFAULT_BATCH_SIZE),
    );
    const chainId = cappedRows[0]!.chain_id;
    const chainCtx = this.registry.peek(chainId);
    if (chainCtx === undefined) {
      for (const row of cappedRows) {
        await this.failAndMaybeDlq(
          row,
          'block_timestamp_unavailable',
          new Error('chain context missing'),
        );
      }
      return;
    }

    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(cappedRows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    const timestamps = await this.blockTimestamps.fetchBatch(
      chainCtx,
      cappedRows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
    );

    for (const row of cappedRows) {
      const payload = payloadByKey.get(tupleKey(row));
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

      await this.apply(row, payload, castAt);
    }
  }

  private async apply(
    row: ArchiveDerivationRow,
    payload: GovernorArchivePayloadRow,
    castAt: Date,
  ): Promise<void> {
    let event: VoteCastPayload;
    try {
      event = parseVoteCastPayload(payload.payload);
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    try {
      const daoId = await this.proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) {
        throw new Error(`unknown dao_source ${row.dao_source_id}`);
      }
      const proposal = await this.proposals.findBySource({
        daoId,
        sourceType: row.source_type,
        sourceId: event.proposalId,
      });
      if (proposal === undefined) throw new ProjectionError('no_proposal');

      const voterAddress = event.voter.toLowerCase();
      const current = await this.voteEventsProjectionReadRepository.findCurrentVote({
        daoId,
        proposalId: proposal.id,
        voterAddress,
      });
      // Re-deriving the row that is already current is a no-op, not a supersession.
      // Without this guard, buildVoteRows emits a self-superseding row (superseded=1,
      // superseded_by=self), which collapses the vote to zero superseded=0 rows under FINAL.
      if (current !== undefined && current.vote_id === row.id) {
        await this.archive.markDerived(row.id);
        this.record(row, 'skipped_idempotent', null);
        return;
      }
      const incomingIsNewer = isNewerVote(castAt, row.block_number, row.log_index, current);
      const rows = buildVoteRows({
        row,
        daoId,
        proposalId: proposal.id,
        voterAddress,
        castAt,
        incoming: {
          primaryChoice: event.primaryChoice,
          votingPower: event.votingPowerReported,
        },
        current,
        incomingIsNewer,
      });

      const writeStartedAt = Date.now();
      await this.voteEventsProjectionWriter.insertBatch(rows);
      this.metrics.chWriteSeconds((Date.now() - writeStartedAt) / 1000);

      try {
        await this.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return;
      }

      this.record(row, incomingIsNewer ? 'derived' : 'skipped_idempotent', null);
    } catch (error) {
      const reason: CompoundVoteDerivationFailureReason =
        error instanceof ProjectionError && error.reason === 'no_proposal'
          ? 'no_proposal'
          : 'projection_apply_error';
      await this.failAndMaybeDlq(row, reason, error);
    }
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: CompoundVoteDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('vote_derivation_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      chain_id: row.chain_id,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      block_hash: row.block_hash,
      attempt,
      reason,
      error: String(error),
    });

    if (attempt < DLQ_THRESHOLD) return;

    await this.dlq.insert({
      stage: VOTE_PROJECTION_STAGE,
      source: 'indexer.vote_projection',
      payload: {
        id: row.id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
      },
      error: { message: String(error) },
      retries: attempt,
      first_seen_at: new Date(),
      last_attempt_at: new Date(),
      archive_source_type: row.source_type,
      archive_chain_id: row.chain_id,
      archive_tx_hash: row.tx_hash,
      archive_log_index: row.log_index,
      archive_block_hash: row.block_hash,
    });
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: CompoundVoteDerivationOutcome,
    reason: CompoundVoteDerivationFailureReason | null,
  ): void {
    this.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseVoteCastPayload(payloadJson: string): VoteCastPayload {
  return JSON.parse(payloadJson) as VoteCastPayload;
}

function tupleKey(
  row:
    | ArchiveDerivationRow
    | Pick<GovernorArchivePayloadRow, 'chain_id' | 'tx_hash' | 'log_index' | 'block_hash'>,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
