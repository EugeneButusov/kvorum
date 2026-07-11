import type Redis from 'ioredis';
import { generateNonce } from 'siwe';

// Single-use SIWE nonces with a short TTL. The nonce goes into the EIP-4361 message the wallet
// signs; on verify it is consumed atomically (GETDEL) so a signature can never be replayed.
export const NONCE_TTL_SECONDS = 10 * 60;

const nonceKey = (nonce: string): string => `siwe_nonce:${nonce}`;

export class NonceStore {
  constructor(private readonly redis: Redis) {}

  async issue(): Promise<string> {
    const nonce = generateNonce();
    await this.redis.set(nonceKey(nonce), '1', 'EX', NONCE_TTL_SECONDS);
    return nonce;
  }

  // Returns true exactly once per issued nonce: GETDEL is atomic, so concurrent verifies of the
  // same nonce can't both succeed. false = unknown / expired / already used.
  async consume(nonce: string): Promise<boolean> {
    const existing = await this.redis.getdel(nonceKey(nonce));
    return existing !== null;
  }
}
