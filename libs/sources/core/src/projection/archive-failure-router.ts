import type { Logger } from '@libs/chain';
import type { ArchiveDerivationRepository, ArchiveDerivationRow, DlqRepository } from '@libs/db';

/**
 * Correlation key between an `archive_event` row and its ClickHouse payload row —
 * the EVM 4-tuple `(chain_id, tx_hash, log_index, block_hash)`. Projection appliers
 * build a `Map` keyed by this to join archive rows to their decoded payloads.
 */
export function archiveEventTupleKey(row: {
  chain_id: string;
  tx_hash: string;
  log_index: number;
  block_hash: string;
}): string {
  return `${row.chain_id}:${row.tx_hash}:${row.log_index}:${row.block_hash}`;
}

export interface ArchiveFailureRouterDeps {
  archive: Pick<ArchiveDerivationRepository, 'incrementAttemptCount'>;
  dlq: Pick<DlqRepository, 'insert'>;
  /** Phase-named DLQ stage, e.g. `vote_projection_stage`. */
  stage: string;
  /** DLQ source label, e.g. `indexer.vote_projection`. */
  source: string;
  /** Structured-log event name emitted on each failure. */
  logEvent: string;
  /** Attempt count (inclusive) at which a row is routed to the DLQ. */
  threshold: number;
  logger: Logger;
}

/**
 * Shared failure path for projection appliers: increments the archive derivation
 * attempt counter, emits a structured error log, and routes the row to the
 * ingestion DLQ once it reaches `threshold` attempts. Centralises the
 * increment → log → DLQ-at-threshold pattern each applier would otherwise
 * re-implement. The per-source metric (`processed(outcome: 'failed', …)`) stays in
 * the applier, since its outcome/reason enums are source-specific.
 */
export class ArchiveFailureRouter {
  constructor(private readonly deps: ArchiveFailureRouterDeps) {}

  async route(row: ArchiveDerivationRow, reason: string, error: unknown): Promise<void> {
    await this.deps.archive.incrementAttemptCount(row.id);
    const attempt = row.derivation_attempt_count + 1;
    this.deps.logger.error(this.deps.logEvent, {
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

    if (attempt < this.deps.threshold) return;

    await this.deps.dlq.insert({
      stage: this.deps.stage,
      source: this.deps.source,
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
