import type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';

export type { AdminAuditTable, ApiKeyTable, UsersTable } from './auth';
export type {
  AdminAudit,
  ApiKey,
  ApiKeyTier,
  AuditOutcome,
  ExecutorKind,
  NewAdminAudit,
  NewApiKey,
  NewUser,
  User,
  UserRole,
  UserUpdate,
} from './auth';

export interface PgDatabase {
  users: UsersTable;
  api_key: ApiKeyTable;
  admin_audit: AdminAuditTable;
}
