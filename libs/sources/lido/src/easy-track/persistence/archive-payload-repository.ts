import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { ArchiveEventEasyTrackTable } from '../../persistence/schema';

export type EasyTrackArchivePayloadRow = Pick<
  ArchiveEventEasyTrackTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

/**
 * Loads decoded Easy Track archive payloads from ClickHouse, keyed on the EVM 4-tuple
 * (chain_id, tx_hash, log_index, block_hash). Consumers dedupe by `received_at asc` (later rows win),
 * matching the ReplacingMergeTree(received_at) semantics without an explicit FINAL — mirrors the
 * Aragon-voting + Dual Governance payload repos. Read-side; consumed by the motion projection.
 */
export class EasyTrackArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<EasyTrackArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('archive_event_easy_track')
      .select([
        'chain_id',
        'tx_hash',
        'log_index',
        'block_hash',
        'event_type',
        'payload',
        'received_at',
      ])
      .where(sql<boolean>`(chain_id, tx_hash, log_index, block_hash) IN (${sql.join(tuples)})`)
      .orderBy('received_at', 'asc')
      .execute();
  }

  /**
   * All Easy Track archive rows of a given event type within one transaction. The motion derivers
   * use this to pull sibling events of a motion emitted in the same tx (e.g. the enacting tx's
   * `MotionEnacted` alongside the executed EVMScript).
   */
  async findEventsInTx(
    chainId: string,
    txHash: string,
    eventType: string,
  ): Promise<EasyTrackArchivePayloadRow[]> {
    return this.chDb
      .selectFrom('archive_event_easy_track')
      .select([
        'chain_id',
        'tx_hash',
        'log_index',
        'block_hash',
        'event_type',
        'payload',
        'received_at',
      ])
      .where('chain_id', '=', chainId)
      .where('tx_hash', '=', txHash)
      .where('event_type', '=', eventType)
      .orderBy('received_at', 'asc')
      .execute();
  }

  /**
   * The motion duration (objection-window length, in seconds) in force at `block`: the most recent
   * archived `MotionDurationChanged` with `block_number <= block`. Returns `null` when none precedes
   * the block (caller falls back to the pinned genesis default). Reads the archive directly, so the
   * duration timeline is available regardless of whether the settings events have been derived.
   */
  async findDurationAsOf(chainId: string, block: string): Promise<string | null> {
    const row = await this.chDb
      .selectFrom('archive_event_easy_track')
      .select('payload')
      .where('chain_id', '=', chainId)
      .where('event_type', '=', 'MotionDurationChanged')
      // `block` is a decimal string; cast so ClickHouse compares UInt64 to UInt64, not UInt64 to String.
      .where(sql<boolean>`block_number <= toUInt64(${block})`)
      .orderBy('block_number', 'desc')
      .orderBy('log_index', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return null;
    const parsed = JSON.parse(row.payload) as { motionDuration?: string };
    return typeof parsed.motionDuration === 'string' ? parsed.motionDuration : null;
  }
}
