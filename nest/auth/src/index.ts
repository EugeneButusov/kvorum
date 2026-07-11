export { AuthModule, SESSION_CONFIG, SIWE_CONFIG } from './auth.module';
export { ApiKeyGuard, AUTH_CONFIG } from './api-key.guard';
export type { AuthenticatedRequest, SafeApiKey } from './authenticated-request';
export { IS_PUBLIC_KEY, Public } from './public.decorator';

// ── Session (cookie) auth ──
export { SessionGuard } from './session/session.guard';
export {
  SessionStore,
  SessionStoreUnavailableError,
  type SessionRecord,
  type CreatedSession,
} from './session/session.store';
export { SessionUser } from './session/session-user.decorator';
export { DashboardKeyService } from './session/dashboard-key.service';
export {
  setSessionCookies,
  clearSessionCookies,
  type CookieWriter,
  type CookieOptions,
} from './session/cookies';
export {
  SESSION_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_TTL_SECONDS,
  parseSessionConfigFromEnv,
  type SessionConfig,
} from './session/session.config';
export type { SessionContext, SessionRequest } from './session/session-request';

// ── SIWE (wallet) auth ──
export { NonceStore, NONCE_TTL_SECONDS } from './siwe/nonce.store';
export { SiweAuthService, type SiweVerifyResult } from './siwe/siwe-auth.service';
export { parseSiweConfigFromEnv, type SiweConfig } from './siwe/siwe.config';
