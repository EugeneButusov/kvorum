import { z } from 'zod';

// 30 days, per SPEC §6.14. The TTL is refreshed on activity (sliding), so this is an
// idle-timeout, not an absolute lifetime.
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_COOKIE = 'kv_session';
export const CSRF_COOKIE = 'kv_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface SessionConfig {
  redisUrl: string;
  cookieSecure: boolean;
  cookieDomain: string | undefined;
}

const schema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Secure cookies by default; only a dev/test opt-out flips it off (plain-HTTP localhost).
  SESSION_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SESSION_COOKIE_DOMAIN: z.string().optional(),
});

export function parseSessionConfigFromEnv(env: NodeJS.ProcessEnv): SessionConfig {
  const parsed = schema.parse(env);
  return {
    redisUrl: parsed.REDIS_URL,
    cookieSecure: parsed.SESSION_COOKIE_SECURE,
    cookieDomain: parsed.SESSION_COOKIE_DOMAIN,
  };
}
