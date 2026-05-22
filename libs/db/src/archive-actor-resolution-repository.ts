import { sql, type Kysely } from 'kysely';
import type { ArchiveDerivationRow } from './archive-derivation-repository';
import type { PgDatabase } from './schema/pg';

export class ArchiveActorResolutionRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async findConfirmedUnresolvedActors(
    eventTypes: readonly string[],
    attemptThreshold: number,
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
      .where('derivation_actor_resolved_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .where('actor_resolution_attempt_count', '<', attemptThreshold)
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
}
