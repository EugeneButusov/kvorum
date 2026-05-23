import type { Kysely, Transaction } from 'kysely';
import type { NewVotingPowerSnapshot, PgDatabase } from './schema/pg';

const BULK_INSERT_CHUNK_SIZE = 1000;

export class VotingPowerSnapshotRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async bulkInsert(rows: NewVotingPowerSnapshot[]): Promise<number> {
    if (rows.length === 0) return 0;

    let inserted = 0;
    for (let offset = 0; offset < rows.length; offset += BULK_INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(offset, offset + BULK_INSERT_CHUNK_SIZE);
      await this.db.insertInto('voting_power_snapshot').values(chunk).execute();
      inserted += chunk.length;
    }

    return inserted;
  }

  async deleteForProposal(proposalId: string): Promise<number> {
    const rows = await this.db
      .deleteFrom('voting_power_snapshot')
      .where('proposal_id', '=', proposalId)
      .returning('id')
      .execute();

    return rows.length;
  }

  async updatePower(proposalId: string, actorId: string, power: string): Promise<void> {
    await this.db
      .updateTable('voting_power_snapshot')
      .set({ power })
      .where('proposal_id', '=', proposalId)
      .where('actor_id', '=', actorId)
      .executeTakeFirst();
  }

  async sampleForProposal(
    proposalId: string,
    limit: number,
  ): Promise<Array<{ actorId: string; power: string; address: string }>> {
    return this.db
      .selectFrom('voting_power_snapshot as vps')
      .innerJoin('actor_address as aa', 'aa.actor_id', 'vps.actor_id')
      .select(['vps.actor_id as actorId', 'vps.power as power', 'aa.address as address'])
      .where('vps.proposal_id', '=', proposalId)
      .where('aa.is_primary', '=', true)
      .orderBy((eb) => eb.fn('random'))
      .limit(limit)
      .execute();
  }

  async listPrimaryAddressesForProposal(
    proposalId: string,
  ): Promise<Array<{ actorId: string; address: string }>> {
    return this.db
      .selectFrom('voting_power_snapshot as vps')
      .innerJoin('actor_address as aa', 'aa.actor_id', 'vps.actor_id')
      .select(['vps.actor_id as actorId', 'aa.address as address'])
      .where('vps.proposal_id', '=', proposalId)
      .where('aa.is_primary', '=', true)
      .execute();
  }
}
