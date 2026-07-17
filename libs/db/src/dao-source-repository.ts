import { sql, type Kysely } from 'kysely';
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
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_config',
        'dao_source.chain_id',
      ])
      .where('dao_source.source_type', '=', sourceType)
      .execute();
  }

  /** Resolve the owning `dao_id` for a `dao_source` row. Returns undefined if the source is unknown. */
  async findDaoIdForSource(daoSourceId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select('dao_id')
      .where('id', '=', daoSourceId)
      .executeTakeFirst();
    return row?.dao_id;
  }

  async findTokenAddressByDaoAndSourceType(
    daoId: string,
    sourceType: string,
  ): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('dao_source')
      .select(sql<string>`source_config ->> 'token_address'`.as('token_address'))
      .where('dao_id', '=', daoId)
      .where('source_type', '=', sourceType)
      .executeTakeFirst();

    return row?.token_address ?? undefined;
  }

  async findAll() {
    return this.db
      .selectFrom('dao_source')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
        'dao_source.chain_id',
        // Lets the orchestrator skip sources whose live poller is turned off (0009).
        'dao_source.live_polling_enabled',
      ])
      .orderBy('dao_source.id', 'asc')
      .execute();
  }

  /** Returns the source row joined with its chain — the full shape the backfill driver needs. */
  async findByIdWithChain(id: string) {
    return this.findWithChainWhere('dao_source.id', id);
  }

  /** Same as findByIdWithChain but keyed on source_type (assumes one row per type). */
  async findBySourceTypeWithChain(sourceType: string) {
    return this.findWithChainWhere('dao_source.source_type', sourceType);
  }

  /**
   * Every dao_source row for a DAO (by slug), with the full backfill shape. Returns all source
   * types including reconcile variants; the backfill orchestrator filters those out (a reconcile
   * source has no eth_getLogs range to fetch). Ordered deterministically for plan reproducibility.
   */
  async findSourcesByDaoSlug(slug: string) {
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
        'dao_source.chain_id',
      ])
      .where('dao.slug', '=', slug)
      .orderBy('dao_source.source_type', 'asc')
      .orderBy('dao_source.chain_id', 'asc')
      .execute();
  }

  private findWithChainWhere(column: 'dao_source.id' | 'dao_source.source_type', value: string) {
    return this.db
      .selectFrom('dao_source')
      .select([
        'dao_source.id',
        'dao_source.dao_id',
        'dao_source.source_type',
        'dao_source.source_config',
        'dao_source.active_from_block',
        'dao_source.backfill_started_at_block',
        'dao_source.backfill_head_block',
        'dao_source.chain_id',
      ])
      .where(column, '=', value)
      .executeTakeFirst();
  }

  /**
   * The block the live poller should resume *after*, or null when the source has never been scanned
   * — in which case the poller starts from its confirmed-head window rather than genesis.
   *
   * Nothing is inferred from `archive_event` here. The archive records what happened, not what was
   * looked at: a range containing no events leaves no row, so a quiet source would never advance
   * past its last event and would re-read the same blocks forever. Sources predating this column
   * were bootstrapped once by migration 0011; every backfill since records the watermark as it goes.
   */
  async readPollCursor(id: string): Promise<bigint | null> {
    const source = await this.db
      .selectFrom('dao_source')
      .select('poll_cursor_block')
      .where('id', '=', id)
      .executeTakeFirst();
    return source?.poll_cursor_block == null ? null : BigInt(source.poll_cursor_block);
  }

  /** Advances the live-poll watermark. Never moves it backwards: ticks can only ever be re-run, and
   *  a regression would re-open the gap this column exists to close. */
  async writePollCursor(id: string, lastPolledBlock: bigint): Promise<void> {
    await this.db
      .updateTable('dao_source')
      .set({
        poll_cursor_block: sql<string>`greatest(coalesce(poll_cursor_block, 0), ${lastPolledBlock.toString()}::bigint)`,
      })
      .where('dao_source.id', '=', id)
      .execute();
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
    return this.readBackfillStatusWhere('dao_source.id', id);
  }

  private readBackfillStatusWhere(
    column: 'dao_source.id' | 'dao_source.source_type',
    value: string,
  ): Promise<BackfillStatusRow | undefined> {
    return this.db
      .selectFrom('dao_source')
      .select([
        'dao_source.id',
        'dao_source.backfill_started_at_block',
        'dao_source.backfill_head_block',
      ])
      .where(column, '=', value)
      .executeTakeFirst();
  }
}
