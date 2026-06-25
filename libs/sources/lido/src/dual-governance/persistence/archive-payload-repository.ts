import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow, ClickHouseDatabase } from '@libs/db';
import type { ArchiveEventDualGovernanceTable } from '../../persistence/schema';

export type DualGovernanceArchivePayloadRow = Pick<
  ArchiveEventDualGovernanceTable,
  'chain_id' | 'tx_hash' | 'log_index' | 'block_hash' | 'event_type' | 'payload' | 'received_at'
>;

/**
 * Loads decoded Dual Governance archive payloads from ClickHouse, keyed on the EVM 4-tuple
 * (chain_id, tx_hash, log_index, block_hash). Consumers dedupe by `received_at asc` (later rows win),
 * matching the ReplacingMergeTree(received_at) semantics without an explicit FINAL — mirrors the
 * Aragon-voting payload repo.
 */
export class DualGovernanceArchivePayloadRepository {
  constructor(private readonly chDb: Kysely<ClickHouseDatabase>) {}

  async fetchPayloads(
    rows: readonly ArchiveDerivationRow[],
  ): Promise<DualGovernanceArchivePayloadRow[]> {
    if (rows.length === 0) return [];

    const tuples = rows.map(
      (row) => sql`(${row.chain_id}, ${row.tx_hash}, ${row.log_index}, ${row.block_hash})`,
    );

    return this.chDb
      .selectFrom('archive_event_dual_governance')
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
   * All DG archive rows of a given event type within one transaction. AB3 uses this to pull a Timelock
   * `ProposalSubmitted`'s co-tx `ProposalSubmittedMeta` (proposer + metadata) — they are emitted together
   * by `submitProposal` and share `proposalId` — so a direct submission can be created from a single
   * trigger event regardless of which sibling derives first.
   */
  async findEventsInTx(
    chainId: string,
    txHash: string,
    eventType: string,
  ): Promise<DualGovernanceArchivePayloadRow[]> {
    return this.chDb
      .selectFrom('archive_event_dual_governance')
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
}
