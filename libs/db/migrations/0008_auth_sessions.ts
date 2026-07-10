import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// Wallet accounts (SIWE) have no email/display_name, so both relax to nullable and a new
// wallet_address identity anchor is added. Sessions themselves live in Redis, not Postgres —
// this migration only extends the identity store. The email/password fast-follow slots its
// password_hash / verification-token columns in additively on top of this shape (ADR-082).
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('users').addColumn('wallet_address', 'text').execute();

  await sql`
    ALTER TABLE users
      ADD CONSTRAINT users_wallet_address_lowercase CHECK (wallet_address = lower(wallet_address))
  `.execute(db);

  // A plain UNIQUE constraint (not a partial index): Postgres treats NULLs as distinct, so the many
  // email-only accounts with NULL wallet_address coexist fine. A full constraint (vs partial index)
  // is what ON CONFLICT (wallet_address) in upsertByWalletAddress can infer.
  await sql`ALTER TABLE users ADD CONSTRAINT users_wallet_address_key UNIQUE (wallet_address)`.execute(
    db,
  );

  await sql`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`.execute(db);
  await sql`ALTER TABLE users ALTER COLUMN display_name DROP NOT NULL`.execute(db);

  // Every account must carry at least one identity anchor.
  await sql`
    ALTER TABLE users
      ADD CONSTRAINT users_identity_anchor CHECK (email IS NOT NULL OR wallet_address IS NOT NULL)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP CONSTRAINT users_identity_anchor`.execute(db);
  // Restoring NOT NULL is safe only because the enum/table predates any nullable rows in a
  // forward-then-back dev cycle; wallet-only rows would block this, which is the intended signal.
  await sql`ALTER TABLE users ALTER COLUMN display_name SET NOT NULL`.execute(db);
  await sql`ALTER TABLE users ALTER COLUMN email SET NOT NULL`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT users_wallet_address_key`.execute(db);
  await sql`ALTER TABLE users DROP CONSTRAINT users_wallet_address_lowercase`.execute(db);
  await db.schema.alterTable('users').dropColumn('wallet_address').execute();
}
