import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

const L0_ATTEMPT_THRESHOLD = 5;
const L0_EVENT_TYPES = ['VoteCast', 'DelegateChanged', 'DelegateVotesChanged'] as const;

export interface ArchiveDerivationRow {
  id: string;
  source_type: string;
  dao_source_id: string;
  chain_id: string;
  block_number: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  event_type: string;
  confirmed_at: Date | null;
  derivation_attempt_count: number;
}

export class ArchiveDerivationRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async countConfirmedUnderived(daoSourceId: string, fromBlock?: bigint): Promise<number> {
    let query = this.pgDb
      .selectFrom('archive_confirmation')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('dao_source_id', '=', daoSourceId)
      .where('confirmation_status', '=', 'confirmed');

    if (fromBlock != null) {
      query = query.where('block_number', '>=', fromBlock.toString());
    }

    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async findConfirmedUndderived(limit: number): Promise<ArchiveDerivationRow[]> {
    return this.pgDb
      .selectFrom('archive_confirmation')
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
        'confirmed_at',
        'derivation_attempt_count',
      ])
      .where('confirmation_status', '=', 'confirmed')
      .where('derived_at', 'is', null)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  async markDerived(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async findConfirmedUnresolvedActors(limit: number): Promise<ArchiveDerivationRow[]> {
    return this.pgDb
      .selectFrom('archive_confirmation')
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
        'confirmed_at',
        'derivation_attempt_count',
      ])
      .where('confirmation_status', '=', 'confirmed')
      .where('derivation_actor_resolved_at', 'is', null)
      .where('event_type', 'in', L0_EVENT_TYPES)
      .where('actor_resolution_attempt_count', '<', L0_ATTEMPT_THRESHOLD)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  async markActorResolved(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_confirmation')
      .set({ derivation_actor_resolved_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async incrementActorResolutionAttemptCount(id: string): Promise<number> {
    const row = await this.pgDb
      .updateTable('archive_confirmation')
      .set({
        actor_resolution_attempt_count: sql`actor_resolution_attempt_count + 1`,
      })
      .where('id', '=', id)
      .returning('actor_resolution_attempt_count')
      .executeTakeFirstOrThrow();

    return Number(row.actor_resolution_attempt_count);
  }

  /**
   * Read helper for L1/L2 derivation paths.
   * Must be used by vote/delegation derivation so rows are processed only after
   * L0 materialises actor + actor_address and sets derivation_actor_resolved_at.
   */
  async findConfirmedDerivableBy(
    eventTypes: readonly string[],
    limit: number,
  ): Promise<ArchiveDerivationRow[]> {
    if (eventTypes.length === 0) return [];

    return this.pgDb
      .selectFrom('archive_confirmation')
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
        'confirmed_at',
        'derivation_attempt_count',
      ])
      .where('confirmation_status', '=', 'confirmed')
      .where('derived_at', 'is', null)
      .where('derivation_actor_resolved_at', 'is not', null)
      .where('event_type', 'in', eventTypes)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
  }

  async incrementAttemptCount(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_confirmation')
      .set({ derivation_attempt_count: sql`derivation_attempt_count + 1` })
      .where('id', '=', id)
      .execute();
  }

  async resetWatermarkForSource(daoSourceId: string, fromBlock?: bigint): Promise<number> {
    let query = this.pgDb
      .updateTable('archive_confirmation')
      .set({ derived_at: null, derivation_attempt_count: 0 })
      .where('dao_source_id', '=', daoSourceId)
      .where('confirmation_status', '=', 'confirmed');

    if (fromBlock != null) {
      query = query.where('block_number', '>=', fromBlock.toString());
    }

    const result = await query.executeTakeFirst();
    return Number(result?.numUpdatedRows ?? 0n);
  }
}
