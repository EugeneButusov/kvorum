import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { SESSION_TTL_SECONDS } from './session.config';

export interface SessionRecord {
  userId: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
  // The session-scoped kv_dashboard_ key (ADR-035): id (for revocation) + plaintext for the
  // same-origin BFF to attach server-side. Server-side only — never sent to the browser.
  dashboardKeyId?: string;
  dashboardKey?: string;
}

export interface CreatedSession {
  id: string;
  csrfToken: string;
}

// Thrown when the session Redis is unreachable. The guard maps this to 503 (service-unavailable),
// never to 401 — an outage must not read as "logged out".
export class SessionStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Session store is unavailable');
    this.name = 'SessionStoreUnavailableError';
    this.cause = cause;
  }
}

// Only refresh lastSeenAt + TTL at most once per minute per session, so an active session costs one
// Redis write/minute rather than one per request.
const TOUCH_THROTTLE_MS = 60_000;

const sessionKey = (id: string): string => `sess:${id}`;
const userIndexKey = (userId: string): string => `user_sessions:${userId}`;
const opaqueToken = (): string => randomBytes(32).toString('base64url');

export class SessionStore {
  constructor(private readonly redis: Redis) {}

  async create(
    userId: string,
    extra?: { dashboardKeyId?: string; dashboardKey?: string },
  ): Promise<CreatedSession> {
    const id = opaqueToken();
    const csrfToken = opaqueToken();
    const now = Date.now();
    const record: SessionRecord = {
      userId,
      csrfToken,
      createdAt: now,
      lastSeenAt: now,
      ...(extra?.dashboardKeyId !== undefined ? { dashboardKeyId: extra.dashboardKeyId } : {}),
      ...(extra?.dashboardKey !== undefined ? { dashboardKey: extra.dashboardKey } : {}),
    };
    try {
      await this.redis
        .multi()
        .set(sessionKey(id), JSON.stringify(record), 'EX', SESSION_TTL_SECONDS)
        .sadd(userIndexKey(userId), id)
        .expire(userIndexKey(userId), SESSION_TTL_SECONDS)
        .exec();
    } catch (error) {
      throw new SessionStoreUnavailableError(error);
    }
    return { id, csrfToken };
  }

  async get(id: string): Promise<SessionRecord | null> {
    let raw: string | null;
    try {
      raw = await this.redis.get(sessionKey(id));
    } catch (error) {
      throw new SessionStoreUnavailableError(error);
    }
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as SessionRecord;
  }

  // Sliding extension. Takes the already-loaded record (the guard fetches it) to avoid a second read.
  async touch(id: string, record: SessionRecord): Promise<void> {
    const now = Date.now();
    if (now - record.lastSeenAt < TOUCH_THROTTLE_MS) {
      return;
    }
    const updated: SessionRecord = { ...record, lastSeenAt: now };
    try {
      await this.redis
        .multi()
        .set(sessionKey(id), JSON.stringify(updated), 'EX', SESSION_TTL_SECONDS)
        .expire(userIndexKey(record.userId), SESSION_TTL_SECONDS)
        .exec();
    } catch (error) {
      throw new SessionStoreUnavailableError(error);
    }
  }

  async destroy(id: string): Promise<void> {
    const record = await this.get(id);
    try {
      const pipeline = this.redis.multi().del(sessionKey(id));
      if (record !== null) {
        pipeline.srem(userIndexKey(record.userId), id);
      }
      await pipeline.exec();
    } catch (error) {
      throw new SessionStoreUnavailableError(error);
    }
  }

  // "Sign out everywhere." Benign race: a session created concurrently with this call may survive;
  // acceptable for v1 (ADR-082).
  async destroyAllForUser(userId: string): Promise<void> {
    try {
      const ids = await this.redis.smembers(userIndexKey(userId));
      const pipeline = this.redis.multi();
      for (const id of ids) {
        pipeline.del(sessionKey(id));
      }
      pipeline.del(userIndexKey(userId));
      await pipeline.exec();
    } catch (error) {
      throw new SessionStoreUnavailableError(error);
    }
  }
}
