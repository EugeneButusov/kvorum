import type { Kysely } from 'kysely';
import type { PgDatabase, User, UserRole } from './schema/pg';

export class UserRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findById(id: string): Promise<User | undefined> {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async create(input: { email: string; displayName: string; role: UserRole }): Promise<User> {
    return this.db
      .insertInto('users')
      .values({
        email: input.email.toLowerCase(),
        display_name: input.displayName,
        role: input.role,
        updated_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
