import type { ApiKey, User } from '@libs/db';

export type SafeApiKey = Omit<ApiKey, 'key_hash'>;

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  user: User;
  apiKey: SafeApiKey;
}
