import type Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { NONCE_TTL_SECONDS, NonceStore } from './nonce.store';

function makeStore(): { store: NonceStore; redis: RedisMock } {
  const redis = new RedisMock();
  return { store: new NonceStore(redis as unknown as Redis), redis };
}

describe('NonceStore', () => {
  it('issues an alphanumeric nonce with a TTL', async () => {
    const { store, redis } = makeStore();
    const nonce = await store.issue();

    expect(nonce).toMatch(/^[A-Za-z0-9]{8,}$/);
    const ttl = await redis.ttl(`siwe_nonce:${nonce}`);
    expect(ttl).toBeGreaterThan(NONCE_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(NONCE_TTL_SECONDS);
  });

  it('consume succeeds exactly once, then fails (single-use)', async () => {
    const { store } = makeStore();
    const nonce = await store.issue();

    await expect(store.consume(nonce)).resolves.toBe(true);
    await expect(store.consume(nonce)).resolves.toBe(false);
  });

  it('consume fails for an unknown nonce', async () => {
    const { store } = makeStore();
    await expect(store.consume('never-issued')).resolves.toBe(false);
  });
});
