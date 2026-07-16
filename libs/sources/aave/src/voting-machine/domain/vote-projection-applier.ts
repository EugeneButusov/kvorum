import { silentLogger, type ChainContextRegistry, type Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  DlqRepository,
  ProposalRepository,
  VoteEventsProjectionReadRepository,
  VoteEventsProjectionWriter,
} from '@libs/db';
import { VoteBlockTimestampFetcher, buildVoteRows, isNewerVote } from '@sources/core';
import type { ProposalVoteStartedPayload, VoteEmittedPayload } from './types';
import { projectAaveVote } from './vote-projector';
import { AaveProposalRepository } from '../../persistence/aave-proposal-repository';
import {
  AaveVotingMachineArchivePayloadRepository,
  type AaveVotingMachineArchivePayloadRow,
} from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['VOTE_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const VOTE_PROJECTION_STAGE = 'aave_vote_projection_stage';
const AAVE_PROPOSAL_SOURCE_TYPE = 'aave_governance_v3';
const HOLD_LOG_INTERVAL_MS = 30_000;
/** How long a vote awaiting its mainnet proposal steps aside for (KNOWN-028). */
const STITCH_HOLD_BACKOFF_MS = Number(process.env['AAVE_STITCH_HOLD_BACKOFF_MS'] ?? '60000');

export type AaveVoteDerivationOutcome =
  | 'derived'
  | 'skipped_idempotent'
  | 'failed'
  | 'held'
  | 'noop';
export type AaveVoteDerivationFailureReason =
  | 'decode_error'
  | 'payload_missing'
  | 'block_timestamp_unavailable'
  | 'watermark_update_error'
  | 'projection_apply_error'
  | 'no_proposal'
  | 'single_voting_chain_violation';

export interface AaveVoteProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  chWriteSeconds(seconds: number): void;
  stitchPendingSeconds?(
    seconds: number,
    labels: { voting_chain_id: string; event_type: string },
  ): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AaveVoteDerivationOutcome;
    reason: AaveVoteDerivationFailureReason | null;
  }): void;
}

export interface AaveVoteProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AaveVotingMachineArchivePayloadRepository;
  proposals: ProposalRepository;
  aaveProposals: AaveProposalRepository;
  voteRead: VoteEventsProjectionReadRepository;
  voteWrite: VoteEventsProjectionWriter;
  metrics: AaveVoteProjectionMetrics;
  registry: ChainContextRegistry;
  logger?: Logger;
}

