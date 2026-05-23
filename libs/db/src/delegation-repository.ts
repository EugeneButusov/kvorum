import type { Kysely, Transaction } from 'kysely';
import type { NewDelegation, PgDatabase } from './schema/pg';

export class DelegationRepository {
  constructor(private readonly db: Kysely<PgDatabase> | Transaction<PgDatabase>) {}

  async insert(row: NewDelegation): Promise<void> {
    await this.db.insertInto('delegation').values(row).execute();
  }
}
