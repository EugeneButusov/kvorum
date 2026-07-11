import type { Kysely } from 'kysely';

// Rotation grace: a rotated key stays valid until expires_at (≤24h after rotation) while the new key
// works immediately. Immediate revoke keeps using revoked_at. A key is active when
// `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. The session-scoped
// kv_dashboard_ key also uses expires_at as a safety net so it can't outlive its session.
//
// No index change: the key lookup is by the unique key_hash, and the partial
// idx_api_key_user_id_active (WHERE revoked_at IS NULL) still covers in-grace keys (revoked_at is
// NULL until they lapse). The expires_at comparison is a query-time filter (now() is non-immutable).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('api_key').addColumn('expires_at', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('api_key').dropColumn('expires_at').execute();
}
