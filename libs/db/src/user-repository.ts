import type { Kysely } from 'kysely';
import type { PgDatabase, User } from './schema/pg';

export class UserRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findById(id: string): Promise<User | undefined> {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }
}
