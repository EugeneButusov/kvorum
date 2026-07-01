import { silentLogger, type Logger } from '@libs/chain';
import { ArchiveDerivationRepository, type ArchiveDerivationRow, DlqRepository } from '@libs/db';
import { projectSplitDelegationEvent } from './delegation-projector';
import type { SplitDelegationEvent } from './types';
import type {
  DelegationDerivationFailureReason,
  SnapshotDelegationProjectionMetrics,
} from '../../delegate-registry/domain/delegation-projection-applier';
import { SNAPSHOT_DELEGATION_PROJECTION_STAGE } from '../../delegation/constants';
import { SnapshotDelegationRepository } from '../../delegation/snapshot-delegation-repository';
import { SnapshotSpaceDaoResolver } from '../../delegation/space-dao-resolver';
import {
  SplitDelegationArchivePayloadRepository,
  type SplitDelegationArchivePayloadRow,
} from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['SNAPSHOT_DELEGATION_DLQ_THRESHOLD'] ?? '5');

const SPLIT_EVENT_TYPES = [
  'DelegationUpdated',
  'DelegationCleared',
  'ExpirationUpdated',
  'OptOutStatusSet',
] as const;

export interface SplitDelegationProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: SplitDelegationArchivePayloadRepository;
  delegationRepo: SnapshotDelegationRepository;
  spaceResolver: SnapshotSpaceDaoResolver;
  metrics: SnapshotDelegationProjectionMetrics;
  network: string;
  logger?: Logger;
}

// Derives Split Delegation events into PG snapshot_delegation. Multi-delegate fan-out +
// weights + expiration live in the projector; OptOutStatusSet is a no-op derive (archived only).
// dao attribution comes from the event `context` (the space), not the dao_source (see ADR-0075).
export class SplitDelegationProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['snapshot_split_delegation'] as const;
  readonly eventTypes = SPLIT_EVENT_TYPES;

  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: SplitDelegationArchivePayloadRepository;
  private readonly delegationRepo: SnapshotDelegationRepository;
  private readonly spaceResolver: SnapshotSpaceDaoResolver;
  private readonly metrics: SnapshotDelegationProjectionMetrics;
  private readonly network: string;
  private readonly logger: Logger;

  constructor(deps: SplitDelegationProjectionApplierDeps) {
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.delegationRepo = deps.delegationRepo;
    this.spaceResolver = deps.spaceResolver;
    this.metrics = deps.metrics;
    this.network = deps.network;
    this.logger = deps.logger ?? silentLogger;
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = await this.payloads.fetchPayloads(rows);
    const byKey = new Map(payloads.map((p) => [tupleKey(p), p]));

    for (const row of rows) {
      const payload = byKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }
      await this.apply(row, payload);
    }
  }

  private async apply(
    row: ArchiveDerivationRow,
    payload: SplitDelegationArchivePayloadRow,
  ): Promise<void> {
    if (!isSplitEventType(row.event_type)) {
      await this.failAndMaybeDlq(row, 'unknown_event_type', new Error(row.event_type));
      return;
    }

    let event: SplitDelegationEvent;
    try {
      event = {
        type: row.event_type,
        payload: JSON.parse(payload.payload),
      } as SplitDelegationEvent;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    try {
      const daoId = await this.spaceResolver.resolve(event.payload.context);
      const projected = projectSplitDelegationEvent(event, row, { daoId, network: this.network });
      await this.delegationRepo.insertBatch(projected);

      try {
        await this.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return;
      }
      this.metrics.processed({
        source_type: row.source_type,
        event_type: row.event_type,
        outcome: 'derived',
        reason: null,
      });
    } catch (error) {
      await this.failAndMaybeDlq(row, 'projection_apply_error', error);
    }
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: DelegationDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.metrics.processed({
      source_type: row.source_type,
      event_type: row.event_type,
      outcome: 'failed',
      reason,
    });
    await this.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('snapshot_split_delegation_derivation_failed', {
      row_id: row.id,
      source_type: row.source_type,
      event_type: row.event_type,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      attempt,
      reason,
      error: String(error),
    });

    if (attempt < DLQ_THRESHOLD) return;

    await this.dlq.insert({
      stage: SNAPSHOT_DELEGATION_PROJECTION_STAGE,
      source: 'indexer.snapshot_delegation_projection',
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
}

function isSplitEventType(value: string): value is SplitDelegationEvent['type'] {
  return (SPLIT_EVENT_TYPES as readonly string[]).includes(value);
}

function tupleKey(
  row: Pick<
    ArchiveDerivationRow | SplitDelegationArchivePayloadRow,
    'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type'
  >,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}:${row.event_type}`;
}
