import { createHmac, timingSafeEqual } from 'crypto';

export function hashApiKey(pepper: Buffer, key: string): Buffer {
  return createHmac('sha256', pepper).update(key, 'utf8').digest();
}

export function verifyApiKey(pepper: Buffer, key: string, storedHash: Buffer): boolean {
  const computed = hashApiKey(pepper, key);
  if (computed.length !== storedHash.length) {
    return false;
  }

  return timingSafeEqual(computed, storedHash);
}
