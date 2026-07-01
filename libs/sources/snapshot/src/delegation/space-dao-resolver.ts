import { sql, type Kysely } from 'kysely';
import type { PgDatabase } from '@libs/db';

/**
 * Resolves a decoded Snapshot space name → the `dao_id` of its `snapshot` dao_source (seeded in
 * snapshot_002). The on-chain delegation registries are ecosystem-global single contracts, so the
 * delegation ingester's dao_source cannot carry the right dao — attribution is recovered here from
 * the event's decoded space. Global delegations (no space) resolve to null. Results are cached for
 * the process lifetime (the space→dao seed is static).
 */
export class SnapshotSpaceDaoResolver {
  private readonly cache = new Map<string, string | null>();

  constructor(private readonly db: Kysely<PgDatabase>) {}

  async resolve(space: string): Promise<string | null> {
    const cached = this.cache.get(space);
    if (cached !== undefined) return cached;

    const row = await this.db
      .selectFrom('dao_source')
      .select('dao_id')
      .where('source_type', '=', 'snapshot')
      .where(sql<boolean>`source_config->>'space' = ${space}`)
      .executeTakeFirst();

    const daoId = row?.dao_id ?? null;
    this.cache.set(space, daoId);
    return daoId;
  }
}
