import { randomBytes } from 'crypto';
import { KEY_PREFIX, type KeyPrefix } from './bearer';

export interface GeneratedApiKey {
  key: string;
  prefix: KeyPrefix;
  lastFour: string;
}

export function generateApiKey(prefix: KeyPrefix = KEY_PREFIX): GeneratedApiKey {
  const random = randomBytes(24).toString('base64url');
  const key = `${prefix}${random}`;
  return {
    key,
    prefix,
    lastFour: key.slice(-4),
  };
}
