import { sql, type Kysely } from 'kysely';
import type { ClickHouseDatabase } from './schema/clickhouse';

export class VotingPowerSnapshotProjectionReadRepository {
  constructor(private readonly ch: Kysely<ClickHouseDatabase>) {}

  async deleteForProposal(proposalId: string): Promise<void> {
    // Must delete from both raw and agg — the MV only propagates inserts, not deletes.
    await sql`ALTER TABLE voting_power_snapshot_raw DELETE WHERE proposal_id = ${proposalId}`.execute(
      this.ch,
    );
    await sql`ALTER TABLE voting_power_snapshot_agg DELETE WHERE proposal_id = ${proposalId}`.execute(
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

  async updatePower(args: {
    daoId: string;
    proposalId: string;
    actorAddress: string;
    votingPower: string;
    actorIdHint: string | null;
  }): Promise<void> {
    // Insert a new raw row with a fresh version — the MV feeds it into the AMT and
    // argMaxMerge(voting_power_state) picks the latest value going forward.
    await this.ch
      .insertInto('voting_power_snapshot_raw')
      .values({
        dao_id: args.daoId,
        proposal_id: args.proposalId,
        actor_address: args.actorAddress,
        voting_power: args.votingPower,
        actor_id_hint: args.actorIdHint,
        computed_at: new Date(),
      })
      .execute();
  }
}
