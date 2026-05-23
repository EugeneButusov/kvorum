import type { Kysely } from 'kysely';
import type { ChainContextRegistry, Logger } from '@libs/chain';
import { silentLogger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  type ClickHouseDatabase,
  DlqRepository,
  ProposalRepository,
  type PgDatabase,
  VoteRepository,
} from '@libs/db';
import type { VoteCastPayload } from './types';
import { VoteBlockTimestampFetcher } from './vote-block-timestamp';
import { projectVoteCast } from './vote-projector';
import {
  GovernorArchivePayloadRepository,
  type GovernorArchivePayloadRow,
} from '../persistence/governor-archive-payload-repository';

const DEFAULT_BATCH_SIZE = 25;
const DLQ_THRESHOLD = Number(process.env['VOTE_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const VOTE_PROJECTION_STAGE = 'vote_projection_stage';

export type CompoundVoteDerivationOutcome = 'derived' | 'skipped_idempotent' | 'failed';
export type CompoundVoteDerivationFailureReason =
  | 'ch_missing'
  | 'decode_error'
  | 'pg_tx_error'
  | 'no_proposal'
  | 'no_voter'
  | 'block_timestamp_unavailable';

export interface GovernorVoteProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: CompoundVoteDerivationOutcome;
    reason: CompoundVoteDerivationFailureReason | null;
  }): void;
}

export interface GovernorVoteProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  chDb: Kysely<ClickHouseDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: GovernorArchivePayloadRepository;
  metrics: GovernorVoteProjectionMetrics;
  registry: ChainContextRegistry;
  logger?: Logger;
}

interface VoteProjectionRepositories {
  proposals: ProposalRepository;
  actors: ActorRepository;
  votes: VoteRepository;
  archive: ArchiveDerivationRepository;
}

class ProjectionError extends Error {
  constructor(public readonly reason: 'no_proposal' | 'no_voter') {
    super(reason);
  }
}

export class GovernorVoteProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = [
    'compound_governor_bravo',
    'compound_governor_alpha',
    'compound_governor_oz',
  ] as const;
  readonly eventTypes = ['VoteCast'] as const;

  private readonly pgDb: Kysely<PgDatabase>;
  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: GovernorArchivePayloadRepository;
  private readonly metrics: GovernorVoteProjectionMetrics;
  private readonly registry: ChainContextRegistry;
  private readonly logger: Logger;
  private readonly blockTimestamps = new VoteBlockTimestampFetcher();

  constructor(deps: GovernorVoteProjectionApplierDeps) {
    this.pgDb = deps.pgDb;
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.metrics = deps.metrics;
    this.registry = deps.registry;
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const cappedRows = rows.slice(
      0,
      Number(process.env['VOTE_DERIVATION_BATCH_SIZE'] ?? DEFAULT_BATCH_SIZE),
    );
    const chainId = cappedRows[0]!.chain_id;
    for (const row of cappedRows) {
      if (row.chain_id !== chainId) {
        throw new Error(`vote applier received mixed-chain batch: ${chainId} vs ${row.chain_id}`);
      }
    }

    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(cappedRows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

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

    const timestamps = await this.blockTimestamps.fetchBatch(chainCtx, [
      ...new Set(cappedRows.map((row) => row.block_number)),
    ]);

    for (const row of cappedRows) {
      const payload = payloadByKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'ch_missing', new Error('archive payload missing'));
        continue;
      }

      const castAt = timestamps.get(row.block_number);
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
      await this.transaction(async ({ proposals, actors, votes, archive }) => {
        const daoId = await proposals.findDaoIdForSource(row.dao_source_id);
        if (daoId === undefined) {
          throw new Error(`unknown dao_source ${row.dao_source_id}`);
        }

        const proposalId = await proposals.findIdBySource(daoId, row.source_type, event.proposalId);
        if (proposalId === undefined) {
          throw new ProjectionError('no_proposal');
        }

        const voterActorId = await actors.findIdByAddress(event.voter);
        if (voterActorId === undefined) {
          throw new ProjectionError('no_voter');
        }

        const projection = projectVoteCast(event, row, {
          castAt,
          voterActorId,
          proposalId,
        });

        const { inserted, voteId } = await votes.insertVote(projection.vote);
        if (inserted && voteId !== undefined) {
          await votes.insertVoteChoice(voteId, projection.choice);
          this.record(row, 'derived', null);
        } else {
          this.record(row, 'skipped_idempotent', null);
        }

        await archive.markDerived(row.id);
      });
    } catch (error) {
      const reason = error instanceof ProjectionError ? error.reason : 'pg_tx_error';
      await this.failAndMaybeDlq(row, reason, error);
    }
  }

  private async transaction<T>(
    fn: (repositories: VoteProjectionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.pgDb.transaction().execute((tx) =>
      fn({
        proposals: new ProposalRepository(tx),
        actors: new ActorRepository(tx),
        votes: new VoteRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
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
