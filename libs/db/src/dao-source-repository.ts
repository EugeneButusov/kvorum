import type { Kysely } from 'kysely';
import type { PgDatabase } from './schema/pg';

export interface BackfillStatusRow {
  id: string;
  backfill_started_at_block: string | null;
  backfill_head_block: string | null;
}

export class DaoSourceRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findBySourceType(sourceType: string) {
    return this.db
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ])
      .where('dao_source.source_type', '=', sourceType)
      .execute();
  }

  async findAll() {
    return this.db
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
        'dao.primary_chain_id',
      ])
      .orderBy('dao_source.id', 'asc')
      .execute();
  }

  /** Returns the source row joined with its chain — the full shape the backfill driver needs. */
  async findByIdWithChain(id: string) {
    return this.db
      .selectFrom('dao_source')
      .innerJoin('dao', 'dao.id', 'dao_source.dao_id')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
        'dao_source.active_from_block',
        'dao_source.backfill_started_at_block',
        'dao_source.backfill_head_block',
        'dao.primary_chain_id',
      ])
      .where('dao_source.id', '=', id)
      .executeTakeFirst();
  }

  /** Records the chain head captured at backfill start. No-op when already set (resume safety). */
  async captureBackfillStart(id: string, head: bigint): Promise<void> {
    await this.db
      .updateTable('dao_source')
      .set({ backfill_started_at_block: head.toString() })
      .where('dao_source.id', '=', id)
      .where('dao_source.backfill_started_at_block', 'is', null)
      .execute();
  }

  /** Advances the per-chunk checkpoint; called after each chunk fully lands. */
  async updateBackfillHead(id: string, block: bigint): Promise<void> {
    await this.db
      .updateTable('dao_source')
      .set({ backfill_head_block: block.toString() })
      .where('dao_source.id', '=', id)
      .execute();
  }

  /** Clears both checkpoint columns; used by fresh-mode reset before re-capture. */
  async clearBackfillState(id: string): Promise<void> {
    await this.db
      .updateTable('dao_source')
      .set({ backfill_started_at_block: null, backfill_head_block: null })
      .where('dao_source.id', '=', id)
      .execute();
  }

  async readBackfillStatus(id: string): Promise<BackfillStatusRow | undefined> {
    return this.db
      .selectFrom('dao_source')
      .select([
        'dao_source.id',
        'dao_source.backfill_started_at_block',
        'dao_source.backfill_head_block',
      ])
      .where('dao_source.id', '=', id)
      .executeTakeFirst();
  }
}
