import { sql, type Kysely } from 'kysely';
import type { AuditOutcome, ExecutorKind, PgDatabase } from './schema/pg';

export interface AdminAuditStartInput {
  command: string;
  args: unknown;
  executor: string;
  executorKind: ExecutorKind;
}

export interface AdminAuditCompleteInput {
  id: string;
  outcome: AuditOutcome;
  error?: unknown;
}

export class AdminAuditRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async start(input: AdminAuditStartInput): Promise<string> {
    const row = await this.db
      .insertInto('admin_audit')
      .values({
        command: input.command,
        args: input.args,
        executor: input.executor,
        executor_kind: input.executorKind,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async complete(input: AdminAuditCompleteInput): Promise<void> {
    await this.db
      .updateTable('admin_audit')
      .set({
        completed_at: sql`now()`,
        outcome: input.outcome,
        error: input.error ?? null,
      })
      .where('id', '=', input.id)
      .execute();
  }

  async listRecent(limit: number): Promise<
    Array<{
      id: string;
      command: string;
      args: unknown;
      executor: string;
      executor_kind: ExecutorKind;
      started_at: Date;
      completed_at: Date | null;
      outcome: AuditOutcome | null;
      error: unknown | null;
    }>
  > {
    return this.db
      .selectFrom('admin_audit')
      .selectAll()
      .orderBy('started_at', 'desc')
      .limit(limit)
      .execute();
  }
}
