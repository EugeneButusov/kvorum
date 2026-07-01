import { silentLogger, type Logger } from '@libs/chain';
import { ArchiveDerivationRepository, type ArchiveDerivationRow, DlqRepository } from '@libs/db';
import { projectDelegateRegistryEvent } from './delegation-projector';
import type { DelegateEventPayload, DelegateRegistryEvent } from './types';
import { decodeSpaceId } from '../../delegation/address';
import { SNAPSHOT_DELEGATION_PROJECTION_STAGE } from '../../delegation/constants';
import { SnapshotDelegationRepository } from '../../delegation/snapshot-delegation-repository';
import { SnapshotSpaceDaoResolver } from '../../delegation/space-dao-resolver';
import {
  DelegateRegistryArchivePayloadRepository,
  type DelegateRegistryArchivePayloadRow,
} from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['SNAPSHOT_DELEGATION_DLQ_THRESHOLD'] ?? '5');

export type DelegationDerivationOutcome = 'derived' | 'failed';
export type DelegationDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'unknown_event_type';

export interface SnapshotDelegationProjectionMetrics {
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: DelegationDerivationOutcome;
    reason: DelegationDerivationFailureReason | null;
  }): void;
}

export interface DelegateRegistryDelegationProjectionApplierDeps {
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: DelegateRegistryArchivePayloadRepository;
  delegationRepo: SnapshotDelegationRepository;
  spaceResolver: SnapshotSpaceDaoResolver;
  metrics: SnapshotDelegationProjectionMetrics;
  network: string;
  logger?: Logger;
}

// Derives Gnosis Delegate Registry SetDelegate/ClearDelegate into PG snapshot_delegation.
// dao attribution comes from the decoded space (NOT the dao_source) — the registry is an
// ecosystem-global contract bound to a single trigger-owner dao_source; see ADR-0075.
export class DelegateRegistryDelegationProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['snapshot_delegate_registry'] as const;
  readonly eventTypes = ['SetDelegate', 'ClearDelegate'] as const;

  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: DelegateRegistryArchivePayloadRepository;
  private readonly delegationRepo: SnapshotDelegationRepository;
  private readonly spaceResolver: SnapshotSpaceDaoResolver;
  private readonly metrics: SnapshotDelegationProjectionMetrics;
  private readonly network: string;
  private readonly logger: Logger;

  constructor(deps: DelegateRegistryDelegationProjectionApplierDeps) {
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
    payload: DelegateRegistryArchivePayloadRow,
  ): Promise<void> {
    let parsed: DelegateEventPayload;
    try {
      parsed = JSON.parse(payload.payload) as DelegateEventPayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    if (row.event_type !== 'SetDelegate' && row.event_type !== 'ClearDelegate') {
      await this.failAndMaybeDlq(row, 'unknown_event_type', new Error(row.event_type));
      return;
    }
    const event = { type: row.event_type, payload: parsed } as DelegateRegistryEvent;

    try {
      const spaceId = decodeSpaceId(parsed.id);
      const daoId = spaceId === null ? null : await this.spaceResolver.resolve(spaceId);
      const projected = projectDelegateRegistryEvent(event, row, {
        daoId,
        spaceId,
        network: this.network,
      });
      await this.delegationRepo.insertBatch([projected]);

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
    this.logger.error('snapshot_delegate_registry_derivation_failed', {
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

function tupleKey(
  row: Pick<
    ArchiveDerivationRow | DelegateRegistryArchivePayloadRow,
    'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type'
  >,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}:${row.event_type}`;
}