export class AaveVoteProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aave_voting_machine'] as const;
  readonly eventTypes = [
    'VoteEmitted',
    'ProposalVoteStarted',
    'ProposalResultsSent',
    'ProposalVoteConfigurationBridged',
  ] as const;

  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: AaveVotingMachineArchivePayloadRepository;
  private readonly proposals: ProposalRepository;
  private readonly aaveProposals: AaveProposalRepository;
  private readonly voteRead: VoteEventsProjectionReadRepository;
  private readonly voteWrite: VoteEventsProjectionWriter;
  private readonly metrics: AaveVoteProjectionMetrics;
  private readonly registry: ChainContextRegistry;
  private readonly logger: Logger;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();
  private readonly lastHoldLogByKey = new Map<string, number>();

  constructor(deps: AaveVoteProjectionApplierDeps) {
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.proposals = deps.proposals;
    this.aaveProposals = deps.aaveProposals;
    this.voteRead = deps.voteRead;
    this.voteWrite = deps.voteWrite;
    this.metrics = deps.metrics;
    this.registry = deps.registry;
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const firstRow = rows[0];
    if (firstRow === undefined) return;

    // A held `no_proposal` row no longer blocks the head of its batch: the hold stamps
    // `derivation_hold_until`, so the derivable queries skip the row until the back-off elapses and
    // newer votes on the same chain keep flowing (was KNOWN-028; see markHeld + migration 0010).
    // See `docs/runbooks/m3-chains.md` ("Aave stitch-hold alerting").
    if (
      firstRow.event_type === 'ProposalResultsSent' ||
      firstRow.event_type === 'ProposalVoteConfigurationBridged'
    ) {
      for (const row of rows) await this.applyNoop(row);
      return;
    }

    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(rows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    const votingMachineAddress = await this.aaveProposals.findVotingMachineAddress(
      firstRow.dao_source_id,
    );
    if (votingMachineAddress === undefined) {
      for (const row of rows) {
        await this.failAndMaybeDlq(
          row,
          'projection_apply_error',
          new Error(`voting_machine_address missing for dao_source ${row.dao_source_id}`),
        );
      }
      return;
    }

    if (firstRow.event_type === 'ProposalVoteStarted') {
      let pendingMaxSeconds = 0;
      for (const row of rows) {
        const payload = payloadByKey.get(tupleKey(row));
        if (payload === undefined) {
          await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
          continue;
        }
        const ageSeconds = await this.applyVoteStarted(row, payload, votingMachineAddress);
        if (ageSeconds !== undefined) pendingMaxSeconds = Math.max(pendingMaxSeconds, ageSeconds);
      }
      this.recordStitchPendingSeconds(firstRow, pendingMaxSeconds);
      return;
    }

    const chainCtx = this.registry.peek(firstRow.chain_id);
    if (chainCtx === undefined) {
      for (const row of rows) {
        await this.failAndMaybeDlq(
          row,
          'block_timestamp_unavailable',
          new Error('chain context missing'),
        );
      }
      return;
    }

    const timestamps = await this.blockTimestamps.fetchBatch(
      chainCtx,
      rows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash })),
    );

    let pendingMaxSeconds = 0;
    for (const row of rows) {
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

      const ageSeconds = await this.applyVote(row, payload, castAt, votingMachineAddress);
      if (ageSeconds !== undefined) pendingMaxSeconds = Math.max(pendingMaxSeconds, ageSeconds);
    }
    this.recordStitchPendingSeconds(firstRow, pendingMaxSeconds);
  }

  private async applyNoop(row: ArchiveDerivationRow): Promise<void> {
    if (row.event_type === 'ProposalResultsSent') {
      this.logger.info('aave_voting_results_sent', {
        row_id: row.id,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
      });
    }

    try {
      await this.archive.markDerived(row.id);
      this.record(row, 'noop', null);
    } catch (error) {
      await this.failAndMaybeDlq(row, 'watermark_update_error', error);
    }
  }

  private async applyVote(
    row: ArchiveDerivationRow,
    payloadRow: AaveVotingMachineArchivePayloadRow,
    castAt: Date,
    votingMachineAddress: string,
  ): Promise<number | undefined> {
    let payload: VoteEmittedPayload;
    try {
      payload = JSON.parse(payloadRow.payload) as VoteEmittedPayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return undefined;
    }

    try {
      const daoId = await this.proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) {
        throw new Error(`unknown dao_source ${row.dao_source_id}`);
      }
      const proposal = await this.proposals.findBySource({
        daoId,
        sourceType: AAVE_PROPOSAL_SOURCE_TYPE,
        sourceId: payload.proposalId,
      });
      if (proposal === undefined) {
        this.record(row, 'held', 'no_proposal');
        // Defer rather than spin (KNOWN-028) — see markHeld. The mainnet proposal may sit at a
        // higher block during a backfill, so holding the queue head would prevent it from deriving.
        await this.archive.markHeld(row.id, new Date(Date.now() + STITCH_HOLD_BACKOFF_MS));
        return (Date.now() - row.received_at.getTime()) / 1000;
      }

      const voterAddress = payload.voter.toLowerCase();
      const current = await this.voteRead.findCurrentVote({
        daoId,
        proposalId: proposal.id,
        voterAddress,
      });
      if (current?.vote_id === row.id) {
        await this.archive.markDerived(row.id);
        this.record(row, 'skipped_idempotent', null);
        return undefined;
      }
      if (current !== undefined && current.voting_chain_id !== row.chain_id) {
        this.record(row, 'failed', 'single_voting_chain_violation');
        this.logger.error('aave_vote_single_voting_chain_violation', {
          row_id: row.id,
          proposal_id: proposal.id,
          voter_address: voterAddress,
          current_voting_chain_id: current.voting_chain_id,
          incoming_voting_chain_id: row.chain_id,
        });
        return undefined;
      }

      const incomingIsNewer = isNewerVote(castAt, row.block_number, row.log_index, current);
      const rows = buildVoteRows({
        row,
        daoId,
        proposalId: proposal.id,
        voterAddress,
        castAt,
        incoming: projectAaveVote(payload),
        current,
        incomingIsNewer,
      });

      const writeStartedAt = Date.now();
      await this.voteWrite.insertBatch(rows);
      this.metrics.chWriteSeconds((Date.now() - writeStartedAt) / 1000);

      if (current === undefined) {
        await this.aaveProposals.setVotingChainBinding(proposal.id, {
          votingChainId: row.chain_id,
          votingMachineAddress,
        });
      }

      try {
        await this.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return undefined;
      }

      this.record(row, incomingIsNewer ? 'derived' : 'skipped_idempotent', null);
      return undefined;
    } catch (error) {
      const reason = 'projection_apply_error';
      await this.failAndMaybeDlq(row, reason, error);
      return undefined;
    }
  }

  private async applyVoteStarted(
    row: ArchiveDerivationRow,
    payloadRow: AaveVotingMachineArchivePayloadRow,
    votingMachineAddress: string,
  ): Promise<number | undefined> {
    let payload: ProposalVoteStartedPayload;
    try {
      payload = JSON.parse(payloadRow.payload) as ProposalVoteStartedPayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return undefined;
    }

    try {
      const daoId = await this.proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) {
        throw new Error(`unknown dao_source ${row.dao_source_id}`);
      }
      const proposal = await this.proposals.findBySource({
        daoId,
        sourceType: AAVE_PROPOSAL_SOURCE_TYPE,
        sourceId: payload.proposalId,
      });
      if (proposal === undefined) {
        this.record(row, 'held', 'no_proposal');
        // Defer rather than spin (KNOWN-028) — see markHeld.
        await this.archive.markHeld(row.id, new Date(Date.now() + STITCH_HOLD_BACKOFF_MS));
        return (Date.now() - row.received_at.getTime()) / 1000;
      }

      await this.aaveProposals.setVotingChainBinding(proposal.id, {
        votingChainId: row.chain_id,
        votingMachineAddress,
      });

      // The voting machine reports the window it actually enforces, so this is the authoritative
      // measurement and overwrites the estimate the mainnet VotingActivated handler derives from
      // activation-block time + votingDuration. Mainnet activation is observed first (the voting
      // chain learns of it only after the bridge relays), so a coalescing write would let the
      // estimate win on every proposal.
      await this.proposals.setVotingWindow(proposal.id, {
        votingStartsAt: votingWindowDate(payload.startTime),
        votingEndsAt: votingWindowDate(payload.endTime),
      });

      try {
        await this.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return undefined;
      }

      this.record(row, 'derived', null);
      return undefined;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'projection_apply_error', error);
      return undefined;
    }
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: Exclude<
      AaveVoteDerivationFailureReason,
      'no_proposal' | 'single_voting_chain_violation'
    >,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('aave_vote_derivation_failed', {
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
      source: 'indexer.aave_vote_projection',
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

  private recordStitchPendingSeconds(row: ArchiveDerivationRow, pendingMaxSeconds: number): void {
    this.metrics.stitchPendingSeconds?.(pendingMaxSeconds, {
      voting_chain_id: row.chain_id,
      event_type: row.event_type,
    });
    this.maybeLogHold(row, pendingMaxSeconds);
  }

  private maybeLogHold(row: ArchiveDerivationRow, pendingMaxSeconds: number): void {
    if (pendingMaxSeconds <= 0) return;

    const key = `${row.chain_id}:${row.event_type}`;
    const nowMs = Date.now();
    const lastLoggedAt = this.lastHoldLogByKey.get(key) ?? 0;
    if (nowMs - lastLoggedAt < HOLD_LOG_INTERVAL_MS) return;

    this.lastHoldLogByKey.set(key, nowMs);
    this.logger.info('aave_vote_stitch_held', {
      chain_id: row.chain_id,
      event_type: row.event_type,
      oldest_pending_seconds: pendingMaxSeconds,
    });
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: AaveVoteDerivationOutcome,
    reason: AaveVoteDerivationFailureReason | null,
  ): void {
    this.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function tupleKey(
  row:
    | ArchiveDerivationRow
    | Pick<AaveVotingMachineArchivePayloadRow, 'chain_id' | 'tx_hash' | 'log_index' | 'block_hash'>,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}

/**
 * `ProposalVoteStarted(…, uint256 startTime, uint256 endTime)` reports unix seconds, decoded to a
 * base-10 string. Returns null for anything that is not a plausible instant — a uint256 can hold
 * values far beyond `Date`'s range, and `fillTimestamps` treats null as "leave the column alone",
 * so a nonsensical value yields no write rather than a bogus date.
 */
function votingWindowDate(unixSeconds: string): Date | null {
  const seconds = Number(unixSeconds);
  if (Number.isSafeInteger(seconds) === false || seconds <= 0) return null;
  const at = new Date(seconds * 1000);
  return Number.isNaN(at.getTime()) ? null : at;
}
