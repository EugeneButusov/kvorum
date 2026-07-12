import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { SESSION_TTL_SECONDS } from './session.config';
import { SessionStore, type SessionRecord } from './session.store';

function makeStore(): { store: SessionStore; redis: RedisMock } {
  const redis = new RedisMock();
  return { store: new SessionStore(redis as unknown as Redis), redis };
}

describe('SessionStore', () => {
  it('creates a session, indexes it under the user, and sets a 30-day TTL', async () => {
    const { store, redis } = makeStore();
    const { id, csrfToken } = await store.create('user-1');

    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(id).not.toBe(csrfToken);

    const record = await store.get(id);
    expect(record).toMatchObject({ userId: 'user-1', csrfToken });

    const members = await redis.smembers('user_sessions:user-1');
    expect(members).toContain(id);

    const ttl = await redis.ttl(`sess:${id}`);
    expect(ttl).toBeGreaterThan(SESSION_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it('returns null for an unknown session', async () => {
    const { store } = makeStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('touch refreshes lastSeenAt + TTL once the throttle window has passed', async () => {
    const { store, redis } = makeStore();
    const { id } = await store.create('user-1');
    const original = (await store.get(id)) as SessionRecord;

    // Simulate a stale record (older than the 60s throttle) so touch actually writes.
    const stale: SessionRecord = { ...original, lastSeenAt: original.lastSeenAt - 120_000 };
    await redis.set(`sess:${id}`, JSON.stringify(stale));

    await store.touch(id, stale);
    const refreshed = (await store.get(id)) as SessionRecord;
    expect(refreshed.lastSeenAt).toBeGreaterThan(stale.lastSeenAt);
    expect(await redis.ttl(`sess:${id}`)).toBeGreaterThan(SESSION_TTL_SECONDS - 5);
  });

  it('touch is a no-op within the throttle window', async () => {
    const { store } = makeStore();
    const { id } = await store.create('user-1');
    const record = (await store.get(id)) as SessionRecord;

    await store.touch(id, record); // lastSeenAt is "now" → throttled
    const after = (await store.get(id)) as SessionRecord;
    expect(after.lastSeenAt).toBe(record.lastSeenAt);
  });

  it('destroy removes the session and its index entry', async () => {
    const { store, redis } = makeStore();
    const { id } = await store.create('user-1');

    await store.destroy(id);
    expect(await store.get(id)).toBeNull();
    expect(await redis.smembers('user_sessions:user-1')).not.toContain(id);
  });

  it('destroyAllForUser revokes every session for the user', async () => {
    const { store } = makeStore();
    const a = await store.create('user-1');
    const b = await store.create('user-1');
    const other = await store.create('user-2');

    await store.destroyAllForUser('user-1');
    expect(await store.get(a.id)).toBeNull();
    expect(await store.get(b.id)).toBeNull();
    // Another user's session is untouched.
    expect(await store.get(other.id)).not.toBeNull();
  });
});
