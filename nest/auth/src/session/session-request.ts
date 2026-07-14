import type { User } from '@libs/db';
import type { SessionRecord } from './session.store';

export interface SessionContext extends SessionRecord {
  id: string;
}

// The request shape a SessionGuard-protected handler sees. `cookies` is populated by cookie-parser
// (registered in each bootstrap); `user`/`session` are attached by the guard.
export interface SessionRequest {
  method: string;
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  user?: User;
  session?: SessionContext;
}
