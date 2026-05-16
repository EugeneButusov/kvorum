import type { Kysely } from 'kysely';
import type {
  IngestionDlq,
  NewIngestionDlq,
  NewIngestionDlqResolved,
  PgDatabase,
} from './schema/pg';

export interface DlqDepthRow {
  stage: string;
  source: string;
  count: number;
}

export class DlqRepository {
  constructor(private readonly pgDb: Kysely<PgDatabase>) {}

  async insert(row: NewIngestionDlq): Promise<void> {
    await this.pgDb.insertInto('ingestion_dlq').values(row).execute();
  }

  async depthByStageAndSource(): Promise<DlqDepthRow[]> {
    const rows = await this.pgDb
      .selectFrom('ingestion_dlq')
      .select(['stage', 'source', this.pgDb.fn.countAll<string>().as('count')])
      .groupBy(['stage', 'source'])
      .execute();
    return rows.map((r) => ({ stage: r.stage, source: r.source, count: Number(r.count) }));
  }

  async list(params: { source?: string; limit: number }): Promise<IngestionDlq[]> {
    let query = this.pgDb.selectFrom('ingestion_dlq').selectAll().orderBy('first_seen_at', 'asc');
    if (params.source != null) {
      query = query.where('source', '=', params.source);
    }
    return query.limit(params.limit).execute();
  }

  async getById(id: string): Promise<IngestionDlq | undefined> {
    return this.pgDb
      .selectFrom('ingestion_dlq')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async accept(
    id: string,
    reason: string,
    resolvedBy: string,
  ): Promise<'accepted' | 'not_found' | 'already_resolved'> {
    return this.pgDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('ingestion_dlq')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (row == null) {
        return 'not_found';
      }

      const resolvedRow: NewIngestionDlqResolved = {
        original_dlq_id: row.id,
        stage: row.stage,
        source: row.source,
        payload: row.payload,
        error: row.error,
        retries: row.retries,
        first_seen_at: row.first_seen_at,
        last_attempt_at: row.last_attempt_at,
        archive_source_type: row.archive_source_type,
        archive_chain_id: row.archive_chain_id,
        archive_tx_hash: row.archive_tx_hash,
        archive_log_index: row.archive_log_index,
        archive_block_hash: row.archive_block_hash,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_kind: 'accepted',
        reason,
      };

      try {
        await trx.insertInto('ingestion_dlq_resolved').values(resolvedRow).execute();
      } catch (error) {
        if (
          error != null &&
          typeof error === 'object' &&
          (error as { code?: unknown }).code === '23505'
        ) {
          return 'already_resolved';
        }
        throw error;
      }

      await trx.deleteFrom('ingestion_dlq').where('id', '=', id).execute();
      return 'accepted';
    });
  }

  async markRetrySucceeded(
    id: string,
    reason: string,
    resolvedBy: string,
  ): Promise<'resolved' | 'not_found' | 'already_resolved'> {
    return this.pgDb.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('ingestion_dlq')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (row == null) {
        return 'not_found';
      }

      const resolvedRow: NewIngestionDlqResolved = {
        original_dlq_id: row.id,
        stage: row.stage,
        source: row.source,
        payload: row.payload,
        error: row.error,
        retries: row.retries,
        first_seen_at: row.first_seen_at,
        last_attempt_at: row.last_attempt_at,
        archive_source_type: row.archive_source_type,
        archive_chain_id: row.archive_chain_id,
        archive_tx_hash: row.archive_tx_hash,
        archive_log_index: row.archive_log_index,
        archive_block_hash: row.archive_block_hash,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
        resolution_kind: 'retry_succeeded',
        reason,
      };
      try {
        await trx.insertInto('ingestion_dlq_resolved').values(resolvedRow).execute();
      } catch (error) {
        if (
          error != null &&
          typeof error === 'object' &&
          (error as { code?: unknown }).code === '23505'
        ) {
          return 'already_resolved';
        }
        throw error;
      }

      await trx.deleteFrom('ingestion_dlq').where('id', '=', id).execute();
      return 'resolved';
    });
  }
}
