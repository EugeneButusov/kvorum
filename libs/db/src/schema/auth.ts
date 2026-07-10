import type { Generated, Insertable, Selectable, Updateable } from 'kysely';

// ── Enum string-literal unions ────────────────────────────────────────────────

export type UserRole = 'user' | 'admin';
export type ApiKeyTier = 'authenticated_free' | 'dashboard';
export type AuditOutcome = 'success' | 'failure';
export type ExecutorKind = 'ssh' | 'sudo' | 'env' | 'unknown';

// ── Table row types ───────────────────────────────────────────────────────────

export interface UsersTable {
  id: Generated<string>;
  // Nullable since M6-2: wallet (SIWE) accounts carry no email/display_name. A CHECK guarantees
  // every row still has at least one identity anchor (email OR wallet_address).
  email: string | null;
  display_name: string | null;
  wallet_address: string | null;
  role: UserRole;
  banned_at: Date | null;
  banned_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Date;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;

export interface ApiKeyTable {
  id: Generated<string>;
  user_id: string;
  key_hash: Buffer;
  prefix: string;
  last_four: string;
  tier: ApiKeyTier;
  label: string | null;
  created_at: Generated<Date>;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export type ApiKey = Selectable<ApiKeyTable>;
export type NewApiKey = Insertable<ApiKeyTable>;

export interface AdminAuditTable {
  id: Generated<string>;
  command: string;
  args: unknown;
  executor: string;
  executor_kind: ExecutorKind;
  started_at: Generated<Date>;
  completed_at: Date | null;
  outcome: AuditOutcome | null;
  error: unknown | null;
}

export type AdminAudit = Selectable<AdminAuditTable>;
export type NewAdminAudit = Insertable<AdminAuditTable>;
