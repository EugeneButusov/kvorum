import { sql, type Kysely } from 'kysely';
import type { ApiKey, ApiKeyTier, PgDatabase, User } from './schema/pg';

export type SafeApiKey = Omit<ApiKey, 'key_hash'>;

export type ActiveApiKeyResult = {
  apiKey: SafeApiKey;
  user: User;
};

type ActiveApiKeyRow = {
  api_key_id: string;
  api_key_user_id: string;
  api_key_prefix: string;
  api_key_last_four: string;
  api_key_tier: ApiKey['tier'];
  api_key_label: string | null;
  api_key_created_at: Date;
  api_key_last_used_at: Date | null;
  api_key_revoked_at: Date | null;
  api_key_expires_at: Date | null;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  user_role: User['role'];
  user_wallet_address: string | null;
  user_banned_at: Date | null;
  user_banned_reason: string | null;
  user_created_at: Date;
  user_updated_at: Date;
};

export class ApiKeyRepository {
  constructor(private readonly db: Kysely<PgDatabase>) {}

  async findActiveByHash(keyHash: Buffer): Promise<ActiveApiKeyResult | undefined> {
    const row = await this.db
      .selectFrom('api_key')
      .innerJoin('users', 'users.id', 'api_key.user_id')
      .select([
        'api_key.id as api_key_id',
        'api_key.user_id as api_key_user_id',
        'api_key.prefix as api_key_prefix',
        'api_key.last_four as api_key_last_four',
        'api_key.tier as api_key_tier',
        'api_key.label as api_key_label',
        'api_key.created_at as api_key_created_at',
        'api_key.last_used_at as api_key_last_used_at',
        'api_key.revoked_at as api_key_revoked_at',
        'api_key.expires_at as api_key_expires_at',
        'users.id as user_id',
        'users.email as user_email',
        'users.display_name as user_display_name',
        'users.role as user_role',
        'users.wallet_address as user_wallet_address',
        'users.banned_at as user_banned_at',
        'users.banned_reason as user_banned_reason',
        'users.created_at as user_created_at',
        'users.updated_at as user_updated_at',
      ])
      .where('api_key.key_hash', '=', keyHash)
      .where('api_key.revoked_at', 'is', null)
      // Rotation grace: a rotated key stays valid until expires_at lapses.
      .where((eb) =>
        eb.or([
          eb('api_key.expires_at', 'is', null),
          eb('api_key.expires_at', '>', sql<Date>`now()`),
        ]),
      )
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return this.toActiveResult(row as ActiveApiKeyRow);
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.db
      .updateTable('api_key')
      .set({ last_used_at: sql`now()` })
      .where('id', '=', id)
      .where((eb) =>
        eb.or([
          eb('last_used_at', 'is', null),
          // Query builder can't express interval literals; constant-only raw SQL is allowed.
          eb('last_used_at', '<', sql<Date>`now() - interval '60 seconds'`),
        ]),
      )
      .execute();
  }

  async rehashKey(id: string, newHash: Buffer): Promise<void> {
    try {
      await this.db
        .updateTable('api_key')
        .set({ key_hash: newHash })
        .where('id', '=', id)
        .execute();
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return;
      }

      throw error;
    }
  }

  async listByUser(userId?: string): Promise<SafeApiKey[]> {
    let query = this.db.selectFrom('api_key').selectAll().orderBy('created_at', 'desc');
    if (userId != null) {
      query = query.where('user_id', '=', userId);
    }
    const rows = await query.execute();
    return rows.map(({ key_hash: _ignored, ...rest }) => rest);
  }

  async create(input: {
    userId: string;
    keyHash: Buffer;
    prefix: string;
    lastFour: string;
    label?: string;
    tier?: ApiKeyTier;
    expiresAt?: Date;
  }): Promise<SafeApiKey> {
    const row = await this.db
      .insertInto('api_key')
      .values({
        user_id: input.userId,
        key_hash: input.keyHash,
        prefix: input.prefix,
        last_four: input.lastFour,
        label: input.label ?? null,
        tier: input.tier ?? 'authenticated_free',
        expires_at: input.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const { key_hash: _ignored, ...rest } = row;
    return rest;
  }

  // Ownership-scoped lookup for the developer key-CRUD endpoints (rotate/revoke).
  async findByIdForUser(id: string, userId: string): Promise<SafeApiKey | undefined> {
    const row = await this.db
      .selectFrom('api_key')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (row === undefined) {
      return undefined;
    }
    const { key_hash: _ignored, ...rest } = row;
    return rest;
  }

  // Rotation grace: keep a key valid until `when`, after which findActiveByHash treats it inactive.
  async expireAt(id: string, when: Date): Promise<void> {
    await this.db
      .updateTable('api_key')
      .set({ expires_at: when })
      .where('id', '=', id)
      .where('revoked_at', 'is', null)
      .execute();
  }

  // Immediately revoke every still-active dashboard-tier key for a user (sign-out-everywhere).
  async revokeActiveDashboardKeysForUser(userId: string): Promise<void> {
    await this.db
      .updateTable('api_key')
      .set({ revoked_at: sql`now()` })
      .where('user_id', '=', userId)
      .where('tier', '=', 'dashboard')
      .where('revoked_at', 'is', null)
      .execute();
  }

  async revoke(id: string): Promise<'revoked' | 'already_revoked' | 'not_found'> {
    const row = await this.db
      .selectFrom('api_key')
      .select(['id', 'revoked_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (row == null) {
      return 'not_found';
    }
    if (row.revoked_at != null) {
      return 'already_revoked';
    }
    await this.db
      .updateTable('api_key')
      .set({ revoked_at: sql`now()` })
      .where('id', '=', id)
      .execute();
    return 'revoked';
  }

  private toActiveResult(row: ActiveApiKeyRow): ActiveApiKeyResult {
    return {
      apiKey: {
        id: row.api_key_id,
        user_id: row.api_key_user_id,
        prefix: row.api_key_prefix,
        last_four: row.api_key_last_four,
        tier: row.api_key_tier,
        label: row.api_key_label,
        created_at: row.api_key_created_at,
        last_used_at: row.api_key_last_used_at,
        revoked_at: row.api_key_revoked_at,
        expires_at: row.api_key_expires_at,
      },
      user: {
        id: row.user_id,
        email: row.user_email,
        display_name: row.user_display_name,
        wallet_address: row.user_wallet_address,
        role: row.user_role,
        banned_at: row.user_banned_at,
        banned_reason: row.user_banned_reason,
        created_at: row.user_created_at,
        updated_at: row.user_updated_at,
      },
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (error == null || typeof error !== 'object') {
      return false;
    }

    return (error as { code?: unknown }).code === '23505';
  }
}
