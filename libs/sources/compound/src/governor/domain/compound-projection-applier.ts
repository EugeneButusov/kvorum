import type { Kysely } from 'kysely';
import { silentLogger, type Logger } from '@libs/chain';
import {
  ActorRepository,
  ArchiveDerivationRepository,
  type ClickHouseDatabase,
  type ArchiveDerivationRow,
  ProposalRepository,
  type PgDatabase,
} from '@libs/db';
import { projectCompoundProposalEvent } from './proposal-projector';
import type {
  CompoundGovernorEvent,
  ProposalCanceledPayload,
  ProposalCreatedPayload,
  ProposalExecutedPayload,
  ProposalQueuedPayload,
} from './types';
import {
  CompoundArchivePayloadRepository,
  type CompoundArchivePayloadRow,
} from '../persistence/compound-archive-payload-repository';

export type CompoundDerivationOutcome =
  | 'derived'
  | 'skipped_state_guard'
  | 'skipped_idempotent'
  | 'failed';

export type CompoundDerivationFailureReason = 'ch_missing' | 'decode_error' | 'pg_tx_error';

export interface CompoundProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: CompoundDerivationOutcome;
    reason: CompoundDerivationFailureReason | null;
  }): void;
}

export interface CompoundProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  chDb: Kysely<ClickHouseDatabase>;
  archive: ArchiveDerivationRepository;
  payloads: CompoundArchivePayloadRepository;
  metrics: CompoundProjectionMetrics;
  logger?: Logger;
}

interface CompoundProjectionRepositories {
  actors: ActorRepository;
  proposals: ProposalRepository;
  archive: ArchiveDerivationRepository;
}

export class CompoundProjectionApplier {
  readonly sourceTypes = ['compound_governor_bravo', 'compound_governor_alpha'] as const;

  private readonly pgDb: Kysely<PgDatabase>;
  private readonly chDb: Kysely<ClickHouseDatabase>;
  private readonly archive: ArchiveDerivationRepository;
  private readonly payloads: CompoundArchivePayloadRepository;
  private readonly metrics: CompoundProjectionMetrics;
  private readonly logger: Logger;

  constructor(deps: CompoundProjectionApplierDeps) {
    this.pgDb = deps.pgDb;
    this.chDb = deps.chDb;
    this.archive = deps.archive;
    this.payloads = deps.payloads;
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;

    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(rows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);

    const byKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    for (const row of rows) {
      const payload = byKey.get(tupleKey(row));
      if (payload === undefined) {
        this.record(row, 'failed', 'ch_missing');
        await this.archive.incrementAttemptCount(row.id);
        this.logger.error('derivation_ch_missing', {
          row_id: row.id,
          chain_id: row.chain_id,
          tx_hash: row.tx_hash,
          log_index: row.log_index,
          block_hash: row.block_hash,
          event_type: row.event_type,
          attempt: row.derivation_attempt_count + 1,
        });
        continue;
      }

      await this.apply(row, payload);
    }
  }

  private async apply(
    row: ArchiveDerivationRow,
    payload: CompoundArchivePayloadRow,
  ): Promise<void> {
    let event: CompoundGovernorEvent;
    try {
      event = parseArchiveEvent(row.event_type, payload.payload);
    } catch (err) {
      this.record(row, 'failed', 'decode_error');
      await this.archive.incrementAttemptCount(row.id);
      this.logger.error('derivation_decode_failed', {
        row_id: row.id,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
        attempt: row.derivation_attempt_count + 1,
        error: String(err),
      });
      return;
    }

    try {
      const projection = projectCompoundProposalEvent(event, {
        id: row.id,
        dao_source_id: row.dao_source_id,
        source_type: row.source_type,
        chain_id: row.chain_id,
        confirmed_at: row.confirmed_at,
      });

      await this.transaction(async ({ actors, proposals, archive }) => {
        const daoId = await proposals.findDaoIdForSource(projection.daoSourceId);
        if (daoId === undefined) {
          throw new Error(`unknown dao_source ${projection.daoSourceId}`);
        }

        if (projection.kind === 'proposal_created') {
          const proposer = await actors.findOrCreateByAddress(projection.proposerAddress);
          const result = await proposals.insertProposal({
            ...projection.proposal,
            dao_id: daoId,
            proposer_actor_id: proposer.id,
          });

          if (result.inserted) {
            await proposals.insertActions(result.proposalId!, projection.actions);
            await proposals.ensureChoices(result.proposalId!, projection.choices);
            this.record(row, 'derived', null);
          } else {
            this.record(row, 'skipped_idempotent', null);
          }
        } else {
          const advanced = await proposals.advanceState({
            daoId,
            sourceType: projection.sourceType,
            sourceId: projection.sourceId,
            targetState: projection.targetState,
            stateUpdatedAt: projection.stateUpdatedAt,
          });
          this.record(row, advanced > 0 ? 'derived' : 'skipped_state_guard', null);
        }

        await archive.markDerived(row.id);
      });
    } catch (err) {
      this.record(row, 'failed', 'pg_tx_error');
      await this.archive.incrementAttemptCount(row.id);
      this.logger.error('derivation_pg_tx_failed', {
        row_id: row.id,
        chain_id: row.chain_id,
        tx_hash: row.tx_hash,
        log_index: row.log_index,
        block_hash: row.block_hash,
        event_type: row.event_type,
        attempt: row.derivation_attempt_count + 1,
        error: String(err),
      });
    }
  }

  private async transaction<T>(
    fn: (repositories: CompoundProjectionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.pgDb.transaction().execute((tx) =>
      fn({
        actors: new ActorRepository(tx),
        proposals: new ProposalRepository(tx),
        archive: new ArchiveDerivationRepository(tx),
      }),
    );
  }

  private record(
    row: ArchiveDerivationRow,
    outcome: CompoundDerivationOutcome,
    reason: CompoundDerivationFailureReason | null,
  ): void {
    this.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome,
      reason,
    });
  }
}

function parseArchiveEvent(eventType: string, payloadJson: string): CompoundGovernorEvent {
  const payload: unknown = JSON.parse(payloadJson);
  switch (eventType) {
    case 'ProposalCreated':
      return { type: 'ProposalCreated', payload: payload as ProposalCreatedPayload };
    case 'ProposalQueued':
      return { type: 'ProposalQueued', payload: payload as ProposalQueuedPayload };
    case 'ProposalExecuted':
      return { type: 'ProposalExecuted', payload: payload as ProposalExecutedPayload };
    case 'ProposalCanceled':
      return { type: 'ProposalCanceled', payload: payload as ProposalCanceledPayload };
    default:
      throw new Error(`unsupported compound event_type ${eventType}`);
  }
}

function tupleKey(row: ArchiveDerivationRow | CompoundArchivePayloadRow): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}
