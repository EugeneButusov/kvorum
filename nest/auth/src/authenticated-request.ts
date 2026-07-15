import type { ApiKey, User } from '@libs/db';

export type SafeApiKey = Omit<ApiKey, 'key_hash'>;

export interface AuthenticatedRequest {
  // HTTP method — used to restrict the BFF internal-read token to safe (GET/HEAD) requests.
  method: string;
  headers: {
    authorization?: string;
    // Shared secret the dashboard BFF presents on reads (ADR-084). Node lowercases header keys.
    'x-internal-read-token'?: string | string[];
  };
  user: User;
  apiKey: SafeApiKey;
}
