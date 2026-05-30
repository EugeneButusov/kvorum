import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export class VotingPowerSnapshotProjectionReadRepository {
  constructor(private readonly ch: Kysely<ClickHouseDatabase>) {}

  async deleteForProposal(proposalId: string): Promise<void> {
    // Lightweight DELETE (CH 23.3+) — marks rows deleted without rewriting parts.
    // Must target both raw and agg; the MV only propagates inserts, not deletes.
    await sql`DELETE FROM voting_power_snapshot_raw WHERE proposal_id = ${proposalId}`.execute(
      this.ch,
    );
    await sql`DELETE FROM voting_power_snapshot_agg WHERE proposal_id = ${proposalId}`.execute(
      this.ch,
    );
  }

  async sampleForProposal(
    proposalId: string,
    limit: number,
  ): Promise<Array<{ actorId: string; power: string; address: string }>> {
    const rows = await this.ch
      .selectFrom('voting_power_snapshot_projection as vps')
      .select([
        'vps.actor_address as address',
        'vps.voting_power as power',
        sql<string>`coalesce(dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(vps.actor_address)), vps.actor_id_hint, '')`.as(
          'actorId',
        ),
      ])
      .where('vps.proposal_id', '=', proposalId)
      .orderBy(sql`rand()`)
      .limit(limit)
      .execute();

    return rows;
  }

  async listPrimaryAddressesForProposal(
    proposalId: string,
  ): Promise<Array<{ actorId: string; address: string }>> {
    return this.ch
      .selectFrom('voting_power_snapshot_projection as vps')
      .select([
        'vps.actor_address as address',
        sql<string>`coalesce(dictGetOrNull('actor_address_redirect', 'current_actor_id', toString(vps.actor_address)), vps.actor_id_hint, '')`.as(
          'actorId',
        ),
      ])
      .where('vps.proposal_id', '=', proposalId)
      .execute();
  }
}
