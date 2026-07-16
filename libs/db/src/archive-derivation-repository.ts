import { sql, type Kysely } from 'kysely';
import type { ArchiveEventType } from '@libs/domain';
import type { PgDatabase } from './schema/pg';

export interface ArchiveDerivationRow {
  id: string;
  source_type: string;
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: ArchiveEventType;
  received_at: Date;
  derivation_attempt_count: number;
}

/** Off-chain derivation row: identified by external_id, ordered by derivation_ordinal
 *  (no block coords). The off-chain analogue of ArchiveDerivationRow (ADR-071). */
export interface OffchainArchiveRow {
  id: string;
  source_type: string;
  dao_source_id: string;
  chain_id: string;
  external_id: string;
  /** Source-native ordinal (bigint as string); null until the consumer sets it. */
  derivation_ordinal: string | null;
  event_type: ArchiveEventType;
  received_at: Date;
  derivation_attempt_count: number;
}

const OFFCHAIN_COLUMNS = [
  'id',
  'source_type',
  'dao_source_id',
  'chain_id',
  'external_id',
  'derivation_ordinal',
  'event_type',
  'received_at',
  'derivation_attempt_count',
] as const;

export class ArchiveDerivationRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async findUnderived(
    eventTypes: readonly ArchiveEventType[],
    limit: number,
  ): Promise<ArchiveDerivationRow[]> {
    if (eventTypes.length === 0) return [];

    // external_id IS NULL restricts to EVM rows; together with the
    // archive_event_identity_shape CHECK this guarantees non-null block/tx coords,
    // so the nullable table type narrows to the non-null ArchiveDerivationRow.
    // Off-chain rows are served by findUnderivedOffchain.
    const rows = await this.pgDb
      .selectFrom('archive_event')
      .select([
        'id',
        'source_type',
        'dao_source_id',
        'chain_id',
        'block_number',
        'block_hash',
        'tx_hash',
        'log_index',
        'event_type',
        'received_at',
        'derivation_attempt_count',
      ])
      .where('external_id', 'is', null)
      .where('derived_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as ArchiveDerivationRow[];
  }

  /** Off-chain counterpart of findUnderived: external_id rows ordered by the
   *  source-native derivation_ordinal (degenerate (block_number, log_index) off-chain).
   *  derivation_ordinal NULLS LAST, then external_id, then id — fully deterministic. */
  async findUnderivedOffchain(
    eventTypes: readonly ArchiveEventType[],
    limit: number,
  ): Promise<OffchainArchiveRow[]> {
    if (eventTypes.length === 0) return [];

    const rows = await this.pgDb
      .selectFrom('archive_event')
      .select(OFFCHAIN_COLUMNS)
      .where('external_id', 'is not', null)
      .where('derived_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .orderBy('chain_id', 'asc')
      .orderBy('derivation_ordinal', 'asc')
      .orderBy('external_id', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as OffchainArchiveRow[];
  }

  async markDerived(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derived_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Defers a row that cannot derive yet because a cross-chain counterpart has not landed (KNOWN-028):
   * the row stays un-derived but is skipped by the derivable queries until `holdUntil` passes, so it
   * stops occupying the head of the block-ordered queue and everything behind it keeps flowing.
   *
   * Without this, a hold pins the queue head forever. Live that only delays newer rows on the same
   * dispatch key; in a backfill the counterpart sits at a HIGHER block and can never be reached, so
   * a contiguous run of held rows longer than the batch size stops derivation outright.
   */
  async markHeld(id: string, holdUntil: Date): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derivation_hold_until: holdUntil })
      .where('id', '=', id)
      .execute();
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derivation_attempt_count: sql`derivation_attempt_count + 1` })
      .where('id', '=', id)
      .execute();
  }
}
