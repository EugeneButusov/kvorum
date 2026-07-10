import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { PgDatabase } from '@libs/db';
import type { NewAiCostLog } from './schema.js';

export class AiCostLogRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async insert(row: NewAiCostLog): Promise<void> {
    await this.db.insertInto('ai_cost_log').values(row).execute();
  }

  /**
   * Cumulative spend (USD) for a feature since a timestamp. Consumed by #434's budget cap.
   * COALESCE keeps the no-rows case 0 in SQL (SUM over zero rows is NULL otherwise). The
   * numeric→number conversion is exact here because monthly caps are ≤ $41 (SPEC §5.3).
   * Raw sql: Kysely's fn.sum typing over a numeric column is awkward; the aggregate is
   * parameter-free (constant 0), satisfying the sql-template safety rule.
   */
  async sumCostForFeatureSince(featureName: string, since: Date): Promise<number> {
    const result = await this.db
      .selectFrom('ai_cost_log')
      .select(sql<string>`coalesce(sum(cost_usd), 0)`.as('total'))
      .where('feature_name', '=', featureName)
      .where('timestamp', '>=', since)
      .executeTakeFirstOrThrow();
    return Number(result.total);
  }
}
