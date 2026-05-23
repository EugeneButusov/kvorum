import type { Kysely } from 'kysely';
import { silentLogger, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  type ClickHouseDatabase,
  DelegationRepository,
  DlqRepository,
  type NewDelegation,
  type PgDatabase,
  ProposalRepository,
} from '@libs/db';
import {
  projectDelegateChanged,
  projectDelegateVotesChanged,
  ZERO_ADDRESS,
} from './delegation-projector';
import type { DelegateChangedPayload, DelegateVotesChangedPayload } from './types';
import {
  CompTokenArchivePayloadRepository,
  type CompTokenArchivePayloadRow,
} from '../persistence/comp-token-archive-payload-repository';

const DEFAULT_BATCH_SIZE = 50;
const DLQ_THRESHOLD = Number(process.env['DELEGATION_PROJECTION_DLQ_THRESHOLD'] ?? '5');
const DELEGATION_PROJECTION_STAGE = 'delegation_projection_stage';

export type CompTokenDelegationDerivationOutcome = 'derived' | 'failed';
export type CompTokenDelegationDerivationFailureReason =
  | 'ch_missing'
  | 'decode_error'
  | 'pg_tx_error'
  | 'no_dao'
  | 'no_delegator'
  | 'no_delegate'
  | 'unknown_event_type';

export interface CompTokenDelegationProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: CompTokenDelegationDerivationOutcome;
    reason: CompTokenDelegationDerivationFailureReason | null;
  }): void;
}

export interface CompTokenDelegationProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  chDb: Kysely<ClickHouseDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: CompTokenArchivePayloadRepository;
  metrics: CompTokenDelegationProjectionMetrics;
  logger?: Logger;
}

interface DelegationProjectionRepositories {
  proposals: ProposalRepository;
  actors: ActorRepository;
  delegations: DelegationRepository;
  archive: ArchiveDerivationRepository;
}

class ProjectionError extends Error {
  constructor(
    public readonly reason: 'no_dao' | 'no_delegator' | 'no_delegate' | 'unknown_event_type',
  ) {
    super(reason);
  }
}

export class CompTokenDelegationProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['compound_comp_token'] as const;
  readonly eventTypes = ['DelegateChanged', 'DelegateVotesChanged'] as const;

  private readonly pgDb: Kysely<PgDatabase>;
  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: CompTokenArchivePayloadRepository;
  private readonly metrics: CompTokenDelegationProjectionMetrics;
  private readonly logger: Logger;

  constructor(deps: CompTokenDelegationProjectionApplierDeps) {
    this.pgDb = deps.pgDb;
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const cappedRows = rows.slice(
      0,
      Number(process.env['DELEGATION_PROJECTION_BATCH_SIZE'] ?? DEFAULT_BATCH_SIZE),
    );

    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(cappedRows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    for (const row of cappedRows) {
      const payload = payloadByKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'ch_missing', new Error('archive payload missing'));
        continue;
      }
      await this.apply(row, payload);
    }
  }

  private async apply(
    row: ArchiveDerivationRow,
    payload: CompTokenArchivePayloadRow,
  ): Promise<void> {
    let parsed: DelegateChangedPayload | DelegateVotesChangedPayload;
    try {
      parsed = JSON.parse(payload.payload) as DelegateChangedPayload | DelegateVotesChangedPayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    try {
      await this.transaction(async ({ proposals, actors, delegations, archive }) => {
        const daoId = await proposals.findDaoIdForSource(row.dao_source_id);
        if (daoId === undefined) throw new ProjectionError('no_dao');

        let projection: NewDelegation;
        if (row.event_type === 'DelegateChanged') {
          const event = parsed as DelegateChangedPayload;
          const delegatorActor = await actors.findByAddress(event.delegator);
          if (delegatorActor === undefined) throw new ProjectionError('no_delegator');

          let delegateActorId: string | null = null;
          if (event.toDelegate !== ZERO_ADDRESS) {
            const delegateActor = await actors.findByAddress(event.toDelegate);
            if (delegateActor === undefined) throw new ProjectionError('no_delegate');
            delegateActorId = delegateActor.id;
          }

          projection = projectDelegateChanged(event, row, {
            daoId,
            delegatorActorId: delegatorActor.id,
            delegateActorId,
          });
        } else if (row.event_type === 'DelegateVotesChanged') {
          const event = parsed as DelegateVotesChangedPayload;
          const delegateActor = await actors.findByAddress(event.delegate);
          if (delegateActor === undefined) throw new ProjectionError('no_delegate');
          projection = projectDelegateVotesChanged(event, row, {
            daoId,
            delegateActorId: delegateActor.id,
          });
        } else {
          throw new ProjectionError('unknown_event_type');
        }

        await delegations.insert(projection);
        await archive.markDerived(row.id);
        this.record(row, 'derived', null);
      });
    } catch (error) {
      const reason = error instanceof ProjectionError ? error.reason : 'pg_tx_error';
      await this.failAndMaybeDlq(row, reason, error);
    }
  }

  private async transaction<T>(
    fn: (repositories: DelegationProjectionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.pgDb.transaction().execute((tx) =>
      fn({
        proposals: new ProposalRepository(tx),
        actors: new ActorRepository(tx),
        delegations: new DelegationRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: CompTokenDelegationDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('delegation_derivation_failed', {
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
      stage: DELEGATION_PROJECTION_STAGE,
      source: 'indexer.delegation_projection',
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
    outcome: CompTokenDelegationDerivationOutcome,
    reason: CompTokenDelegationDerivationFailureReason | null,
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
  row: Pick<
    ArchiveDerivationRow | CompTokenArchivePayloadRow,
    'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type'
  >,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}:${row.event_type}`;
}
