import { sql, type ExpressionBuilder, type Kysely } from 'kysely';
import type { ArchiveEventType } from '@libs/domain';
import type { ArchiveDerivationRow, OffchainArchiveRow } from './archive-derivation-repository';
import type { PgDatabase } from './schema/pg';

/**
 * A row is derivable unless it is explicitly held into the future (KNOWN-028). Rows that predate the
 * hold column — and every row an applier never defers — have a null `derivation_hold_until` and stay
 * derivable, so this filter is a no-op for everything except an active deferral.
 */
function notHeld(now: Date) {
  return (eb: ExpressionBuilder<PgDatabase, 'archive_event'>) =>
    eb.or([eb('derivation_hold_until', 'is', null), eb('derivation_hold_until', '<=', now)]);
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

export class ArchiveActorResolutionRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async findDerivableBy(
    eventTypes: readonly ArchiveEventType[],
    limit: number,
    now: Date = new Date(),
  ): Promise<ArchiveDerivationRow[]> {
    if (eventTypes.length === 0) return [];

    // external_id IS NULL restricts to EVM rows (non-null coords by the
    // archive_event_identity_shape CHECK), narrowing the nullable table type to
    // ArchiveDerivationRow. Off-chain rows are served by the *Offchain methods.
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
      .where('derivation_actor_resolved_at', 'is not', null)
      .where('event_type', 'in', eventTypes)
      .where(notHeld(now))
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as ArchiveDerivationRow[];
  }

  async findUnresolvedActors(
    eventTypes: readonly ArchiveEventType[],
    attemptThreshold: number,
    limit: number,
  ): Promise<ArchiveDerivationRow[]> {
    if (eventTypes.length === 0) return [];

    // external_id IS NULL restricts to EVM rows (non-null coords by the
    // archive_event_identity_shape CHECK), narrowing the nullable table type to
    // ArchiveDerivationRow. Off-chain rows are served by the *Offchain methods.
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
      .where('derivation_actor_resolved_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .where('actor_resolution_attempt_count', '<', attemptThreshold)
      .orderBy('chain_id', 'asc')
      .orderBy('block_number', 'asc')
      .orderBy('log_index', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as ArchiveDerivationRow[];
  }

  /** Off-chain counterpart of findDerivableBy: external_id rows whose actors are
   *  resolved, ordered by derivation_ordinal (then external_id, id) for determinism. */
  async findDerivableByOffchain(
    eventTypes: readonly ArchiveEventType[],
    limit: number,
    now: Date = new Date(),
  ): Promise<OffchainArchiveRow[]> {
    if (eventTypes.length === 0) return [];

    const rows = await this.pgDb
      .selectFrom('archive_event')
      .select(OFFCHAIN_COLUMNS)
      .where('external_id', 'is not', null)
      .where('derived_at', 'is', null)
      .where('derivation_actor_resolved_at', 'is not', null)
      .where('event_type', 'in', eventTypes)
      .where(notHeld(now))
      .orderBy('chain_id', 'asc')
      .orderBy('derivation_ordinal', 'asc')
      .orderBy('external_id', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as OffchainArchiveRow[];
  }

  /** Off-chain counterpart of findUnresolvedActors. */
  async findUnresolvedActorsOffchain(
    eventTypes: readonly ArchiveEventType[],
    attemptThreshold: number,
    limit: number,
  ): Promise<OffchainArchiveRow[]> {
    if (eventTypes.length === 0) return [];

    const rows = await this.pgDb
      .selectFrom('archive_event')
      .select(OFFCHAIN_COLUMNS)
      .where('external_id', 'is not', null)
      .where('derivation_actor_resolved_at', 'is', null)
      .where('event_type', 'in', eventTypes)
      .where('actor_resolution_attempt_count', '<', attemptThreshold)
      .orderBy('chain_id', 'asc')
      .orderBy('derivation_ordinal', 'asc')
      .orderBy('external_id', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .execute();
    return rows as OffchainArchiveRow[];
  }

  async markActorResolved(id: string): Promise<void> {
    await this.pgDb
      .updateTable('archive_event')
      .set({ derivation_actor_resolved_at: sql`now()` })
      .where('id', '=', id)
      .execute();
  }

  async incrementActorResolutionAttemptCount(id: string): Promise<number> {
    const row = await this.pgDb
      .updateTable('archive_event')
      .set({
        actor_resolution_attempt_count: sql`actor_resolution_attempt_count + 1`,
      })
      .where('id', '=', id)
      .returning('actor_resolution_attempt_count')
      .executeTakeFirstOrThrow();

    return Number(row.actor_resolution_attempt_count);
  }
}
