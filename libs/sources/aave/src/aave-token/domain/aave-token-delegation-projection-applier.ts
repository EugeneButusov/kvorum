import type { Kysely } from 'kysely';
import { silentLogger, type Logger } from '@libs/chain';
import {
  ArchiveDerivationRepository,
  type ArchiveDerivationRow,
  type ClickHouseDatabase,
  DelegationFlowProjectionWriter,
  DlqRepository,
  type NewDelegationFlowProjectionRow,
  type PgDatabase,
  ProposalRepository,
} from '@libs/db';
import { projectVotingDelegateChanged } from './delegation-projector';
import type { DelegateChangedPayload } from './types';
import { AAVE_GOVERNANCE_POWER_TYPE } from '../abi/events';
import {
  AaveTokenArchivePayloadRepository,
  type AaveTokenArchivePayloadRow,
} from '../persistence/archive-payload-repository';

const DLQ_THRESHOLD = Number(process.env['DELEGATION_PROJECTION_DLQ_THRESHOLD'] ?? '5');
// Reuses the shared delegation projection DLQ stage (admin-cli dlq-retry registry already
// recognizes it) — the target table delegation_flow_projection is the same as Compound's.
const DELEGATION_PROJECTION_STAGE = 'delegation_projection_stage';

export type AaveTokenDelegationDerivationOutcome = 'derived' | 'failed';
export type AaveTokenDelegationDerivationFailureReason =
  | 'payload_missing'
  | 'decode_error'
  | 'projection_apply_error'
  | 'watermark_update_error'
  | 'no_dao'
  | 'unknown_event_type';

export interface AaveTokenDelegationProjectionMetrics {
  batchLookupSeconds(seconds: number): void;
  chWriteSeconds(seconds: number): void;
  processed(labels: {
    source_type: string;
    event_type: string;
    outcome: AaveTokenDelegationDerivationOutcome;
    reason: AaveTokenDelegationDerivationFailureReason | null;
  }): void;
}

export interface AaveTokenDelegationProjectionApplierDeps {
  pgDb: Kysely<PgDatabase>;
  chDb: Kysely<ClickHouseDatabase>;
  archive: ArchiveDerivationRepository;
  dlq: DlqRepository;
  payloads: AaveTokenArchivePayloadRepository;
  metrics: AaveTokenDelegationProjectionMetrics;
  logger?: Logger;
}

class ProjectionError extends Error {
  constructor(public readonly reason: 'no_dao' | 'unknown_event_type') {
    super(reason);
  }
}

// Derives AAVE-token VOTING-power delegation relationships into delegation_flow_projection.
// Chain-scoping is by construction: dispatch keys on (source_type, chain_id, event_type) and
// the aave_token source is pinned to chain 0x1 in its seed, so this applier never sees a
// non-mainnet batch (it does not re-check chain_id itself).
export class AaveTokenDelegationProjectionApplier {
  readonly kind = 'projection' as const;
  readonly sourceTypes = ['aave_token'] as const;
  readonly eventTypes = ['DelegateChanged'] as const;

  private readonly pgDb: Kysely<PgDatabase>;
  private readonly archive: ArchiveDerivationRepository;
  private readonly dlq: DlqRepository;
  private readonly payloads: AaveTokenArchivePayloadRepository;
  private readonly metrics: AaveTokenDelegationProjectionMetrics;
  private readonly logger: Logger;
  private readonly delegationFlowProjectionWriter: DelegationFlowProjectionWriter;

  constructor(deps: AaveTokenDelegationProjectionApplierDeps) {
    this.pgDb = deps.pgDb;
    this.archive = deps.archive;
    this.dlq = deps.dlq;
    this.payloads = deps.payloads;
    this.metrics = deps.metrics;
    this.logger = deps.logger ?? silentLogger;
    this.delegationFlowProjectionWriter = new DelegationFlowProjectionWriter(deps.chDb);
  }

  async applyBatch(rows: readonly ArchiveDerivationRow[]): Promise<void> {
    if (rows.length === 0) return;
    const lookupStartedAt = Date.now();
    const payloads = await this.payloads.fetchPayloads(rows);
    this.metrics.batchLookupSeconds((Date.now() - lookupStartedAt) / 1000);
    const payloadByKey = new Map(payloads.map((payload) => [tupleKey(payload), payload]));

    for (const row of rows) {
      const payload = payloadByKey.get(tupleKey(row));
      if (payload === undefined) {
        await this.failAndMaybeDlq(row, 'payload_missing', new Error('archive payload missing'));
        continue;
      }
      await this.apply(row, payload);
    }
  }

  private async apply(
    row: ArchiveDerivationRow,
    payload: AaveTokenArchivePayloadRow,
  ): Promise<void> {
    let parsed: DelegateChangedPayload;
    try {
      parsed = JSON.parse(payload.payload) as DelegateChangedPayload;
    } catch (error) {
      await this.failAndMaybeDlq(row, 'decode_error', error);
      return;
    }

    try {
      const proposals = new ProposalRepository(this.pgDb);
      const daoId = await proposals.findDaoIdForSource(row.dao_source_id);
      if (daoId === undefined) throw new ProjectionError('no_dao');

      const rows = this.projectRows(row, parsed, daoId);
      const writeStartedAt = Date.now();
      await this.delegationFlowProjectionWriter.insertBatch(rows);
      this.metrics.chWriteSeconds((Date.now() - writeStartedAt) / 1000);

      try {
        await this.archive.markDerived(row.id);
      } catch (watermarkError) {
        await this.failAndMaybeDlq(row, 'watermark_update_error', watermarkError);
        return;
      }

      this.record(row, 'derived', null);
    } catch (error) {
      const reason = error instanceof ProjectionError ? error.reason : 'projection_apply_error';
      await this.failAndMaybeDlq(row, reason, error);
    }
  }

  private projectRows(
    row: ArchiveDerivationRow,
    parsed: DelegateChangedPayload,
    daoId: string,
  ): NewDelegationFlowProjectionRow[] {
    if (row.event_type === 'DelegateChanged') {
      // Lean cut (ADR-0070): only VOTING-power delegation is projected. PROPOSITION-power
      // delegation is a no-op derive (archived, marked derived, no projection row).
      if (parsed.delegationType !== AAVE_GOVERNANCE_POWER_TYPE.VOTING) return [];
      return [projectVotingDelegateChanged(parsed, row, { daoId })];
    }

    /* v8 ignore next -- exhaustive-never: eventTypes union is closed (DelegateChanged) */
    throw new ProjectionError('unknown_event_type');
  }

  private async failAndMaybeDlq(
    row: ArchiveDerivationRow,
    reason: AaveTokenDelegationDerivationFailureReason,
    error: unknown,
  ): Promise<void> {
    this.record(row, 'failed', reason);
    await this.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.logger.error('aave_token_delegation_derivation_failed', {
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
    outcome: AaveTokenDelegationDerivationOutcome,
    reason: AaveTokenDelegationDerivationFailureReason | null,
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
    ArchiveDerivationRow | AaveTokenArchivePayloadRow,
    'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type'
  >,
): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}:${row.event_type}`;
}
