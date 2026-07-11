import type { Kysely } from 'kysely';
import type { PgDatabase, User, UserRole } from './schema/pg';

export class UserRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findById(id: string): Promise<User | undefined> {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async findByWalletAddress(walletAddress: string): Promise<User | undefined> {
    return this.db
      .selectFrom('users')
      .selectAll()
      .where('wallet_address', '=', walletAddress.toLowerCase())
      .executeTakeFirst();
  }

  // Idempotent insert-or-return keyed on wallet_address; used by the SIWE verify path. The address
  // is lowercased to satisfy the users_wallet_address_lowercase CHECK. Wallet accounts carry no
  // email/display_name at creation. ON CONFLICT DO NOTHING + a fallback SELECT covers the race
  // where two verifies for a new address land concurrently.
  async upsertByWalletAddress(input: { walletAddress: string }): Promise<User> {
    const walletAddress = input.walletAddress.toLowerCase();
    const inserted = await this.db
      .insertInto('users')
      .values({ wallet_address: walletAddress, role: 'user', updated_at: new Date() })
      .onConflict((oc) => oc.column('wallet_address').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted !== undefined) {
      return inserted;
    }
    const existing = await this.findByWalletAddress(walletAddress);
    if (existing === undefined) {
      throw new Error(`upsertByWalletAddress: row vanished for ${walletAddress}`);
    }
    return existing;
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

  // Attaches a recovery email to a (typically SIWE) account. Lowercased to match the email CHECK.
  // Returns 'conflict' when the address already belongs to another account (the unique constraint),
  // so callers can surface a 409 rather than a 500.
  async setRecoveryEmail(userId: string, email: string): Promise<'ok' | 'conflict'> {
    try {
      await this.db
        .updateTable('users')
        .set({ email: email.toLowerCase(), updated_at: new Date() })
        .where('id', '=', userId)
        .execute();
      return 'ok';
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return 'conflict';
      }
      throw error;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error != null && typeof error === 'object' && (error as { code?: unknown }).code === '23505'
    );
  }
}
